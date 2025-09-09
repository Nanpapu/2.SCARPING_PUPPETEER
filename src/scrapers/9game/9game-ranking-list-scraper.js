// 9GAME.CN RANKING LIST SCRAPER CONFIGURATION
const SCRAPER_CONFIG = {
  BATCH_SIZE: 20,
  MAX_RETRIES: 3,
  TARGET_URL: 'https://www.9game.cn/xyrb/?spm=aligames_platform_ug.ng_seo.0.0.36d769b18t8wzl',
  RANKING_SELECTORS: {
    rank: 'td.num span.n',
    link: 'td.name a'
  },
  DETAILS_SELECTORS: {
    // For released games
    released: {
      namegame: [
        'div[class^="ng-pc-materials__topbanner--title"]',
        'h1.tit.cn',
        'a[data-spm-protocol][data-spm-anchor-id]:not([href*="tag"])'
      ],
      day: 'div[class^="ng-pc-materials__topbanner--timeline_content_small"]',
      anh: 'img[class*="ng-pc-materials__topbanner--icon_game"]',
      theloai: 'div[class^="ng-pc-materials__topbanner--tag_text"]',
      description: 'div.ng-pc-materials__topbanner--description_box_small--3ImkWfE'
    },
    // For unreleased games
    unreleased: {
      namegame: 'h1.ngame-title a',
      day: 'div[class^="ng-pc-materials__topbanner--timeline_content_small"]',
      anh: 'ul.focus-img li[style*="display: list-item"] img',
      theloai: 'div.ngame-types span.point',
      description: 'div.ng-pc-materials__topbanner--description_box_small--3ImkWfE'
    }
  },
  TIMEOUTS: {
    PAGE_LOAD: 300000,
    DETAIL_LOAD: 300000,
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

class NineGameRankingListScraper {
  constructor() {
    this.config = SCRAPER_CONFIG;
  }

  async scrape() {
    let browser = null;
    let attempt = 1;

    while (attempt <= this.config.MAX_RETRIES) {
      try {
        console.log(`[9GAME] Scraping attempt ${attempt}/${this.config.MAX_RETRIES}`);
        
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

        console.log('[9GAME] Loading ranking page...');
        await page.goto(this.config.TARGET_URL, { 
          waitUntil: 'domcontentloaded',
          timeout: this.config.TIMEOUTS.PAGE_LOAD 
        });

        await page.waitForTimeout(this.config.TIMEOUTS.WAIT_AFTER_LOAD);

        console.log('[9GAME] Extracting ranking data...');
        const rankingData = await this.extractRankingData(page);

        if (rankingData.length === 0) {
          throw new Error('No ranking data found');
        }

        console.log(`[9GAME] Found ${rankingData.length} games, extracting details in batches of ${this.config.BATCH_SIZE}...`);
        const detailedData = [];

        for (let i = 0; i < rankingData.length; i += this.config.BATCH_SIZE) {
          const batch = rankingData.slice(i, i + this.config.BATCH_SIZE);
          console.log(`[9GAME] Processing batch ${Math.floor(i / this.config.BATCH_SIZE) + 1}/${Math.ceil(rankingData.length / this.config.BATCH_SIZE)} (${batch.length} games)`);
          
          const batchPromises = batch.map(async (item, index) => {
            try {
              console.log(`[9GAME]   Processing game ${i + index + 1}/${rankingData.length}: ${item.link}`);
              const details = await this.extractGameDetails(browser, item.link);
              return {
                rank: item.rank,
                link: item.link,
                ...details
              };
            } catch (error) {
              console.error(`[9GAME]   Failed to extract details from ${item.link}:`, error.message);
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
            console.log(`[9GAME]   Waiting ${this.config.TIMEOUTS.BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.config.TIMEOUTS.BATCH_DELAY));
          }
        }

        const result = this.formatResult(detailedData);
        await this.saveToFile(result);

        console.log(`[9GAME] Successfully scraped ${rankingData.length} games with details`);
        return result;

      } catch (error) {
        console.error(`[9GAME] Attempt ${attempt} failed:`, error.message);
        
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

  async extractGameDetails(browser, url) {
    const page = await browser.newPage();
    
    try {
      await page.setUserAgent(this.config.USER_AGENT);
      await page.setViewport({ width: 1366, height: 768 });
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: this.config.TIMEOUTS.DETAIL_LOAD
      });
      
      await page.waitForTimeout(this.config.TIMEOUTS.WAIT_AFTER_DETAIL);

      // First try released game selectors
      let details = await this.tryExtractDetails(page, this.config.DETAILS_SELECTORS.released, url);
      
      // If day is null/empty, try unreleased game selectors
      if (!details.day) {
        console.log(`[9GAME]     Game appears unreleased, trying unreleased selectors...`);
        details = await this.tryExtractDetails(page, this.config.DETAILS_SELECTORS.unreleased, url);
      }

      return details;
    } finally {
      await page.close();
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
    const filepath = path.join(__dirname, '../../../results/9game', filename);

    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[9GAME] Results saved to: results/9game/${filename}`);
    
    return filename;
  }
}

module.exports = NineGameRankingListScraper;