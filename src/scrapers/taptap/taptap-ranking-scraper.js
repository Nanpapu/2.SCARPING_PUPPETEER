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

  async scrape() {
    let tabId = null;
    let page = null;
    let attempt = 1;

    while (attempt <= this.config.MAX_RETRIES) {
      try {
        console.log(`[TAPTAP] Scraping attempt ${attempt}/${this.config.MAX_RETRIES}`);
        
        const tabInfo = await browserManager.getAvailableTab('taptap');
        tabId = tabInfo.tabId;
        page = tabInfo.page;

        console.log('[TAPTAP] Loading ranking page...');
        await page.goto(this.config.TARGET_URL, { 
          waitUntil: 'domcontentloaded',
          timeout: this.timeouts.PAGE_LOAD 
        });

        await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);

        console.log(`[TAPTAP] Scrolling to load ${this.config.TARGET_RANK} games...`);
        const allGames = await this.scrollAndCollectGames(page);

        if (allGames.length === 0) {
          throw new Error('No games found');
        }

        // Limit to target rank
        const limitedGames = allGames.slice(0, this.config.TARGET_RANK);
        console.log(`[TAPTAP] Collected ${limitedGames.length} games (target: ${this.config.TARGET_RANK})`);

        const result = this.formatResult(limitedGames);
        await this.saveToFile(result);

        console.log(`[TAPTAP] Successfully scraped ${limitedGames.length} games`);
        return result;

      } catch (error) {
        console.error(`[TAPTAP] Attempt ${attempt} failed:`, error.message);
        
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

  async scrollAndCollectGames(page) {
    const allGames = [];
    let scrollAttempts = 0;
    let lastGameCount = 0;
    let noChangeCount = 0;

    while (allGames.length < this.config.TARGET_RANK && scrollAttempts < this.config.INFINITE_SCROLL.MAX_SCROLL_ATTEMPTS) {
      console.log(`[TAPTAP] Scroll attempt ${scrollAttempts + 1}, current games: ${allGames.length}/${this.config.TARGET_RANK}`);

      // Extract current games on page
      const currentGames = await this.extractGamesFromPage(page);
      
      // Add new games (avoid duplicates by rank)
      const existingRanks = new Set(allGames.map(game => game.rank));
      const newGames = currentGames.filter(game => !existingRanks.has(game.rank));
      
      allGames.push(...newGames);
      console.log(`[TAPTAP] Found ${newGames.length} new games, total: ${allGames.length}`);

      // Check if we have enough games
      if (allGames.length >= this.config.TARGET_RANK) {
        console.log(`[TAPTAP] Reached target rank ${this.config.TARGET_RANK}`);
        break;
      }

      // Check if no new games were loaded
      if (allGames.length === lastGameCount) {
        noChangeCount++;
        if (noChangeCount >= 3) {
          console.log('[TAPTAP] No new games loaded for 3 attempts, stopping scroll');
          break;
        }
      } else {
        noChangeCount = 0;
      }

      lastGameCount = allGames.length;

      // Scroll down to load more
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      // Wait for new content to load
      await page.waitForTimeout(this.config.INFINITE_SCROLL.SCROLL_DELAY);
      scrollAttempts++;
    }

    return allGames;
  }

  async extractGamesFromPage(page) {
    const games = await page.evaluate((selectors) => {
      const gameElements = document.querySelectorAll('[data-testid^="app-card-"], .app-card, .game-item, .ranking-item');
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

          // Extract title
          let title = null;
          const titleElement = gameElement.querySelector(selectors.title) ||
                             gameElement.querySelector('.app-title') ||
                             gameElement.querySelector('h3') ||
                             gameElement.querySelector('[class*="title"]');
          if (titleElement) {
            title = titleElement.textContent.trim();
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
    const filepath = path.join(__dirname, '../../../results/taptap', filename);

    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[TAPTAP] Results saved to: results/taptap/${filename}`);
    
    return filename;
  }
}

module.exports = TapTapRankingScraper;