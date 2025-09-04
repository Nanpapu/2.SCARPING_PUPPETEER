require('dotenv').config();
const express = require('express');
const SohuScraper = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const scraper = new SohuScraper();

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'sohu-scraper'
  });
});

app.post('/api/scrape/sohu', async (req, res) => {
  try {
    console.log('Manual scrape triggered');
    const result = await scraper.scrape();
    
    res.json({
      success: true,
      message: 'Scraping completed successfully',
      data: result
    });
  } catch (error) {
    console.error('Scraping failed:', error.message);
    
    res.status(500).json({
      success: false,
      message: 'Scraping failed',
      error: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sohu scraper server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Manual scrape: POST http://localhost:${PORT}/api/scrape/sohu`);
});