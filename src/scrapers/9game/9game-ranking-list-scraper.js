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
        const startTime = Date.now();

        // Add request interception for timing
        await page.setRequestInterception(true);
        let requestCount = 0;
        let responseCount = 0;

        page.on('request', (request) => {
          requestCount++;
          logger.info(`[NETWORK] Request #${requestCount}: ${request.method()} ${request.url().substring(0, 100)}...`);
          request.continue();
        });

        page.on('response', (response) => {
          responseCount++;
          logger.info(`[NETWORK] Response #${responseCount}: ${response.status()} ${response.url().substring(0, 100)}... (${Date.now() - startTime}ms)`);
        });

        try {
          await page.goto(this.config.TARGET_URL, {
            waitUntil: 'domcontentloaded',
            timeout: this.timeouts.PAGE_LOAD
          });

          const loadTime = Date.now() - startTime;
          logger.info(`[TIMING] Page loaded in ${loadTime}ms (${requestCount} requests, ${responseCount} responses)`);

        } catch (error) {
          const failTime = Date.now() - startTime;
          logger.error(`[TIMING] Page load FAILED after ${failTime}ms: ${error.message}`);
          throw error;
        }

        // Smart wait: check for content availability instead of fixed timeout
        logger.info('Waiting for ranking content to load...');
        const smartWaitStart = Date.now();
        await this.smartWaitForRankingContent(page);
        const smartWaitTime = Date.now() - smartWaitStart;
        logger.info(`[TIMING] Smart wait completed in ${smartWaitTime}ms`);

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
            const gameStartTime = Date.now();
            try {
              logger.info(`  Processing game ${i + index + 1}/${rankingData.length}: ${item.link}`);
              const details = await this.extractGameDetails(item.link, logger);
              const gameTime = Date.now() - gameStartTime;
              logger.info(`  ✓ Game completed in ${gameTime}ms`);
              return {
                rank: item.rank,
                link: item.link,
                ...details
              };
            } catch (error) {
              const gameTime = Date.now() - gameStartTime;
              logger.error(`  ✗ Game FAILED after ${gameTime}ms: ${item.link}${error.message ? ": " + error.message : ""}`);
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

  async smartWaitForRankingContent(page) {
    const startTime = Date.now();
    const maxWait = this.timeouts.SMART_WAIT_MAX;
    let checkCount = 0;

    while (Date.now() - startTime < maxWait) {
      try {
        checkCount++;
        const checkStart = Date.now();

        // Check if ranking elements are present
        const contentInfo = await page.evaluate((selectors) => {
          const rankElements = document.querySelectorAll(selectors.rank);
          const linkElements = document.querySelectorAll(selectors.link);

          // Get page state info
          const bodyHTML = document.body ? document.body.innerHTML.length : 0;
          const allElements = document.querySelectorAll('*').length;

          return {
            hasContent: rankElements.length > 0 && linkElements.length > 0,
            rankCount: rankElements.length,
            linkCount: linkElements.length,
            bodySize: bodyHTML,
            elementCount: allElements,
            title: document.title,
            readyState: document.readyState
          };
        }, this.config.RANKING_SELECTORS);

        const checkTime = Date.now() - checkStart;
        console.log(`[DEBUG] Check #${checkCount} (${checkTime}ms): ranks=${contentInfo.rankCount}, links=${contentInfo.linkCount}, bodySize=${contentInfo.bodySize}, elements=${contentInfo.elementCount}, readyState=${contentInfo.readyState}`);
        console.log(`[DEBUG] Page title: "${contentInfo.title}"`);

        if (contentInfo.hasContent) {
          const totalTime = Date.now() - startTime;
          console.log(`[SUCCESS] Content found after ${totalTime}ms, ${checkCount} checks`);
          await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);
          return;
        }
      } catch (error) {
        console.log(`[ERROR] Check #${checkCount} failed: ${error.message}`);
      }

      await page.waitForTimeout(200); // Check every 200ms
    }

    const totalTime = Date.now() - startTime;
    console.log(`[TIMEOUT] Smart wait exhausted after ${totalTime}ms, ${checkCount} checks`);

    // Final content check before giving up
    try {
      const finalCheck = await page.evaluate((selectors) => {
        const rankElements = document.querySelectorAll(selectors.rank);
        const linkElements = document.querySelectorAll(selectors.link);
        return {
          rankCount: rankElements.length,
          linkCount: linkElements.length,
          innerHTML: document.body ? document.body.innerHTML.substring(0, 500) : 'No body'
        };
      }, this.config.RANKING_SELECTORS);
      console.log(`[FINAL CHECK] ranks=${finalCheck.rankCount}, links=${finalCheck.linkCount}`);
      console.log(`[HTML SAMPLE] ${finalCheck.innerHTML}...`);
    } catch (error) {
      console.log(`[FINAL CHECK ERROR] ${error.message}`);
    }

    // Fallback to standard wait
    await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);
  }

  async smartWaitForGameContent(page) {
    const startTime = Date.now();
    const maxWait = this.timeouts.SMART_WAIT_MAX;

    while (Date.now() - startTime < maxWait) {
      try {
        // Check if any game content elements are present
        const hasContent = await page.evaluate((releasedSelectors, unreleasedSelectors) => {
          // Check for basic content indicators
          const titleElements = document.querySelectorAll('h1, .tit, [class*="title"]');
          const gameElements = document.querySelectorAll('[class*="game"], [class*="materials"]');

          return titleElements.length > 0 || gameElements.length > 0;
        }, this.config.DETAILS_SELECTORS.released, this.config.DETAILS_SELECTORS.unreleased);

        if (hasContent) {
          await page.waitForTimeout(this.timeouts.WAIT_AFTER_DETAIL); // Brief final wait
          return;
        }
      } catch (error) {
        // Continue waiting
      }

      await page.waitForTimeout(200); // Check every 200ms
    }

    // Fallback to standard wait if content not detected
    await page.waitForTimeout(this.timeouts.WAIT_AFTER_DETAIL);
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

      // Smart wait: check for game content instead of fixed timeout
      await this.smartWaitForGameContent(page);

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