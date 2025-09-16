const SCRAPER_CONFIGS = require('../../config/scraper-configs');
const PUPPETEER_CONFIG = require('../../config/puppeteer-config');
const browserManager = require('../../utils/browser-manager');
const fs = require('fs');
const path = require('path');

class BaiduScraper {
  constructor() {
    this.config = SCRAPER_CONFIGS.baidu;
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

        const tabInfo = await browserManager.getAvailableTab('baidu');
        tabId = tabInfo.tabId;
        page = tabInfo.page;

        logger.info('Loading Baidu ranking page...');
        await page.goto(this.config.TARGET_URL, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeouts.PAGE_LOAD
        });

        await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);

        logger.info('Waiting for main ranking container to load...');
        await page.waitForSelector(this.config.RANKING_SELECTORS.main_container, {
          timeout: this.timeouts.MAX_WAIT_FOR_CONTENT
        });

        logger.info('Extracting ranking data from all three columns...');
        const rankingData = await this.extractRankingData(page, logger);

        const result = this.formatResult(rankingData);
        await this.saveToFile(result);

        logger.info(`Successfully scraped ${rankingData.length} games from all ranking columns`);
        return result;

      } catch (error) {
        logger.error(`Attempt ${attempt} failed: ${error.message}`);

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

  async extractRankingData(page, logger) {
    const allRankingData = [];

    const columns = [
      { selector: this.config.RANKING_SELECTORS.annual_column, type: 'annual' },
      { selector: this.config.RANKING_SELECTORS.new_column, type: 'new' },
      { selector: this.config.RANKING_SELECTORS.upcoming_column, type: 'upcoming' }
    ];

    for (const column of columns) {
      logger.info(`Processing ${column.type} ranking column...`);

      try {
        await page.waitForSelector(column.selector, { timeout: 10000 });

        await this.clickLoadMoreButton(page, column.selector, logger);

        const columnData = await page.evaluate((columnSelector, typeListSelector, rankItemSelector, gameLinkSelector, rankSpanSelector, columnType) => {
          const columnElement = document.querySelector(columnSelector);
          if (!columnElement) {
            return [];
          }

          const typeListContent = columnElement.querySelector(typeListSelector);
          if (!typeListContent) {
            return [];
          }

          const rankItems = typeListContent.querySelectorAll(rankItemSelector);
          const games = [];

          rankItems.forEach(item => {
            const linkElement = item.querySelector(gameLinkSelector);
            const rankElement = item.querySelector(rankSpanSelector);

            if (linkElement && rankElement) {
              games.push({
                href: linkElement.href,
                rank: rankElement.textContent.trim(),
                type: columnType
              });
            }
          });

          return games;
        }, column.selector, this.config.RANKING_SELECTORS.type_list_content,
           this.config.RANKING_SELECTORS.rank_item, this.config.RANKING_SELECTORS.game_link,
           this.config.RANKING_SELECTORS.rank_span, column.type);

        logger.info(`Found ${columnData.length} games in ${column.type} column`);
        allRankingData.push(...columnData);

      } catch (error) {
        logger.error(`Failed to process ${column.type} column: ${error.message}`);
      }

      await page.waitForTimeout(1000);
    }

    return allRankingData;
  }

  async clickLoadMoreButton(page, columnSelector, logger) {
    try {
      const loadMoreExists = await page.evaluate((columnSelector, loadMoreSelector, verifyText) => {
        const columnElement = document.querySelector(columnSelector);
        if (!columnElement) return false;

        const loadMoreButton = columnElement.querySelector(loadMoreSelector);
        if (!loadMoreButton) return false;

        const hasCorrectText = loadMoreButton.textContent.includes(verifyText);
        return hasCorrectText;
      }, columnSelector, this.config.RANKING_SELECTORS.load_more_button, this.config.LOAD_MORE_SELECTORS.verify_text);

      if (loadMoreExists) {
        logger.info('Found "Load More" button, clicking to load full ranking...');

        await page.evaluate((columnSelector, loadMoreSelector) => {
          const columnElement = document.querySelector(columnSelector);
          const loadMoreButton = columnElement.querySelector(loadMoreSelector);
          if (loadMoreButton) {
            loadMoreButton.click();
          }
        }, columnSelector, this.config.RANKING_SELECTORS.load_more_button);

        await page.waitForTimeout(this.timeouts.WAIT_AFTER_CLICK);

        await page.waitForFunction((columnSelector, rankItemSelector) => {
          const columnElement = document.querySelector(columnSelector);
          if (!columnElement) return false;
          const items = columnElement.querySelectorAll(rankItemSelector);
          return items.length >= 40;
        }, { timeout: this.timeouts.WAIT_FOR_LOAD_MORE }, columnSelector, this.config.RANKING_SELECTORS.rank_item);

        logger.info('Successfully loaded more ranking items');
      } else {
        logger.info('No "Load More" button found, using existing items');
      }
    } catch (error) {
      logger.warn(`Failed to click load more button: ${error.message}`);
    }
  }

  formatResult(games) {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));

    return {
      timestamp: vietnamTime.toISOString().replace('Z', '+07:00'),
      source: this.config.TARGET_URL,
      data: games,
      total: games.length,
      summary: {
        annual: games.filter(g => g.type === 'annual').length,
        new: games.filter(g => g.type === 'new').length,
        upcoming: games.filter(g => g.type === 'upcoming').length
      }
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

    const filename = `baidu-${day}-${month}-${year}-${hours}-${minutes}.json`;
    const dirpath = path.join(__dirname, '../../../results/baidu');
    const filepath = path.join(dirpath, filename);

    await fs.promises.mkdir(dirpath, { recursive: true });
    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');

    return filename;
  }
}

module.exports = BaiduScraper;