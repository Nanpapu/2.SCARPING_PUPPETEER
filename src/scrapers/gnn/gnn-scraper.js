// GNN.GAMER.COM.TW SCRAPER CONFIGURATION
const SCRAPER_CONFIG = {
  BATCH_SIZE: 30,
  MAX_RETRIES: 3,
  CATEGORIES: [
    { url: 'https://gnn.gamer.com.tw/index.php?k=4', source: '手機' },
    { url: 'https://gnn.gamer.com.tw/index.php?k=1', source: 'PC' },
    { url: 'https://gnn.gamer.com.tw/index.php?k=3', source: 'TV 掌機' },
    { url: 'https://gnn.gamer.com.tw/index.php?k=5', source: '動漫畫' },
    { url: 'https://gnn.gamer.com.tw/index.php?k=13', source: '電競' },
    { url: 'https://gnn.gamer.com.tw/index.php?k=11', source: '活動展覽' },
    { url: 'https://gnn.gamer.com.tw/index.php?k=9', source: '主題報導' }
  ],
  LINKS_SELECTOR: 'a[href*="gnn.gamer.com.tw/detail.php?sn="]',
  DETAILS_SELECTORS: {
    title: 'h1',
    time: 'span.GN-lbox3C',
    category: 'ul.platform-tag li a',
    hashtag: 'div.GN-lbox3B a',
    image: 'img[name="gnnPIC"]'
  },
  TIMEOUTS: {
    PAGE_LOAD: 30000,
    DETAIL_LOAD: 30000,
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

class GnnScraper {
  constructor() {
    this.config = SCRAPER_CONFIG;
  }

  async scrape() {
    let browser = null;
    let attempt = 1;

    while (attempt <= this.config.MAX_RETRIES) {
      try {
        console.log(`[GNN] Scraping attempt ${attempt}/${this.config.MAX_RETRIES}`);
        
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

        // Collect all links from all categories
        const allLinks = [];
        for (const category of this.config.CATEGORIES) {
          console.log(`[GNN] Processing category: ${category.source}`);
          
          const categoryLinks = await this.extractLinksFromCategory(browser, category);
          allLinks.push(...categoryLinks);
          console.log(`[GNN] Found ${categoryLinks.length} links from ${category.source}`);
        }

        if (allLinks.length === 0) {
          throw new Error('No links found from any categories');
        }

        console.log(`[GNN] Total found ${allLinks.length} links, extracting details in batches of ${this.config.BATCH_SIZE}...`);
        const detailedData = [];

        for (let i = 0; i < allLinks.length; i += this.config.BATCH_SIZE) {
          const batch = allLinks.slice(i, i + this.config.BATCH_SIZE);
          console.log(`[GNN] Processing batch ${Math.floor(i / this.config.BATCH_SIZE) + 1}/${Math.ceil(allLinks.length / this.config.BATCH_SIZE)} (${batch.length} links)`);
          
          const batchPromises = batch.map(async (linkData, index) => {
            try {
              console.log(`[GNN]   Processing link ${i + index + 1}/${allLinks.length}: ${linkData.link}`);
              const details = await this.extractLinkDetails(browser, linkData.link);
              return {
                source: linkData.source,
                link: linkData.link,
                ...details
              };
            } catch (error) {
              console.error(`[GNN]   Failed to extract details from ${linkData.link}:`, error.message);
              return {
                source: linkData.source,
                link: linkData.link,
                title: null,
                time: null,
                category: null,
                hashtag: null,
                image: null
              };
            }
          });

          const batchResults = await Promise.all(batchPromises);
          detailedData.push(...batchResults);
          
          if (i + this.config.BATCH_SIZE < allLinks.length) {
            console.log(`[GNN]   Waiting ${this.config.TIMEOUTS.BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.config.TIMEOUTS.BATCH_DELAY));
          }
        }

        const result = this.formatResult(detailedData);
        await this.saveToFile(result);

        console.log(`[GNN] Successfully scraped ${allLinks.length} links with details`);
        return result;

      } catch (error) {
        console.error(`[GNN] Attempt ${attempt} failed:`, error.message);
        
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

  async extractLinksFromCategory(browser, category) {
    const page = await browser.newPage();
    
    try {
      await page.setUserAgent(this.config.USER_AGENT);
      await page.setViewport({ width: 1366, height: 768 });
      
      await page.goto(category.url, { 
        waitUntil: 'domcontentloaded',
        timeout: this.config.TIMEOUTS.PAGE_LOAD 
      });
      
      await page.waitForTimeout(this.config.TIMEOUTS.WAIT_AFTER_LOAD);

      const links = await page.$$eval(this.config.LINKS_SELECTOR, (elements) => {
        return elements.map(el => el.href);
      });

      // Add source to each link
      return links.map(link => ({
        link: link,
        source: category.source
      }));
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

        const getAllTextContent = (selector) => {
          const elements = document.querySelectorAll(selector);
          return Array.from(elements).map(el => el.textContent.trim()).filter(text => text);
        };

        return {
          title: getTextContent(selectors.title),
          time: getTextContent(selectors.time),
          category: getAllTextContent(selectors.category),
          hashtag: getAllTextContent(selectors.hashtag),
          image: getAttribute(selectors.image, 'data-src') || getAttribute(selectors.image, 'src')
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
      source: 'GNN.GAMER.COM.TW Multiple Categories',
      data: links,
      total: links.length,
      categorySummary: this.getCategorySummary(links)
    };
  }

  getCategorySummary(links) {
    const summary = {};
    links.forEach(link => {
      if (!summary[link.source]) {
        summary[link.source] = 0;
      }
      summary[link.source]++;
    });
    return summary;
  }

  async saveToFile(data) {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    
    const day = String(vietnamTime.getUTCDate()).padStart(2, '0');
    const month = String(vietnamTime.getUTCMonth() + 1).padStart(2, '0');
    const year = vietnamTime.getUTCFullYear();
    const hours = String(vietnamTime.getUTCHours()).padStart(2, '0');
    const minutes = String(vietnamTime.getUTCMinutes()).padStart(2, '0');
    
    const filename = `gnn-${day}-${month}-${year}-${hours}-${minutes}.json`;
    const filepath = path.join(__dirname, '../../../results/gnn', filename);

    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[GNN] Results saved to: results/gnn/${filename}`);
    
    return filename;
  }
}

module.exports = GnnScraper;