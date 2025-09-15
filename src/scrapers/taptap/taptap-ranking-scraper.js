const SCRAPER_CONFIGS = require('../../config/scraper-configs');
const PUPPETEER_CONFIG = require('../../config/puppeteer-config');
const browserManager = require('../../utils/browser-manager');
const fs = require('fs');
const path = require('path');

class TapTapRankingScraper {
  constructor() {
    this.config = SCRAPER_CONFIGS.taptap;
    this.timeouts = {
      ...PUPPETEER_CONFIG.GLOBAL_TIMEOUTS,
      ...this.config.CUSTOM_TIMEOUTS
    };
  }

  async scrape(logger = console) {
    let tabId = null;
    let page = null;
    let attempt = 1;

    while (attempt <= this.config.MAX_RETRIES) {
      try {
        logger.info(`Scraping attempt ${attempt}/${this.config.MAX_RETRIES}`);
        
        const tabInfo = await browserManager.getAvailableTab('taptap');
        tabId = tabInfo.tabId;
        page = tabInfo.page;

        logger.info('Loading ranking page...');
        await page.goto(this.config.TARGET_URL, {
          waitUntil: 'networkidle0',
          timeout: this.timeouts.PAGE_LOAD
        });

        logger.info('Page loaded, waiting for content...');
        await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);

        // Try to wait for some content to appear
        try {
          await page.waitForSelector('body', { timeout: 5000 });
          logger.info('Body element found');
        } catch (error) {
          logger.info('Warning: Could not find body element');
        }

        logger.info(`Scrolling to load ${this.config.TARGET_RANK} games...`);
        const allGames = await this.scrollAndCollectGames(page, logger);

        if (allGames.length === 0) {
          throw new Error('No games found');
        }

        // Limit to target rank
        const limitedGames = allGames.slice(0, this.config.TARGET_RANK);
        logger.info(`Collected ${limitedGames.length} games (target: ${this.config.TARGET_RANK})`);

        const result = this.formatResult(limitedGames);
        await this.saveToFile(result);

        logger.info(`Successfully scraped ${limitedGames.length} games`);
        return result;

      } catch (error) {
        logger.error(`Attempt ${attempt} failed:${error.message ? ": " + error.message : ""}`);
        
        if (attempt === this.config.MAX_RETRIES) {
          throw new Error(`Scraping failed after ${this.config.MAX_RETRIES} attempts: ${error.message}`);
        }
        
        attempt++;
        await new Promise(resolve => setTimeout(resolve, this.timeouts.RETRY_DELAY));
      } finally {
        if (tabId) {
          await browserManager.releaseTab(tabId);
        }
      }
    }
  }

  async scrollAndCollectGames(page, logger = console) {
    logger.info(`Fast scrolling to load pages 1-${this.config.TARGET_PAGE}...`);

    // Fast scroll until we have all pages loaded
    let scrollAttempts = 0;
    let targetPageFound = false;

    while (!targetPageFound && scrollAttempts < this.config.INFINITE_SCROLL.MAX_SCROLL_ATTEMPTS) {
      logger.info(`Fast scroll attempt ${scrollAttempts + 1}`);

      // Check current pages loaded
      const currentPages = await page.evaluate((targetPage) => {
        const pages = [];
        for (let i = 1; i <= targetPage; i++) {
          const pageElements = document.querySelectorAll(`div.list-item[data-page="${i}"]`);
          if (pageElements.length > 0) {
            pages.push({ page: i, count: pageElements.length });
          }
        }
        return pages;
      }, this.config.TARGET_PAGE);

      console.log(`[TAPTAP] Current loaded pages:`, currentPages.map(p => `page ${p.page}: ${p.count} items`).join(', '));

      // Check if target page is loaded
      if (currentPages.length === this.config.TARGET_PAGE && currentPages[currentPages.length - 1].page === this.config.TARGET_PAGE) {
        logger.info(`All pages 1-${this.config.TARGET_PAGE} loaded successfully!`);
        targetPageFound = true;
        break;
      }

      // Fast scroll down
      await page.evaluate((scrollPixels) => {
        window.scrollBy(0, scrollPixels);
      }, this.config.INFINITE_SCROLL.FAST_SCROLL_PIXELS);

      // Short wait for content load
      await page.waitForTimeout(this.config.INFINITE_SCROLL.WAIT_FOR_LOAD);
      scrollAttempts++;
    }

    if (!targetPageFound) {
      logger.info(`Warning: Could not load all pages after ${scrollAttempts} attempts`);
    }

    // Now extract all games from loaded pages
    logger.info(`Extracting games from all loaded pages...`);
    const allGames = await this.extractAllGamesFromPages(page, logger);

    return allGames;
  }

  async extractAllGamesFromPages(page, logger = console) {
    const allGames = await page.evaluate((containerSelector, selectors, targetPage) => {
      const results = [];

      // Extract from each page 1 to targetPage
      for (let pageNum = 1; pageNum <= targetPage; pageNum++) {
        const pageSelector = `${containerSelector}[data-page="${pageNum}"]`;
        const gameElements = document.querySelectorAll(pageSelector);

        console.log(`Processing page ${pageNum}: ${gameElements.length} games`);

        gameElements.forEach((gameElement, index) => {
          try {
            // Calculate rank based on page and index
            const rank = ((pageNum - 1) * 10) + (index + 1);

            // Extract rank from element (fallback to calculated)
            let displayRank = rank.toString();
            const rankElement = gameElement.querySelector(selectors.rank) ||
                              gameElement.querySelector('span[class*="rank"]') ||
                              gameElement.querySelector('.rank') ||
                              gameElement.querySelector('[class*="data-v-"]');
            if (rankElement && rankElement.textContent.trim()) {
              displayRank = rankElement.textContent.trim();
            }

            // Extract title with multiple fallbacks
            let title = null;
            const titleSelectors = [
              selectors.title,
              'div.text-with-tags.app-title',
              '.app-title',
              '.game-title',
              'h3', 'h2', 'h1',
              '[class*="title"]',
              '[class*="name"]',
              'a[href*="/app/"]'
            ];

            for (const titleSelector of titleSelectors) {
              const titleElement = gameElement.querySelector(titleSelector);
              if (titleElement && titleElement.textContent.trim()) {
                title = titleElement.textContent.trim();
                break;
              }
            }

            // Extract rating
            let rating = null;
            const ratingSelectors = [
              selectors.rating,
              'div[class*="rating"]',
              'span[class*="rating"]',
              '.rate-number',
              '[class*="score"]'
            ];

            for (const ratingSelector of ratingSelectors) {
              const ratingElement = gameElement.querySelector(ratingSelector);
              if (ratingElement && ratingElement.textContent.trim()) {
                rating = ratingElement.textContent.trim();
                break;
              }
            }

            // Extract category - try primary first
            let category = null;
            const categoryPrimaryElement = gameElement.querySelector(selectors.category_primary);
            if (categoryPrimaryElement && categoryPrimaryElement.textContent.trim()) {
              category = categoryPrimaryElement.textContent.trim();
            } else {
              // Try tags if primary not found
              const categoryTagElements = gameElement.querySelectorAll(selectors.category_tags);
              if (categoryTagElements.length > 0) {
                const tags = Array.from(categoryTagElements)
                  .map(el => el.textContent.trim())
                  .filter(text => text);
                if (tags.length > 0) {
                  category = tags.join(', ');
                }
              }
            }

            // Extract game link
            let gameLink = null;
            const gameLinkSelectors = [
              selectors.game_link,
              'a.tap-router.tap-router__prefetched',
              'a.game-cell__icon',
              'a[class*="tap-router"]',
              'a[href*="/app/"]'
            ];

            for (const linkSelector of gameLinkSelectors) {
              const linkElement = gameElement.querySelector(linkSelector);
              if (linkElement && linkElement.href) {
                gameLink = linkElement.href;
                break;
              }
            }

            // Extract image
            let image = null;
            const imageElement = gameElement.querySelector(selectors.image);
            if (imageElement && imageElement.src) {
              image = imageElement.src;
            }

            // Add game if we have at least title
            if (title) {
              results.push({
                rank: displayRank,
                calculatedRank: rank,
                title: title,
                rating: rating || 'N/A',
                category: category || 'N/A',
                gameLink: gameLink || 'N/A',
                image: image || 'N/A',
                page: pageNum
              });
            }

          } catch (error) {
            console.error(`Error extracting game ${index + 1} from page ${pageNum}:`, error);
          }
        });
      }

      return results;
    }, this.config.GAME_CONTAINER_SELECTOR, this.config.RANKING_SELECTORS, this.config.TARGET_PAGE);

    logger.info(`Extracted ${allGames.length} games from ${this.config.TARGET_PAGE} pages`);
    return allGames;
  }

  async extractGamesFromPage(page) {
    // Debug: log page content first
    const debugInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.textContent.substring(0, 200),
        allElements: document.querySelectorAll('*').length
      };
    });
    console.log(`[TAPTAP] Page debug:`, JSON.stringify(debugInfo, null, 2));

    const games = await page.evaluate((selectors) => {
      // Try multiple selectors for game containers
      const possibleSelectors = [
        '[data-testid^="app-card-"]',
        '.app-card',
        '.game-item',
        '.ranking-item',
        '.game-card',
        '.app-item',
        '[class*="card"]',
        '[class*="item"]',
        '[class*="app"]',
        '[class*="game"]'
      ];

      let gameElements = [];
      for (const selector of possibleSelectors) {
        gameElements = document.querySelectorAll(selector);
        if (gameElements.length > 0) {
          console.log('Found', gameElements.length, 'elements with selector:', selector);
          break;
        }
      }

      console.log('Total game elements found:', gameElements.length);
      const results = [];

      gameElements.forEach((gameElement, index) => {
        try {
          // Extract rank
          let rank = null;
          const rankElement = gameElement.querySelector(selectors.rank) || 
                            gameElement.querySelector('span[class*="rank"]') ||
                            gameElement.querySelector('.rank');
          if (rankElement) {
            rank = rankElement.textContent.trim();
          } else {
            // If no rank element found, use index + 1
            rank = (index + 1).toString();
          }

          // Extract title with more fallbacks
          let title = null;
          const titleSelectors = [
            selectors.title,
            'div.text-with-tags.app-title',
            '.app-title',
            '.game-title',
            'h3',
            'h2',
            'h1',
            '[class*="title"]',
            '[class*="name"]',
            'a[href*="/app/"]'
          ];

          for (const titleSelector of titleSelectors) {
            const titleElement = gameElement.querySelector(titleSelector);
            if (titleElement && titleElement.textContent.trim()) {
              title = titleElement.textContent.trim();
              break;
            }
          }

          // Extract rating
          let rating = null;
          const ratingElement = gameElement.querySelector(selectors.rating) ||
                              gameElement.querySelector('[class*="rating"]') ||
                              gameElement.querySelector('.rate-number');
          if (ratingElement) {
            rating = ratingElement.textContent.trim();
          }

          // Extract category - try primary first
          let category = null;
          const categoryPrimaryElement = gameElement.querySelector(selectors.category_primary);
          if (categoryPrimaryElement) {
            category = categoryPrimaryElement.textContent.trim();
          } else {
            // Try tags if primary not found
            const categoryTagElements = gameElement.querySelectorAll(selectors.category_tags);
            if (categoryTagElements.length > 0) {
              const tags = Array.from(categoryTagElements).map(el => el.textContent.trim()).filter(text => text);
              if (tags.length > 0) {
                category = tags.join(', ');
              }
            }
          }

          // Only add if we have at least title or rank
          if (title || rank) {
            results.push({
              rank: rank || (index + 1).toString(),
              title: title || 'N/A',
              rating: rating || 'N/A',
              category: category || 'N/A'
            });
          }
        } catch (error) {
          console.error('Error extracting game data:', error);
        }
      });

      return results;
    }, this.config.RANKING_SELECTORS);

    return games;
  }

  formatResult(games) {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    
    return {
      timestamp: vietnamTime.toISOString().replace('Z', '+07:00'),
      source: this.config.TARGET_URL,
      target_rank: this.config.TARGET_RANK,
      data: games,
      total: games.length
    };
  }

  async saveToFile(data) {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    
    const day = String(vietnamTime.getUTCDate()).padStart(2, '0');
    const month = String(vietnamTime.getUTCMonth() + 1).padStart(2, '0');
    const year = vietnamTime.getUTCFullYear();
    const hours = String(vietnamTime.getUTCHours()).padStart(2, '0');
    const minutes = String(vietnamTime.getUTCMinutes()).padStart(2, '0');
    
    const filename = `taptap-ranking-${day}-${month}-${year}-${hours}-${minutes}.json`;
    const dirpath = path.join(__dirname, '../../../results/taptap');
    const filepath = path.join(dirpath, filename);

    // Auto-create directory if it doesn't exist
    await fs.promises.mkdir(dirpath, { recursive: true });
    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    // Results saved message will be logged by the main server
    
    return filename;
  }
}

module.exports = TapTapRankingScraper;