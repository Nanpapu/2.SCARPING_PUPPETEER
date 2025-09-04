const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class SohuScraper {
  constructor() {
    this.targetUrl = 'https://www.sohu.com/';
    this.selector = 'ul.news[data-spm="top-news1"] a.titleStyle';
    this.maxRetries = 3;
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
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
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ],
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

        const result = this.formatResult(links);
        await this.saveToFile(result);

        console.log(`Successfully scraped ${links.length} links`);
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