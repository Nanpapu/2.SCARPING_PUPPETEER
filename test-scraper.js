const SohuScraper = require('./src/scrapers/sohu/sohu-scraper');

async function testSohuScraper() {
  try {
    console.log('Testing Sohu scraper...');
    const scraper = new SohuScraper();
    const result = await scraper.scrape();
    console.log('Sohu Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Sohu test failed:', error.message);
  }
}

testSohuScraper();