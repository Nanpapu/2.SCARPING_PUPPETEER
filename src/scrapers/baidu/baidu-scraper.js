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

        logger.info('Waiting for parent container to load...');
        await page.waitForSelector(this.config.RANKING_SELECTORS.parent_container, {
          timeout: this.timeouts.MAX_WAIT_FOR_CONTENT
        });

        logger.info('Selecting mobile games tab...');
        await this.selectMobileTab(page, logger);

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

  async selectMobileTab(page, logger) {
    try {
      logger.info('Looking for mobile games tab...');

      await page.waitForSelector(this.config.TAB_SELECTORS.tab_container, { timeout: 10000 });

      const mobileTabFound = await page.evaluate((tabContainer, tabItems, mobileValue, mobileText) => {
        const container = document.querySelector(tabContainer);
        if (!container) return false;

        const tabs = container.querySelectorAll(tabItems);
        for (const tab of tabs) {
          const hasValue = tab.querySelector(`div[value="${mobileValue}"]`);
          const hasText = tab.textContent.includes(mobileText);

          if (hasValue && hasText) {
            tab.click();
            return true;
          }
        }
        return false;
      }, this.config.TAB_SELECTORS.tab_container, this.config.TAB_SELECTORS.tab_items,
         this.config.TAB_SELECTORS.mobile_tab_value, this.config.TAB_SELECTORS.mobile_tab_text);

      if (mobileTabFound) {
        logger.info('Successfully clicked mobile games tab (手机游戏)');
        await page.waitForTimeout(this.timeouts.WAIT_FOR_TAB_CLICK);
      } else {
        logger.warn('Mobile games tab not found, proceeding with default tab');
      }
    } catch (error) {
      logger.error(`Failed to select mobile tab: ${error.message}`);
    }
  }

  async extractRankingData(page, logger) {
    logger.info('Looking for Load More button to load full rankings...');
    await this.clickLoadMoreButton(page, logger);

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

    logger.info(`Extracting detailed information for ${allRankingData.length} games...`);
    const detailedGameData = [];

    for (let i = 0; i < allRankingData.length; i += this.config.BATCH_SIZE) {
      const batch = allRankingData.slice(i, i + this.config.BATCH_SIZE);
      logger.info(`Processing game details batch ${Math.floor(i / this.config.BATCH_SIZE) + 1}/${Math.ceil(allRankingData.length / this.config.BATCH_SIZE)} (${batch.length} games)`);

      const batchPromises = batch.map(async (game, index) => {
        try {
          logger.info(`  Processing game ${i + index + 1}/${allRankingData.length}: ${game.href}`);
          const details = await this.extractGameDetails(game.href);
          return {
            ...game,
            ...details
          };
        } catch (error) {
          logger.error(`  Failed to extract details from ${game.href}: ${error.message}`);
          return {
            ...game,
            chinese_name: null,
            english_name: null,
            game_icon: null,
            tags: null,
            manufacturer: null,
            release_date: null,
            publisher: null
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      detailedGameData.push(...batchResults);

      if (i + this.config.BATCH_SIZE < allRankingData.length) {
        logger.info(`  Waiting ${this.timeouts.BATCH_DELAY}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, this.timeouts.BATCH_DELAY));
      }
    }

    return detailedGameData;
  }

  async clickLoadMoreButton(page, logger) {
    try {
      let loadMoreFound = false;
      let scrollAttempts = 0;
      const maxScrollAttempts = 10;

      while (!loadMoreFound && scrollAttempts < maxScrollAttempts) {
        const loadMoreExists = await page.evaluate((parentSelector, loadMoreSelector, verifyText) => {
          const parentElement = document.querySelector(parentSelector);
          if (!parentElement) return false;

          const loadMoreButton = parentElement.querySelector(loadMoreSelector);
          if (!loadMoreButton) return false;

          const hasCorrectText = loadMoreButton.textContent.includes(verifyText);
          const isVisible = loadMoreButton.offsetParent !== null;
          return hasCorrectText && isVisible;
        }, this.config.RANKING_SELECTORS.parent_container, this.config.RANKING_SELECTORS.load_more_button, this.config.LOAD_MORE_SELECTORS.verify_text);

        if (loadMoreExists) {
          logger.info('Found "Load More" button, clicking to load full ranking...');
          loadMoreFound = true;

          await page.evaluate((parentSelector, loadMoreSelector) => {
            const parentElement = document.querySelector(parentSelector);
            const loadMoreButton = parentElement.querySelector(loadMoreSelector);
            if (loadMoreButton) {
              loadMoreButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => loadMoreButton.click(), 500);
            }
          }, this.config.RANKING_SELECTORS.parent_container, this.config.RANKING_SELECTORS.load_more_button);

          await page.waitForTimeout(this.timeouts.WAIT_AFTER_CLICK);

          await page.waitForFunction((parentSelector, rankItemSelector) => {
            const parentElement = document.querySelector(parentSelector);
            if (!parentElement) return false;
            const items = parentElement.querySelectorAll(rankItemSelector);
            return items.length >= 120;
          }, { timeout: this.timeouts.WAIT_FOR_LOAD_MORE }, this.config.RANKING_SELECTORS.parent_container, this.config.RANKING_SELECTORS.rank_item);

          logger.info('Successfully loaded more ranking items');
        } else {
          logger.info(`Scroll attempt ${scrollAttempts + 1}/${maxScrollAttempts}: Load More button not found, scrolling down...`);

          await page.evaluate(() => {
            window.scrollBy(0, 300);
          });

          await page.waitForTimeout(1000);
          scrollAttempts++;
        }
      }

      if (!loadMoreFound) {
        logger.info('Load More button not found after scrolling, using existing items');
      }
    } catch (error) {
      logger.warn(`Failed to click load more button: ${error.message}`);
    }
  }

  async extractGameDetails(url) {
    const tabInfo = await browserManager.getAvailableTab('baidu-detail');
    const { tabId, page } = tabInfo;

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.DETAIL_LOAD
      });

      await page.waitForTimeout(this.timeouts.WAIT_AFTER_DETAIL);

      await page.waitForSelector(this.config.GAME_DETAIL_SELECTORS.main_left_area, {
        timeout: this.timeouts.MAX_WAIT_FOR_CONTENT
      });

      const details = await page.evaluate((selectors) => {
        const getTextContent = (selector, parent = document) => {
          const element = parent.querySelector(selector);
          return element ? element.textContent.trim() : null;
        };

        const getAttribute = (selector, attribute, parent = document) => {
          const element = parent.querySelector(selector);
          return element ? element.getAttribute(attribute) : null;
        };

        const mainLeftArea = document.querySelector(selectors.main_left_area);
        if (!mainLeftArea) return {};

        const gameIcon = getAttribute(selectors.game_icon, 'data-src', mainLeftArea);
        const chineseName = getTextContent(selectors.chinese_name, mainLeftArea);
        const englishName = getTextContent(selectors.english_name, mainLeftArea);

        const platTagsContainer = mainLeftArea.querySelector(selectors.plat_tags_container);
        let tags = null;
        if (platTagsContainer) {
          const tagElements = platTagsContainer.querySelectorAll(selectors.type_tags);
          if (tagElements.length > 0) {
            tags = Array.from(tagElements).map(tag => tag.textContent.trim()).join(', ');
          }
        }

        const rightBox = document.querySelector(selectors.right_box);
        let manufacturer = null;
        let releaseDate = null;
        let publisher = null;

        if (rightBox) {
          const officialCert = rightBox.querySelector(selectors.official_certification);
          if (officialCert) {
            const manufacturerTags = officialCert.querySelectorAll(selectors.manufacturer_container);
            for (const tag of manufacturerTags) {
              const tagName = getTextContent(selectors.manufacturer_name, tag);
              if (tagName && tagName.includes('厂商：')) {
                manufacturer = getTextContent(selectors.manufacturer_content, tag);
                break;
              }
            }
          }

          const platInfoWrapper = rightBox.querySelector(selectors.plats_info_wrapper);
          if (platInfoWrapper) {
            const platInfoWrap = platInfoWrapper.querySelector(selectors.plats_info_wrap);
            if (platInfoWrap) {
              const platInfoBox = platInfoWrap.querySelector(selectors.plats_info_box);
              if (platInfoBox) {
                const infoTags = platInfoBox.querySelectorAll(selectors.info_tags);
                for (const tag of infoTags) {
                  const tagName = getTextContent(selectors.tag_name, tag);
                  const tagContent = tag.querySelector(selectors.tag_content);

                  if (tagName && tagContent) {
                    if (tagName.includes('发行时间')) {
                      const span = tagContent.querySelector('span');
                      releaseDate = span ? span.textContent.trim() : tagContent.textContent.trim();
                    } else if (tagName.includes('发行商')) {
                      publisher = tagContent.textContent.trim();
                    }
                  }
                }
              }
            }
          }
        }

        return {
          chinese_name: chineseName,
          english_name: englishName,
          game_icon: gameIcon,
          tags: tags,
          manufacturer: manufacturer,
          release_date: releaseDate,
          publisher: publisher
        };
      }, this.config.GAME_DETAIL_SELECTORS);

      return details;
    } finally {
      await browserManager.releaseTab(tabId);
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