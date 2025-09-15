const puppeteer = require('puppeteer');
const PUPPETEER_CONFIG = require('../config/puppeteer-config');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.activeTabs = new Map();
    this.tabQueue = [];
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized && this.browser) {
      return this.browser;
    }

    console.log('[BROWSER-MANAGER] Initializing shared browser instance...');
    
    const browserArgs = PUPPETEER_CONFIG.BROWSER_OPTIONS.args.concat(
      process.env.NODE_ENV === 'development' ? [] : ['--no-zygote', '--single-process']
    );

    this.browser = await puppeteer.launch({
      ...PUPPETEER_CONFIG.BROWSER_OPTIONS,
      args: browserArgs
    });

    this.isInitialized = true;
    console.log(`[BROWSER-MANAGER] Browser initialized with max ${PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS} tabs`);
    
    return this.browser;
  }

  async getAvailableTab(scraperName) {
    if (!this.browser) {
      await this.init();
    }

    // Check if we have available tab slots
    if (this.activeTabs.size >= PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS) {
      console.log(`[BROWSER-MANAGER] Max tabs (${PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS}) reached, waiting for available tab...`);
      await this.waitForAvailableTab();
    }

    const page = await this.browser.newPage();
    const tabId = `${scraperName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await page.setUserAgent(PUPPETEER_CONFIG.DEFAULT_USER_AGENT);
    await page.setViewport(PUPPETEER_CONFIG.DEFAULT_VIEWPORT);

    this.activeTabs.set(tabId, {
      page,
      scraperName,
      createdAt: Date.now()
    });

    console.log(`[BROWSER-MANAGER] Tab ${tabId} created for ${scraperName} (${this.activeTabs.size}/${PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS})`);
    
    return { tabId, page };
  }

  async releaseTab(tabId) {
    const tabInfo = this.activeTabs.get(tabId);
    if (!tabInfo) {
      console.warn(`[BROWSER-MANAGER] Tab ${tabId} not found in active tabs`);
      return;
    }

    try {
      await tabInfo.page.close();
      this.activeTabs.delete(tabId);
      console.log(`[BROWSER-MANAGER] Tab ${tabId} released (${this.activeTabs.size}/${PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS})`);
      
      // Small delay to prevent rapid tab creation/destruction
      await new Promise(resolve => setTimeout(resolve, PUPPETEER_CONFIG.TAB_MANAGEMENT.TAB_CLOSE_DELAY));
    } catch (error) {
      console.error(`[BROWSER-MANAGER] Error releasing tab ${tabId}:`, error.message);
      this.activeTabs.delete(tabId);
    }
  }

  async waitForAvailableTab() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeTabs.size < PUPPETEER_CONFIG.TAB_MANAGEMENT.MAX_TABS) {
          clearInterval(checkInterval);
          resolve();
        }
      }, PUPPETEER_CONFIG.TAB_MANAGEMENT.TAB_REUSE_DELAY);
    });
  }

  async getActiveTabsInfo() {
    const tabs = [];
    for (const [tabId, tabInfo] of this.activeTabs) {
      tabs.push({
        tabId,
        scraperName: tabInfo.scraperName,
        createdAt: tabInfo.createdAt,
        age: Date.now() - tabInfo.createdAt
      });
    }
    return tabs;
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

  async close() {
    if (this.browser) {
      console.log('[BROWSER-MANAGER] Closing shared browser instance...');
      
      // Close all active tabs first
      const tabIds = Array.from(this.activeTabs.keys());
      for (const tabId of tabIds) {
        await this.releaseTab(tabId);
      }

      await this.browser.close();
      this.browser = null;
      this.isInitialized = false;
      this.activeTabs.clear();
      
      console.log('[BROWSER-MANAGER] Browser closed');
    }
  }

  isHealthy() {
    return this.browser && this.isInitialized && !this.browser.process()?.killed;
  }
}

// Singleton instance
const browserManager = new BrowserManager();

module.exports = browserManager;