const SohuScraper = require('./src/scraper');

async function testScraper() {
  try {
    console.log('Testing scraper...');
    const scraper = new SohuScraper();
    const result = await scraper.scrape();
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testScraper();