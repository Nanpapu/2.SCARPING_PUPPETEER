const SCRAPER_CONFIGS = require('../../config/scraper-configs');
const PUPPETEER_CONFIG = require('../../config/puppeteer-config');
const browserManager = require('../../utils/browser-manager');
const fs = require('fs');
const path = require('path');

class NineGameRankingListScraper {
  constructor() {
    this.config = SCRAPER_CONFIGS['9game'];
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
        
        const tabInfo = await browserManager.getAvailableTab('9game');
        tabId = tabInfo.tabId;
        page = tabInfo.page;

        logger.info('Loading ranking page...');
        await page.goto(this.config.TARGET_URL, { 
          waitUntil: 'domcontentloaded',
          timeout: this.timeouts.PAGE_LOAD 
        });

        await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);

        logger.info('Extracting ranking data...');
        const rankingData = await this.extractRankingData(page);

        if (rankingData.length === 0) {
          throw new Error('No ranking data found');
        }

        logger.info(`Found ${rankingData.length} games, extracting details in batches of ${this.config.BATCH_SIZE}...`);
        const detailedData = [];

        for (let i = 0; i < rankingData.length; i += this.config.BATCH_SIZE) {
          const batch = rankingData.slice(i, i + this.config.BATCH_SIZE);
          logger.info(`Processing batch ${Math.floor(i / this.config.BATCH_SIZE) + 1}/${Math.ceil(rankingData.length / this.config.BATCH_SIZE)} (${batch.length} games)`);
          
          const batchPromises = batch.map(async (item, index) => {
            try {
              logger.info(`  Processing game ${i + index + 1}/${rankingData.length}: ${item.link}`);
              const details = await this.extractGameDetails(item.link, logger);
              return {
                rank: item.rank,
                link: item.link,
                ...details
              };
            } catch (error) {
              logger.error(`  Failed to extract details from ${item.link}:${error.message ? ": " + error.message : ""}`);
              return {
                rank: item.rank,
                link: item.link,
                namegame: null,
                day: null,
                anh: null,
                theloai: null,
                description: null
              };
            }
          });

          const batchResults = await Promise.all(batchPromises);
          detailedData.push(...batchResults);
          
          if (i + this.config.BATCH_SIZE < rankingData.length) {
            logger.info(`  Waiting ${this.timeouts.BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.timeouts.BATCH_DELAY));
          }
        }

        const result = this.formatResult(detailedData);
        await this.saveToFile(result);

        logger.info(`Successfully scraped ${rankingData.length} games with details`);
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

  async extractRankingData(page) {
    const rankingData = await page.evaluate((selectors) => {
      const rankElements = document.querySelectorAll(selectors.rank);
      const linkElements = document.querySelectorAll(selectors.link);
      
      const results = [];
      const minLength = Math.min(rankElements.length, linkElements.length);
      
      for (let i = 0; i < minLength; i++) {
        const rank = rankElements[i].textContent.trim();
        const link = linkElements[i].href;
        
        if (rank && link) {
          results.push({ rank, link });
        }
      }
      
      return results;
    }, this.config.RANKING_SELECTORS);

    return rankingData;
  }

  async extractGameDetails(url, logger = console) {
    const tabInfo = await browserManager.getAvailableTab('9game-detail');
    const { tabId, page } = tabInfo;
    
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.DETAIL_LOAD
      });
      
      await page.waitForTimeout(this.timeouts.WAIT_AFTER_DETAIL);

      // First try released game selectors
      let details = await this.tryExtractDetails(page, this.config.DETAILS_SELECTORS.released, url);

      // If day is null/empty, try unreleased game selectors
      if (!details.day) {
        logger.info(`    Game appears unreleased, trying unreleased selectors...`);
        details = await this.tryExtractDetails(page, this.config.DETAILS_SELECTORS.unreleased, url);
      }

      return details;
    } finally {
      await browserManager.releaseTab(tabId);
    }
  }

  async tryExtractDetails(page, selectors, url) {
    return await page.evaluate((selectors, url) => {
      const getTextContent = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : null;
      };

      const getTextContentFromMultiple = (selectorArray) => {
        for (const selector of selectorArray) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim()) {
            return element.textContent.trim();
          }
        }
        return null;
      };

      const getAttribute = (selector, attribute) => {
        const element = document.querySelector(selector);
        return element ? element.getAttribute(attribute) : null;
      };

      const getAllTextContent = (selector) => {
        const elements = document.querySelectorAll(selector);
        return Array.from(elements).map(el => el.textContent.trim()).filter(text => text);
      };

      // Extract namegame
      let namegame = null;
      if (Array.isArray(selectors.namegame)) {
        namegame = getTextContentFromMultiple(selectors.namegame);
      } else {
        namegame = getTextContent(selectors.namegame);
      }

      // Extract other fields
      const day = getTextContent(selectors.day);
      const anh = getAttribute(selectors.anh, 'src');
      const theloai = getAllTextContent(selectors.theloai);
      const description = getAllTextContent(selectors.description);

      return {
        namegame,
        day,
        anh,
        theloai,
        description
      };
    }, selectors, url);
  }

  formatResult(games) {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    
    return {
      timestamp: vietnamTime.toISOString().replace('Z', '+07:00'),
      source: this.config.TARGET_URL,
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
    
    const filename = `9game-ranking-${day}-${month}-${year}-${hours}-${minutes}.json`;
    const dirpath = path.join(__dirname, '../../../results/9game');
    const filepath = path.join(dirpath, filename);

    // Auto-create directory if it doesn't exist
    await fs.promises.mkdir(dirpath, { recursive: true });
    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    // Results saved message will be logged by the main server
    
    return filename;
  }
}

module.exports = NineGameRankingListScraper;