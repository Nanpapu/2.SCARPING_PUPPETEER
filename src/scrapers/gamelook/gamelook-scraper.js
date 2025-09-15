const SCRAPER_CONFIGS = require('../../config/scraper-configs');
const PUPPETEER_CONFIG = require('../../config/puppeteer-config');
const browserManager = require('../../utils/browser-manager');
const fs = require('fs');
const path = require('path');

class GamelookScraper {
  constructor() {
    this.config = SCRAPER_CONFIGS.gamelook;
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
        console.log(`[GAMELOOK] Scraping attempt ${attempt}/${this.config.MAX_RETRIES}`);
        
        const tabInfo = await browserManager.getAvailableTab('gamelook');
        tabId = tabInfo.tabId;
        page = tabInfo.page;

        // Collect all links from multiple pages
        const allLinks = [];
        for (let pageNum = this.config.START_PAGE; pageNum <= this.config.END_PAGE; pageNum++) {
          const pageUrl = this.config.PAGE_URL_TEMPLATE.replace('{page}', pageNum);
          console.log(`[GAMELOOK] Loading page ${pageNum}: ${pageUrl}`);
          
          const pageLinks = await this.extractLinksFromPage(pageUrl);
          allLinks.push(...pageLinks);
          console.log(`[GAMELOOK] Found ${pageLinks.length} links from page ${pageNum}`);
        }

        if (allLinks.length === 0) {
          throw new Error('No links found from any pages');
        }

        console.log(`[GAMELOOK] Total found ${allLinks.length} links, extracting details in batches of ${this.config.BATCH_SIZE}...`);
        const detailedData = [];

        for (let i = 0; i < allLinks.length; i += this.config.BATCH_SIZE) {
          const batch = allLinks.slice(i, i + this.config.BATCH_SIZE);
          console.log(`[GAMELOOK] Processing batch ${Math.floor(i / this.config.BATCH_SIZE) + 1}/${Math.ceil(allLinks.length / this.config.BATCH_SIZE)} (${batch.length} links)`);
          
          const batchPromises = batch.map(async (link, index) => {
            try {
              console.log(`[GAMELOOK]   Processing link ${i + index + 1}/${allLinks.length}: ${link}`);
              const details = await this.extractLinkDetails(link);
              return details;
            } catch (error) {
              console.error(`[GAMELOOK]   Failed to extract details from ${link}:`, error.message);
              return {
                href: link,
                title: null,
                image: null,
                postingdate: null,
                description: null
              };
            }
          });

          const batchResults = await Promise.all(batchPromises);
          detailedData.push(...batchResults);
          
          if (i + this.config.BATCH_SIZE < allLinks.length) {
            console.log(`[GAMELOOK]   Waiting ${this.timeouts.BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.timeouts.BATCH_DELAY));
          }
        }

        const result = this.formatResult(detailedData);
        await this.saveToFile(result);

        console.log(`[GAMELOOK] Successfully scraped ${allLinks.length} links with details`);
        return result;

      } catch (error) {
        console.error(`[GAMELOOK] Attempt ${attempt} failed:`, error.message);
        
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

  async extractLinksFromPage(pageUrl) {
    const tabInfo = await browserManager.getAvailableTab('gamelook-page');
    const { tabId, page } = tabInfo;
    
    try {
      await page.setUserAgent(this.config.USER_AGENT);
      await page.setViewport({ width: 1366, height: 768 });
      
      await page.goto(pageUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_LOAD 
      });
      
      await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);

      const links = await page.$$eval(this.config.LINKS_SELECTOR, (elements) => {
        return elements.map(el => el.href);
      });

      return links;
    } finally {
      await browserManager.releaseTab(tabId);
    }
  }

  async extractLinkDetails(url) {
    const tabInfo = await browserManager.getAvailableTab('gamelook-detail');
    const { tabId, page } = tabInfo;
    
    try {
      await page.setUserAgent(this.config.USER_AGENT);
      await page.setViewport({ width: 1366, height: 768 });
      
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
          image: getAttribute(selectors.image, 'data-original'),
          postingdate: getTextContent(selectors.postingdate),
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
      source: `${this.config.BASE_URL} (pages ${this.config.START_PAGE}-${this.config.END_PAGE})`,
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
    
    const filename = `gamelook-${day}-${month}-${year}-${hours}-${minutes}.json`;
    const filepath = path.join(__dirname, '../../../results/gamelook', filename);

    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[GAMELOOK] Results saved to: results/gamelook/${filename}`);
    
    return filename;
  }
}

module.exports = GamelookScraper;