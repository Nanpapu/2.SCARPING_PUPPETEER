const PUPPETEER_CONFIG = {
  BROWSER_OPTIONS: {
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
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  },

  TAB_MANAGEMENT: {
    MAX_TABS_PER_BROWSER: 8, // Số tabs tối đa trong 1 browser
    TAB_REUSE_DELAY: 1000,
    TAB_CLOSE_DELAY: 500
  },

  GLOBAL_TIMEOUTS: {
    PAGE_LOAD: 600000,
    DETAIL_LOAD: 600000,
    WAIT_AFTER_LOAD: 10000,
    WAIT_AFTER_DETAIL: 8000,
    RETRY_DELAY: 5000
  },

  DEFAULT_VIEWPORT: {
    width: 1366,
    height: 768
  },

  DEFAULT_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

module.exports = PUPPETEER_CONFIG;