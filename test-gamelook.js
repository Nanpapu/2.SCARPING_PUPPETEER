const GamelookScraper = require('./src/scrapers/gamelook/gamelook-scraper');

async function testGamelookScraper() {
  try {
    console.log('Testing Gamelook scraper...');
    const scraper = new GamelookScraper();
    const result = await scraper.scrape();
    console.log('Gamelook Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Gamelook test failed:', error.message);
  }
}

testGamelookScraper();