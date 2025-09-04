// SOHU.COM SCRAPER CONFIGURATION
const SCRAPER_CONFIG = {
  BATCH_SIZE: 50,
  MAX_RETRIES: 3,
  TARGET_URL: 'https://www.sohu.com/',
  LINKS_SELECTOR: 'ul.news[data-spm="top-news1"] a.titleStyle',
  DETAILS_SELECTORS: {
    title: 'h1',
    time: 'span#news-time',
    location: 'div.area > span:last-child',
    image: 'img',
    description: 'meta[name="description"]'
  },
  TIMEOUTS: {
    PAGE_LOAD: 30000,
    DETAIL_LOAD: 15000,
    WAIT_AFTER_LOAD: 3000,
    WAIT_AFTER_DETAIL: 2000,
    BATCH_DELAY: 2000,
    RETRY_DELAY: 2000
  },
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  USE_PUPPETEER: true
};

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class SohuScraper {
  constructor() {
    this.config = SCRAPER_CONFIG;
  }

  async scrape() {
    let browser = null;
    let attempt = 1;

    while (attempt <= this.config.MAX_RETRIES) {
      try {
        console.log(`[SOHU] Scraping attempt ${attempt}/${this.config.MAX_RETRIES}`);
        
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

        const page = await browser.newPage();
        
        await page.setUserAgent(this.config.USER_AGENT);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('[SOHU] Loading sohu.com...');
        await page.goto(this.config.TARGET_URL, { 
          waitUntil: 'domcontentloaded',
          timeout: this.config.TIMEOUTS.PAGE_LOAD 
        });

        await page.waitForTimeout(this.config.TIMEOUTS.WAIT_AFTER_LOAD);

        console.log('[SOHU] Extracting links...');
        const links = await page.$$eval(this.config.LINKS_SELECTOR, (elements) => {
          return elements.map(el => el.href);
        });

        if (links.length === 0) {
          throw new Error('No links found with the specified selector');
        }

        console.log(`[SOHU] Found ${links.length} links, extracting details in batches of ${this.config.BATCH_SIZE}...`);
        const detailedData = [];

        for (let i = 0; i < links.length; i += this.config.BATCH_SIZE) {
          const batch = links.slice(i, i + this.config.BATCH_SIZE);
          console.log(`[SOHU] Processing batch ${Math.floor(i / this.config.BATCH_SIZE) + 1}/${Math.ceil(links.length / this.config.BATCH_SIZE)} (${batch.length} links)`);
          
          const batchPromises = batch.map(async (link, index) => {
            try {
              console.log(`[SOHU]   Processing link ${i + index + 1}/${links.length}: ${link}`);
              const details = await this.extractLinkDetails(browser, link);
              return details;
            } catch (error) {
              console.error(`[SOHU]   Failed to extract details from ${link}:`, error.message);
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
            console.log(`[SOHU]   Waiting ${this.config.TIMEOUTS.BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.config.TIMEOUTS.BATCH_DELAY));
          }
        }

        const result = this.formatResult(detailedData);
        await this.saveToFile(result);

        console.log(`[SOHU] Successfully scraped ${links.length} links with details`);
        return result;

      } catch (error) {
        console.error(`[SOHU] Attempt ${attempt} failed:`, error.message);
        
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
          time: getTextContent(selectors.time),
          location: getTextContent(selectors.location),
          image: getAttribute(selectors.image, 'src'),
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
    console.log(`[SOHU] Results saved to: results/sohu/${filename}`);
    
    return filename;
  }
}

module.exports = SohuScraper;