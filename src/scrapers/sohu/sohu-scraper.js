const SCRAPER_CONFIGS = require('../../config/scraper-configs');
const PUPPETEER_CONFIG = require('../../config/puppeteer-config');
const browserManager = require('../../utils/browser-manager');
const fs = require('fs');
const path = require('path');

class SohuScraper {
  constructor() {
    this.config = SCRAPER_CONFIGS.sohu;
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
        
        const tabInfo = await browserManager.getAvailableTab('sohu');
        tabId = tabInfo.tabId;
        page = tabInfo.page;

        logger.info('Loading sohu.com...');
        await page.goto(this.config.TARGET_URL, { 
          waitUntil: 'domcontentloaded',
          timeout: this.timeouts.PAGE_LOAD 
        });

        await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);

        logger.info('Extracting links...');
        const links = await page.$$eval(this.config.LINKS_SELECTOR, (elements) => {
          return elements.map(el => el.href);
        });

        if (links.length === 0) {
          throw new Error('No links found with the specified selector');
        }

        logger.info(`Found ${links.length} links, extracting details in batches of ${this.config.BATCH_SIZE}...`);
        const detailedData = [];

        for (let i = 0; i < links.length; i += this.config.BATCH_SIZE) {
          const batch = links.slice(i, i + this.config.BATCH_SIZE);
          logger.info(`Processing batch ${Math.floor(i / this.config.BATCH_SIZE) + 1}/${Math.ceil(links.length / this.config.BATCH_SIZE)} (${batch.length} links)`);
          
          const batchPromises = batch.map(async (link, index) => {
            try {
              logger.info(`  Processing link ${i + index + 1}/${links.length}: ${link}`);
              const details = await this.extractLinkDetails(link);
              return details;
            } catch (error) {
              logger.error(`  Failed to extract details from ${link}: ${error.message}`);
              return {
                href: link,
                title: null,
                time: null,
                location: null,
                image: null,
                description: null
              };
            }
          });

          const batchResults = await Promise.all(batchPromises);
          detailedData.push(...batchResults);
          
          if (i + this.config.BATCH_SIZE < links.length) {
            logger.info(`  Waiting ${this.timeouts.BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.timeouts.BATCH_DELAY));
          }
        }

        const result = this.formatResult(detailedData);
        await this.saveToFile(result);

        logger.info(`Successfully scraped ${links.length} links with details`);
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

  async extractLinkDetails(url) {
    const tabInfo = await browserManager.getAvailableTab('sohu-detail');
    const { tabId, page } = tabInfo;
    
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.DETAIL_LOAD 
      });
      
      await page.waitForTimeout(this.timeouts.WAIT_AFTER_DETAIL);

      const details = await page.evaluate((url, selectors) => {
        const getTextContent = (selector) => {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : null;
        };

        const getAttribute = (selector, attribute) => {
          const element = document.querySelector(selector);
          return element ? element.getAttribute(attribute) : null;
        };

        return {
          href: url,
          title: getTextContent(selectors.title),
          time: getTextContent(selectors.time),
          location: getTextContent(selectors.location),
          image: getAttribute(selectors.image, 'src'),
          description: getAttribute(selectors.description, 'content')
        };
      }, url, this.config.DETAILS_SELECTORS);

      return details;
    } finally {
      await browserManager.releaseTab(tabId);
    }
  }

  formatResult(links) {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    
    return {
      timestamp: vietnamTime.toISOString().replace('Z', '+07:00'),
      source: this.config.TARGET_URL,
      data: links,
      total: links.length
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
    
    const filename = `sohu-${day}-${month}-${year}-${hours}-${minutes}.json`;
    const filepath = path.join(__dirname, '../../../results/sohu', filename);

    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    // Results saved message will be logged by the main server
    
    return filename;
  }
}

module.exports = SohuScraper;