require('dotenv').config();
const express = require('express');
const SohuScraper = require('./scrapers/sohu/sohu-scraper');
const GamelookScraper = require('./scrapers/gamelook/gamelook-scraper');
const NineGameRankingListScraper = require('./scrapers/9game/9game-ranking-list-scraper');
const GnnQuickScraper = require('./scrapers/gnn/gnn-quick-scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize scrapers
const scrapers = {
  sohu: new SohuScraper(),
  gamelook: new GamelookScraper(),
  '9game': new NineGameRankingListScraper(),
  gnn: new GnnQuickScraper()
};

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'multi-website-scraper',
    availableScrapers: Object.keys(scrapers)
  });
});

app.post('/api/scrape/sohu', async (req, res) => {
  try {
    console.log('[SERVER] Sohu manual scrape triggered');
    const result = await scrapers.sohu.scrape();
    
    res.json({
      success: true,
      message: 'Sohu scraping completed successfully',
      scraper: 'sohu',
      data: result
    });
  } catch (error) {
    console.error('[SERVER] Sohu scraping failed:', error.message);
    
    res.status(500).json({
      success: false,
      message: 'Sohu scraping failed',
      scraper: 'sohu',
      error: error.message
    });
  }
});

app.post('/api/scrape/gamelook', async (req, res) => {
  try {
    console.log('[SERVER] Gamelook manual scrape triggered');
    const result = await scrapers.gamelook.scrape();
    
    res.json({
      success: true,
      message: 'Gamelook scraping completed successfully',
      scraper: 'gamelook',
      data: result
    });
  } catch (error) {
    console.error('[SERVER] Gamelook scraping failed:', error.message);
    
    res.status(500).json({
      success: false,
      message: 'Gamelook scraping failed',
      scraper: 'gamelook',
      error: error.message
    });
  }
});

app.post('/api/scrape/9game', async (req, res) => {
  try {
    console.log('[SERVER] 9Game manual scrape triggered');
    const result = await scrapers['9game'].scrape();
    
    res.json({
      success: true,
      message: '9Game scraping completed successfully',
      scraper: '9game',
      data: result
    });
  } catch (error) {
    console.error('[SERVER] 9Game scraping failed:', error.message);
    
    res.status(500).json({
      success: false,
      message: '9Game scraping failed',
      scraper: '9game',
      error: error.message
    });
  }
});

app.post('/api/scrape/gnn', async (req, res) => {
  try {
    console.log('[SERVER] GNN manual scrape triggered');
    const result = await scrapers.gnn.scrape();
    
    res.json({
      success: true,
      message: 'GNN scraping completed successfully',
      scraper: 'gnn',
      data: result
    });
  } catch (error) {
    console.error('[SERVER] GNN scraping failed:', error.message);
    
    res.status(500).json({
      success: false,
      message: 'GNN scraping failed',
      scraper: 'gnn',
      error: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Multi-website scraper server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Available scrapers: ${Object.keys(scrapers).join(', ')}`);
  console.log(`Sohu scraper: POST http://localhost:${PORT}/api/scrape/sohu`);
  console.log(`Gamelook scraper: POST http://localhost:${PORT}/api/scrape/gamelook`);
  console.log(`9Game scraper: POST http://localhost:${PORT}/api/scrape/9game`);
  console.log(`GNN scraper: POST http://localhost:${PORT}/api/scrape/gnn`);
});