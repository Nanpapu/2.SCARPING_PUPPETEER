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

        const allGamesFromAllSources = [];

        // Process each ranking URL
        for (const rankingConfig of this.config.TARGET_URLS) {
          logger.info(`Loading ranking page: ${rankingConfig.source} (${rankingConfig.url})...`);

          await page.goto(rankingConfig.url, {
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

          logger.info(`Scrolling to load ${this.config.TARGET_RANK} games from ${rankingConfig.source}...`);
          const gamesFromSource = await this.scrollAndCollectGames(page, logger);

          if (gamesFromSource.length === 0) {
            logger.info(`Warning: No games found from ${rankingConfig.source}`);
            continue;
          }

          // Limit to target rank and add source info
          const limitedGames = gamesFromSource.slice(0, this.config.TARGET_RANK).map(game => ({
            ...game,
            source: rankingConfig.source
          }));

          logger.info(`Collected ${limitedGames.length} games from ${rankingConfig.source} (target: ${this.config.TARGET_RANK})`);
          allGamesFromAllSources.push(...limitedGames);
        }

        if (allGamesFromAllSources.length === 0) {
          throw new Error('No games found from any source');
        }

        logger.info(`Total collected ${allGamesFromAllSources.length} games from ${this.config.TARGET_URLS.length} sources`);

        // Extract detailed game information in batches
        logger.info(`Extracting game details (release date, developer, publisher, manufacturer, supplier) in batches of ${this.config.BATCH_SIZE}...`);
        const detailedGames = [];

        for (let i = 0; i < allGamesFromAllSources.length; i += this.config.BATCH_SIZE) {
          const batch = allGamesFromAllSources.slice(i, i + this.config.BATCH_SIZE);
          logger.info(`Processing batch ${Math.floor(i / this.config.BATCH_SIZE) + 1}/${Math.ceil(allGamesFromAllSources.length / this.config.BATCH_SIZE)} (${batch.length} games)`);

          const batchPromises = batch.map(async (game, index) => {
            try {
              logger.info(`  Processing game ${i + index + 1}/${allGamesFromAllSources.length}: ${game.title} (${game.source})`);
              const gameDetails = await this.extractGameDetails(game.gameLink, logger);
              return {
                ...game,
                releaseDate: gameDetails.releaseDate,
                developer: gameDetails.developer,
                publisher: gameDetails.publisher,
                manufacturer: gameDetails.manufacturer,
                supplier: gameDetails.supplier
              };
            } catch (error) {
              logger.error(`  Failed to extract game details from ${game.gameLink}:${error.message ? ": " + error.message : ""}`);
              return {
                ...game,
                releaseDate: null,
                developer: null,
                publisher: null,
                manufacturer: null,
                supplier: null
              };
            }
          });

          const batchResults = await Promise.all(batchPromises);
          detailedGames.push(...batchResults);

          if (i + this.config.BATCH_SIZE < allGamesFromAllSources.length) {
            logger.info(`  Waiting ${this.timeouts.BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.timeouts.BATCH_DELAY));
          }
        }

        const result = this.formatResult(detailedGames);
        await this.saveToFile(result);

        logger.info(`Successfully scraped ${allGamesFromAllSources.length} games with detailed information`);
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
    const scrollToPage = this.config.SCROLL_TO_PAGE || this.config.TARGET_PAGE;
    logger.info(`Fast scrolling to load pages 1-${scrollToPage} (but will extract data from pages 1-${this.config.TARGET_PAGE})...`);

    // Fast scroll until we have all pages loaded
    let scrollAttempts = 0;
    let targetPageFound = false;

    while (!targetPageFound && scrollAttempts < this.config.INFINITE_SCROLL.MAX_SCROLL_ATTEMPTS) {
      logger.info(`Fast scroll attempt ${scrollAttempts + 1}`);

      // Check current pages loaded
      const currentPages = await page.evaluate((scrollToPage) => {
        const pages = [];
        for (let i = 1; i <= scrollToPage; i++) {
          const pageElements = document.querySelectorAll(`div.list-item[data-page="${i}"]`);
          if (pageElements.length > 0) {
            pages.push({ page: i, count: pageElements.length });
          }
        }
        return pages;
      }, scrollToPage);

      console.log(`[TAPTAP] Current loaded pages:`, currentPages.map(p => `page ${p.page}: ${p.count} items`).join(', '));

      // Check if target page is loaded
      if (currentPages.length === scrollToPage && currentPages[currentPages.length - 1].page === scrollToPage) {
        logger.info(`All pages 1-${scrollToPage} loaded successfully!`);
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
      logger.info(`Warning: Could not load all pages up to page ${scrollToPage} after ${scrollAttempts} attempts`);
    }

    // Wait 15 seconds to ensure all content and images are fully loaded
    logger.info(`Waiting 15 seconds to ensure all content and images are fully loaded...`);
    await page.waitForTimeout(15000);

    // Additional wait for images to load
    try {
      await page.waitForSelector('img[data-v-b7568bee]', { timeout: 5000 });
      logger.info('Images with data-v-b7568bee found');
    } catch (error) {
      logger.info('Warning: Could not find images with data-v-b7568bee, proceeding anyway');
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

            // Extract image with multiple selectors
            let image = null;
            const imageSelectors = [
              selectors.image,
              selectors.image_fallback,
              'img[data-v-b7568bee]',
              'img.tap-image.app-icon__img',
              'img.app-icon__img',
              '.tap-image-wrapper img',
              '.app-icon img'
            ];

            for (const imageSelector of imageSelectors) {
              const imageElement = gameElement.querySelector(imageSelector);
              if (imageElement && imageElement.src) {
                image = imageElement.src;
                break;
              }
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
      sources: this.config.TARGET_URLS.map(config => config.url),
      target_rank_per_source: this.config.TARGET_RANK,
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

  async extractGameDetails(gameLink, logger = console) {
    if (!gameLink || gameLink === 'N/A') {
      return {
        releaseDate: null,
        developer: null,
        publisher: null,
        manufacturer: null,
        supplier: null
      };
    }

    const tabInfo = await browserManager.getAvailableTab('taptap-detail');
    const { tabId, page } = tabInfo;

    try {
      await page.goto(gameLink, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.DETAIL_LOAD
      });

      await page.waitForTimeout(this.timeouts.WAIT_AFTER_DETAIL);

      const gameDetails = await page.evaluate((selectors) => {
        const result = {
          releaseDate: null,
          developer: null,
          publisher: null,
          manufacturer: null,
          supplier: null
        };

        // Extract release date
        const releaseDateSelectors = [
          selectors.release_date,
          'div.tap-text.tap-text__one-line.single-info__content__value.gray-07',
          'div[data-v-0e365061]',
          '.single-info__content__value'
        ];

        for (const selector of releaseDateSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            const text = element.textContent.trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
              result.releaseDate = text;
              break;
            }
          }
          if (result.releaseDate) break;
        }

        // Extract developer and publisher
        console.log('DEBUG: Starting developer/publisher extraction');

        // Try broader search for app-intro section
        const appIntroItems = document.querySelectorAll('div.app-intro__item, .app-intro__item, div[class*="app-intro"]');
        console.log('DEBUG: Found app-intro items:', appIntroItems.length);

        for (let i = 0; i < appIntroItems.length; i++) {
          const item = appIntroItems[i];
          console.log(`DEBUG: Processing app-intro item ${i + 1}`);

          // Look for any div with data-v-c22f6d57 attribute
          const dataDivs = item.querySelectorAll('div[data-v-c22f6d57]');
          console.log(`DEBUG: Found ${dataDivs.length} divs with data-v-c22f6d57`);

          for (let j = 0; j < dataDivs.length; j++) {
            const dataDiv = dataDivs[j];
            console.log(`DEBUG: Processing data div ${j + 1}`);

            // Look for all anchor tags within
            const links = dataDiv.querySelectorAll('a');
            console.log(`DEBUG: Found ${links.length} anchor tags in data div`);

            for (let k = 0; k < links.length; k++) {
              const link = links[k];
              console.log(`DEBUG: Processing link ${k + 1}`);

              // Get all div children inside the link
              const divs = link.querySelectorAll('div');
              console.log(`DEBUG: Found ${divs.length} divs inside link`);

              for (let d = 0; d < divs.length; d++) {
                const div = divs[d];
                const text = div.textContent.trim();
                console.log(`DEBUG: Div ${d + 1} text: "${text}"`);
              }

              if (divs.length >= 2) {
                const labelDiv = divs[0];
                const valueDiv = divs[1];

                const labelText = labelDiv.textContent.trim();
                const value = valueDiv.textContent.trim();

                console.log(`DEBUG: Label: "${labelText}", Value: "${value}"`);

                if (labelText === '开发' && !result.developer) {
                  result.developer = value;
                  console.log(`DEBUG: Set developer to: ${value}`);
                } else if (labelText === '发行' && !result.publisher) {
                  result.publisher = value;
                  console.log(`DEBUG: Set publisher to: ${value}`);
                } else if (labelText === '厂商' && !result.manufacturer) {
                  result.manufacturer = value;
                  console.log(`DEBUG: Set manufacturer to: ${value}`);
                }
              }
            }
          }
        }

        // Extract supplier
        const supplierContainers = document.querySelectorAll(selectors.supplier.text_container);
        for (const container of supplierContainers) {
          const supplierInfo = container.querySelector(selectors.supplier.supplier_info);
          if (supplierInfo) {
            const text = supplierInfo.textContent.trim();
            if (text.includes(selectors.supplier.label_text)) {
              // Extract supplier name after "供应商 "
              result.supplier = text.replace(selectors.supplier.label_text, '').trim();
              break;
            }
          }
        }

        return result;
      }, this.config.DETAILS_SELECTORS);

      return gameDetails;
    } finally {
      await browserManager.releaseTab(tabId);
    }
  }
}

module.exports = TapTapRankingScraper;