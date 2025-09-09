// GAMELOOK.COM.CN SCRAPER CONFIGURATION
const SCRAPER_CONFIG = {
  BATCH_SIZE: 50,
  MAX_RETRIES: 3,
  START_PAGE: 1,
  END_PAGE: 2,
  BASE_URL: 'http://www.gamelook.com.cn',
  PAGE_URL_TEMPLATE: 'http://www.gamelook.com.cn/page/{page}/',
  LINKS_SELECTOR: 'h2.item-title a',
  DETAILS_SELECTORS: {
    title: 'h1',
    image: 'div.entry img',
    postingdate: 'span',
    description: 'meta[name="description"]'
  },
  TIMEOUTS: {
    PAGE_LOAD: 300000,
    DETAIL_LOAD: 300000,
    WAIT_AFTER_LOAD: 30000,
    WAIT_AFTER_DETAIL: 5000,
    BATCH_DELAY: 2000,
    RETRY_DELAY: 2000
  },
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  USE_PUPPETEER: true
};

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class GamelookScraper {
  constructor() {
    this.config = SCRAPER_CONFIG;
  }

  async scrape() {
    let browser = null;
    let attempt = 1;

    while (attempt <= this.config.MAX_RETRIES) {
      try {
        console.log(`[GAMELOOK] Scraping attempt ${attempt}/${this.config.MAX_RETRIES}`);
        
        browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-features=VizDisplayCompositor',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-sync'
          ].concat(process.env.NODE_ENV === 'development' ? [] : ['--no-zygote', '--single-process']),
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        // Collect all links from multiple pages
        const allLinks = [];
        for (let pageNum = this.config.START_PAGE; pageNum <= this.config.END_PAGE; pageNum++) {
          const pageUrl = this.config.PAGE_URL_TEMPLATE.replace('{page}', pageNum);
          console.log(`[GAMELOOK] Loading page ${pageNum}: ${pageUrl}`);
          
          const pageLinks = await this.extractLinksFromPage(browser, pageUrl);
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
              const details = await this.extractLinkDetails(browser, link);
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
            console.log(`[GAMELOOK]   Waiting ${this.config.TIMEOUTS.BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.config.TIMEOUTS.BATCH_DELAY));
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
        await new Promise(resolve => setTimeout(resolve, this.config.TIMEOUTS.RETRY_DELAY));
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    }
  }

  async extractLinksFromPage(browser, pageUrl) {
    const page = await browser.newPage();
    
    try {
      await page.setUserAgent(this.config.USER_AGENT);
      await page.setViewport({ width: 1366, height: 768 });
      
      await page.goto(pageUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: this.config.TIMEOUTS.PAGE_LOAD 
      });
      
      await page.waitForTimeout(this.config.TIMEOUTS.WAIT_AFTER_LOAD);

      const links = await page.$$eval(this.config.LINKS_SELECTOR, (elements) => {
        return elements.map(el => el.href);
      });

      return links;
    } finally {
      await page.close();
    }
  }

  async extractLinkDetails(browser, url) {
    const page = await browser.newPage();
    
    try {
      await page.setUserAgent(this.config.USER_AGENT);
      await page.setViewport({ width: 1366, height: 768 });
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: this.config.TIMEOUTS.DETAIL_LOAD
      });
      
      await page.waitForTimeout(this.config.TIMEOUTS.WAIT_AFTER_DETAIL);

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
      await page.close();
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