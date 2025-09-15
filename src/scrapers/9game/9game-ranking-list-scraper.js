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
    const pollInterval = this.timeouts.POLL_INTERVAL;
    let checkCount = 0;

    console.log(`[POLLING] Starting smart wait for div.box-text table, checking every ${pollInterval}ms for max ${maxWait}ms`);

    while (Date.now() - startTime < maxWait) {
      try {
        checkCount++;
        const checkStart = Date.now();

        // Check if box-text div and table structure are present
        const contentInfo = await page.evaluate((selectors) => {
          // Look for the box-text indicator first
          const boxTextDiv = document.querySelector(selectors.table_indicator);

          if (!boxTextDiv) {
            return {
              hasBoxText: false,
              hasTable: false,
              hasContent: false,
              boxTextCount: 0,
              tableCount: 0,
              rowCount: 0,
              rankCount: 0,
              linkCount: 0,
              bodySize: document.body ? document.body.innerHTML.length : 0,
              elementCount: document.querySelectorAll('*').length,
              title: document.title,
              readyState: document.readyState
            };
          }

          // Look for table inside box-text
          const tableContainer = document.querySelector(selectors.table_container);
          if (!tableContainer) {
            return {
              hasBoxText: true,
              hasTable: false,
              hasContent: false,
              boxTextCount: 1,
              tableCount: 0,
              rowCount: 0,
              rankCount: 0,
              linkCount: 0,
              bodySize: document.body ? document.body.innerHTML.length : 0,
              elementCount: document.querySelectorAll('*').length,
              title: document.title,
              readyState: document.readyState
            };
          }

          // Count rows (excluding th header)
          const allRows = tableContainer.querySelectorAll('tr');
          const dataRows = Array.from(allRows).filter(row => !row.querySelector('th'));

          // Count rank and link elements
          const rankElements = tableContainer.querySelectorAll(selectors.rank_cell);
          const linkElements = tableContainer.querySelectorAll(selectors.link_cell);

          return {
            hasBoxText: true,
            hasTable: true,
            hasContent: rankElements.length > 0 && linkElements.length > 0,
            boxTextCount: 1,
            tableCount: 1,
            rowCount: dataRows.length,
            rankCount: rankElements.length,
            linkCount: linkElements.length,
            bodySize: document.body ? document.body.innerHTML.length : 0,
            elementCount: document.querySelectorAll('*').length,
            title: document.title,
            readyState: document.readyState
          };
        }, this.config.RANKING_SELECTORS);

        const checkTime = Date.now() - checkStart;
        console.log(`[POLL] Check #${checkCount} (${checkTime}ms): boxText=${contentInfo.hasBoxText}, table=${contentInfo.hasTable}, rows=${contentInfo.rowCount}, ranks=${contentInfo.rankCount}, links=${contentInfo.linkCount}`);
        console.log(`[POLL] Page state: bodySize=${contentInfo.bodySize}, elements=${contentInfo.elementCount}, readyState=${contentInfo.readyState}, title="${contentInfo.title}"`);

        if (contentInfo.hasContent && contentInfo.rowCount > 0) {
          const totalTime = Date.now() - startTime;
          console.log(`[SUCCESS] Table content found after ${totalTime}ms, ${checkCount} checks! Found ${contentInfo.rowCount} data rows.`);
          await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);
          return;
        }
      } catch (error) {
        console.log(`[ERROR] Poll check #${checkCount} failed: ${error.message}`);
      }

      await page.waitForTimeout(pollInterval); // Check every 1 second
    }

    const totalTime = Date.now() - startTime;
    console.log(`[TIMEOUT] Smart wait exhausted after ${totalTime}ms, ${checkCount} checks`);

    // Final detailed check before giving up
    try {
      const finalCheck = await page.evaluate((selectors) => {
        const boxTextDiv = document.querySelector(selectors.table_indicator);
        const tableContainer = document.querySelector(selectors.table_container);
        const rankElements = document.querySelectorAll(selectors.rank_cell);
        const linkElements = document.querySelectorAll(selectors.link_cell);

        return {
          boxTextFound: !!boxTextDiv,
          tableFound: !!tableContainer,
          rankCount: rankElements.length,
          linkCount: linkElements.length,
          innerHTML: document.body ? document.body.innerHTML.substring(0, 1000) : 'No body'
        };
      }, this.config.RANKING_SELECTORS);

      console.log(`[FINAL CHECK] boxText=${finalCheck.boxTextFound}, table=${finalCheck.tableFound}, ranks=${finalCheck.rankCount}, links=${finalCheck.linkCount}`);
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
      console.log('[EXTRACT] Starting table data extraction...');

      // First find the table container
      const tableContainer = document.querySelector(selectors.table_container);
      if (!tableContainer) {
        console.log('[EXTRACT] No table container found with selector:', selectors.table_container);
        return [];
      }

      console.log('[EXTRACT] Found table container, looking for rows...');

      // Get all rows in tbody, excluding th headers
      const allRows = tableContainer.querySelectorAll('tr');
      const dataRows = Array.from(allRows).filter(row => !row.querySelector('th'));

      console.log(`[EXTRACT] Found ${dataRows.length} data rows (excluding headers)`);

      const results = [];

      dataRows.forEach((row, index) => {
        try {
          // Find rank cell (td.num span)
          const rankCell = row.querySelector('td.num');
          const rankSpan = rankCell ? rankCell.querySelector('span') : null;
          const rank = rankSpan ? rankSpan.textContent.trim() : null;

          // Find link cell (td.name a)
          const linkCell = row.querySelector('td.name');
          const linkElement = linkCell ? linkCell.querySelector('a') : null;
          const link = linkElement ? linkElement.href : null;

          console.log(`[EXTRACT] Row ${index + 1}: rank="${rank}", link="${link ? link.substring(0, 50) + '...' : 'null'}"`);

          if (rank && link) {
            results.push({ rank, link });
          } else {
            console.log(`[EXTRACT] Row ${index + 1} SKIPPED: missing rank or link`);
          }
        } catch (error) {
          console.log(`[EXTRACT] Error processing row ${index + 1}:`, error.message);
        }
      });

      console.log(`[EXTRACT] Successfully extracted ${results.length} ranking entries`);
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