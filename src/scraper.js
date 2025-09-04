const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class SohuScraper {
  constructor() {
    this.targetUrl = 'https://www.sohu.com/';
    this.selector = 'ul.news[data-spm="top-news1"] a.titleStyle';
    this.maxRetries = 3;
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.batchSize = parseInt(process.env.BATCH_SIZE) || 10;
  }

  async scrape() {
    let browser = null;
    let attempt = 1;

    while (attempt <= this.maxRetries) {
      try {
        console.log(`Scraping attempt ${attempt}/${this.maxRetries}`);
        
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
        
        await page.setUserAgent(this.userAgent);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('Loading sohu.com...');
        await page.goto(this.targetUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });

        await page.waitForTimeout(3000);

        console.log('Extracting links...');
        const links = await page.$$eval(this.selector, (elements) => {
          return elements.map(el => el.href);
        });

        if (links.length === 0) {
          throw new Error('No links found with the specified selector');
        }

        console.log(`Found ${links.length} links, extracting details in batches of ${this.batchSize}...`);
        const detailedData = [];

        for (let i = 0; i < links.length; i += this.batchSize) {
          const batch = links.slice(i, i + this.batchSize);
          console.log(`Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(links.length / this.batchSize)} (${batch.length} links)`);
          
          const batchPromises = batch.map(async (link, index) => {
            try {
              console.log(`  Processing link ${i + index + 1}/${links.length}: ${link}`);
              const details = await this.extractLinkDetails(browser, link);
              return details;
            } catch (error) {
              console.error(`  Failed to extract details from ${link}:`, error.message);
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
          
          if (i + this.batchSize < links.length) {
            console.log(`  Waiting 2 seconds before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        const result = this.formatResult(detailedData);
        await this.saveToFile(result);

        console.log(`Successfully scraped ${links.length} links with details`);
        return result;

      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt === this.maxRetries) {
          throw new Error(`Scraping failed after ${this.maxRetries} attempts: ${error.message}`);
        }
        
        attempt++;
        await new Promise(resolve => setTimeout(resolve, 2000));
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
      await page.setUserAgent(this.userAgent);
      await page.setViewport({ width: 1366, height: 768 });
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      
      await page.waitForTimeout(2000);

      const details = await page.evaluate((url) => {
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
          title: getTextContent('h1'),
          time: getTextContent('span#news-time'),
          location: getTextContent('div.area > span:last-child'),
          image: getAttribute('img', 'src'),
          description: getAttribute('meta[name="description"]', 'content')
        };
      }, url);

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
      source: this.targetUrl,
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
    const filepath = path.join(__dirname, '../results', filename);

    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Results saved to: ${filename}`);
    
    return filename;
  }
}

module.exports = SohuScraper;