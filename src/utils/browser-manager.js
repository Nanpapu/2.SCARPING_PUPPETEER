const puppeteer = require('puppeteer');
const PUPPETEER_CONFIG = require('../config/puppeteer-config');

class BrowserManager {
  constructor() {
    this.browsers = new Map();
    this.activeTabs = new Map();
    this.browserCounter = 0;
  }

  async getAvailableBrowser() {
    // Tìm browser có ít tabs nhất
    let bestBrowser = null;
    let minTabs = Infinity;
    
    for (const [browserId, browserInfo] of this.browsers) {
      const tabCount = browserInfo.tabCount;
      if (tabCount < PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS_PER_BROWSER && tabCount < minTabs) {
        bestBrowser = { browserId, ...browserInfo };
        minTabs = tabCount;
      }
    }

    // Nếu không có browser phù hợp, tạo browser mới
    if (!bestBrowser) {
      const browserId = `browser_${++this.browserCounter}`;
      console.log(`[BROWSER-MANAGER] Creating new browser ${browserId}...`);
      
      const browserArgs = PUPPETEER_CONFIG.BROWSER_OPTIONS.args.concat(
        process.env.NODE_ENV === 'development' ? [] : ['--no-zygote', '--single-process']
      );

      const browser = await puppeteer.launch({
        ...PUPPETEER_CONFIG.BROWSER_OPTIONS,
        args: browserArgs
      });

      const browserInfo = {
        browser,
        tabCount: 0,
        createdAt: Date.now()
      };

      this.browsers.set(browserId, browserInfo);
      console.log(`[BROWSER-MANAGER] Browser ${browserId} created (${this.browsers.size} total browsers)`);
      
      return { browserId, ...browserInfo };
    }

    return bestBrowser;
  }

  async getAvailableTab(scraperName) {
    const browserInfo = await this.getAvailableBrowser();
    const { browserId, browser } = browserInfo;

    const page = await browser.newPage();
    const tabId = `${scraperName}_${browserId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await page.setUserAgent(PUPPETEER_CONFIG.DEFAULT_USER_AGENT);
    await page.setViewport(PUPPETEER_CONFIG.DEFAULT_VIEWPORT);

    this.activeTabs.set(tabId, {
      page,
      browserId,
      scraperName,
      createdAt: Date.now()
    });

    // Tăng tab count cho browser
    this.browsers.get(browserId).tabCount++;

    const totalTabs = this.activeTabs.size;
    const browserTabs = this.browsers.get(browserId).tabCount;
    console.log(`[BROWSER-MANAGER] Tab ${tabId} created for ${scraperName} in ${browserId} (${browserTabs}/${PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS_PER_BROWSER} in browser, ${totalTabs} total tabs)`);
    
    return { tabId, page };
  }

  async releaseTab(tabId) {
    const tabInfo = this.activeTabs.get(tabId);
    if (!tabInfo) {
      console.warn(`[BROWSER-MANAGER] Tab ${tabId} not found in active tabs`);
      return;
    }

    const { browserId } = tabInfo;

    try {
      await tabInfo.page.close();
      this.activeTabs.delete(tabId);
      
      // Giảm tab count cho browser
      const browserInfo = this.browsers.get(browserId);
      if (browserInfo) {
        browserInfo.tabCount--;
      }

      const totalTabs = this.activeTabs.size;
      const browserTabs = browserInfo ? browserInfo.tabCount : 0;
      console.log(`[BROWSER-MANAGER] Tab ${tabId} released from ${browserId} (${browserTabs}/${PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS_PER_BROWSER} in browser, ${totalTabs} total tabs)`);
      
      // Small delay to prevent rapid tab creation/destruction
      await new Promise(resolve => setTimeout(resolve, PUPPETEER_CONFIG.TAB_MANAGEMENT.TAB_CLOSE_DELAY));
    } catch (error) {
      console.error(`[BROWSER-MANAGER] Error releasing tab ${tabId}:`, error.message);
      this.activeTabs.delete(tabId);
      
      // Vẫn giảm tab count nếu có lỗi
      const browserInfo = this.browsers.get(browserId);
      if (browserInfo) {
        browserInfo.tabCount--;
      }
    }
  }

  async getActiveTabsInfo() {
    const tabs = [];
    for (const [tabId, tabInfo] of this.activeTabs) {
      tabs.push({
        tabId,
        browserId: tabInfo.browserId,
        scraperName: tabInfo.scraperName,
        createdAt: tabInfo.createdAt,
        age: Date.now() - tabInfo.createdAt
      });
    }
    return tabs;
  }

  async getBrowsersInfo() {
    const browsers = [];
    for (const [browserId, browserInfo] of this.browsers) {
      browsers.push({
        browserId,
        tabCount: browserInfo.tabCount,
        maxTabs: PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS_PER_BROWSER,
        createdAt: browserInfo.createdAt,
        age: Date.now() - browserInfo.createdAt
      });
    }
    return browsers;
  }

  async forceCleanupOldTabs(maxAge = 300000) { // 5 minutes
    const now = Date.now();
    const oldTabs = [];
    
    for (const [tabId, tabInfo] of this.activeTabs) {
      if (now - tabInfo.createdAt > maxAge) {
        oldTabs.push(tabId);
      }
    }

    for (const tabId of oldTabs) {
      console.log(`[BROWSER-MANAGER] Force closing old tab ${tabId}`);
      await this.releaseTab(tabId);
    }

    return oldTabs.length;
  }

  async closeEmptyBrowsers() {
    const browsersToClose = [];
    
    for (const [browserId, browserInfo] of this.browsers) {
      if (browserInfo.tabCount === 0) {
        browsersToClose.push(browserId);
      }
    }

    for (const browserId of browsersToClose) {
      const browserInfo = this.browsers.get(browserId);
      if (browserInfo) {
        console.log(`[BROWSER-MANAGER] Closing empty browser ${browserId}`);
        await browserInfo.browser.close();
        this.browsers.delete(browserId);
      }
    }

    return browsersToClose.length;
  }

  async close() {
    console.log(`[BROWSER-MANAGER] Closing all browsers (${this.browsers.size} browsers, ${this.activeTabs.size} tabs)...`);
    
    // Close all active tabs first
    const tabIds = Array.from(this.activeTabs.keys());
    for (const tabId of tabIds) {
      await this.releaseTab(tabId);
    }

    // Close all browsers
    for (const [browserId, browserInfo] of this.browsers) {
      try {
        await browserInfo.browser.close();
        console.log(`[BROWSER-MANAGER] Browser ${browserId} closed`);
      } catch (error) {
        console.error(`[BROWSER-MANAGER] Error closing browser ${browserId}:`, error.message);
      }
    }

    this.browsers.clear();
    this.activeTabs.clear();
    this.browserCounter = 0;
    
    console.log('[BROWSER-MANAGER] All browsers closed');
  }

  isHealthy() {
    for (const [browserId, browserInfo] of this.browsers) {
      if (browserInfo.browser.process()?.killed) {
        console.warn(`[BROWSER-MANAGER] Browser ${browserId} is killed`);
        return false;
      }
    }
    return true;
  }
}

// Singleton instance
const browserManager = new BrowserManager();

module.exports = browserManager;