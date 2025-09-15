const SCRAPER_CONFIGS = require('../../config/scraper-configs');
const PUPPETEER_CONFIG = require('../../config/puppeteer-config');
const browserManager = require('../../utils/browser-manager');
const fs = require('fs');
const path = require('path');

class GnnQuickScraper {
  constructor() {
    this.config = SCRAPER_CONFIGS.gnn;
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
        console.log(`[GNN-QUICK] Scraping attempt ${attempt}/${this.config.MAX_RETRIES}`);

        // Collect all links from all categories in parallel
        console.log(`[GNN-QUICK] Processing all ${this.config.CATEGORIES.length} categories in parallel...`);
        const categoryPromises = this.config.CATEGORIES.map(async (category) => {
          console.log(`[GNN-QUICK] Starting category: ${category.source}`);
          const categoryLinks = await this.extractLinksFromCategory(category);
          console.log(`[GNN-QUICK] Found ${categoryLinks.length} links from ${category.source}`);
          return categoryLinks;
        });

        const categoryResults = await Promise.all(categoryPromises);
        const allLinksWithDuplicates = categoryResults.flat();

        // Merge duplicate links and combine sources
        const linkMap = new Map();
        allLinksWithDuplicates.forEach(linkData => {
          if (linkMap.has(linkData.link)) {
            // Link exists, add source to array
            const existing = linkMap.get(linkData.link);
            if (!existing.source.includes(linkData.source)) {
              existing.source.push(linkData.source);
            }
          } else {
            // New link, create with source as array
            linkMap.set(linkData.link, {
              link: linkData.link,
              source: [linkData.source]
            });
          }
        });

        const uniqueLinks = Array.from(linkMap.values());
        
        if (uniqueLinks.length === 0) {
          throw new Error('No links found from any categories');
        }

        console.log(`[GNN-QUICK] Total found ${allLinksWithDuplicates.length} links (${uniqueLinks.length} unique)`);

        try {
          const result = this.formatResult(uniqueLinks);
          await this.saveToFile(result);

          console.log(`[GNN-QUICK] Successfully scraped ${uniqueLinks.length} unique links`);
          return result;
        } catch (saveError) {
          console.error(`[GNN-QUICK] Error during save/format:`, saveError.message);
          // Still return result even if formatting/saving fails
          return {
            timestamp: new Date().toISOString(),
            source: 'GNN.GAMER.COM.TW Multiple Categories - Quick Links Only',
            data: uniqueLinks,
            total: uniqueLinks.length
          };
        }

      } catch (error) {
        console.error(`[GNN-QUICK] Attempt ${attempt} failed:`, error.message);
        
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

  async extractLinksFromCategory(category) {
    const tabInfo = await browserManager.getAvailableTab('gnn-category');
    const { tabId, page } = tabInfo;
    
    try {
      await page.setUserAgent(PUPPETEER_CONFIG.DEFAULT_USER_AGENT);
      await page.setViewport(PUPPETEER_CONFIG.DEFAULT_VIEWPORT);
      
      await page.goto(category.url, { 
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_LOAD 
      });
      
      await page.waitForTimeout(this.timeouts.WAIT_AFTER_LOAD);

      const links = await page.$$eval(this.config.LINKS_SELECTOR, (elements) => {
        return elements.map(el => el.href);
      });

      // Add source to each link
      return links.map(link => ({
        link: link,
        source: category.source
      }));
    } finally {
      await browserManager.releaseTab(tabId);
    }
  }

  formatResult(links) {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    
    return {
      timestamp: vietnamTime.toISOString().replace('Z', '+07:00'),
      source: 'GNN.GAMER.COM.TW Multiple Categories - Quick Links Only',
      data: links,
      total: links.length,
      categorySummary: this.getCategorySummary(links)
    };
  }

  getCategorySummary(links) {
    const summary = {};
    links.forEach(link => {
      link.source.forEach(src => {
        if (!summary[src]) {
          summary[src] = 0;
        }
        summary[src]++;
      });
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
    
    const filename = `gnn-quick-${day}-${month}-${year}-${hours}-${minutes}.json`;
    const filepath = path.join(__dirname, '../../../results/gnn', filename);

    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[GNN-QUICK] Results saved to: results/gnn/${filename}`);
    
    return filename;
  }
}

module.exports = GnnQuickScraper;