require('dotenv').config();
const express = require('express');
const SohuScraper = require('./scrapers/sohu/sohu-scraper');
const GamelookScraper = require('./scrapers/gamelook/gamelook-scraper');
const NineGameRankingListScraper = require('./scrapers/9game/9game-ranking-list-scraper');
const GnnQuickScraper = require('./scrapers/gnn/gnn-quick-scraper');
const TapTapRankingScraper = require('./scrapers/taptap/taptap-ranking-scraper');
const { Logger, generateRequestId } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy to get real client IP
app.set('trust proxy', true);

app.use(express.json());

// IP Whitelist Configuration
const ALLOWED_IPS = ['103.82.29.1', '103.82.29.2', '103.82.29.3'];

// IP Whitelist Middleware
const ipWhitelist = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress ||
                   (req.connection.socket ? req.connection.socket.remoteAddress : null);

  // Handle IPv6-mapped IPv4 addresses (::ffff:x.x.x.x)
  const cleanIP = clientIP && clientIP.includes('::ffff:') ? clientIP.replace('::ffff:', '') : clientIP;

  console.log(`[IP CHECK] Client IP: ${cleanIP}, Original: ${clientIP}`);

  if (!cleanIP || !ALLOWED_IPS.includes(cleanIP)) {
    console.log(`[IP BLOCKED] Access denied for IP: ${cleanIP}`);
    return res.status(403).json({
      success: false,
      message: 'Access denied: IP not whitelisted',
      clientIP: cleanIP
    });
  }

  console.log(`[IP ALLOWED] Access granted for IP: ${cleanIP}`);
  next();
};

// Apply IP whitelist to all API routes (except health check)
app.use('/api', ipWhitelist);

// Initialize scrapers
const scrapers = {
  sohu: new SohuScraper(),
  gamelook: new GamelookScraper(),
  '9game': new NineGameRankingListScraper(),
  gnn: new GnnQuickScraper(),
  taptap: new TapTapRankingScraper()
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
  const requestId = generateRequestId();
  const logger = new Logger('sohu', requestId);

  try {
    logger.info('Sohu manual scrape triggered');
    const result = await scrapers.sohu.scrape(logger);

    logger.success(`Sohu scraping completed successfully. Items scraped: ${result.items ? result.items.length : 'N/A'}`);

    res.json({
      success: true,
      message: 'Sohu scraping completed successfully',
      scraper: 'sohu',
      requestId: requestId,
      data: result
    });
  } catch (error) {
    logger.error(`Sohu scraping failed: ${error.message}`);

    res.status(500).json({
      success: false,
      message: 'Sohu scraping failed',
      scraper: 'sohu',
      requestId: requestId,
      error: error.message
    });
  }
});

app.post('/api/scrape/gamelook', async (req, res) => {
  const requestId = generateRequestId();
  const logger = new Logger('gamelook', requestId);

  try {
    logger.info('Gamelook manual scrape triggered');
    const result = await scrapers.gamelook.scrape(logger);

    logger.success(`Gamelook scraping completed successfully. Items scraped: ${result.items ? result.items.length : 'N/A'}`);

    res.json({
      success: true,
      message: 'Gamelook scraping completed successfully',
      scraper: 'gamelook',
      requestId: requestId,
      data: result
    });
  } catch (error) {
    logger.error(`Gamelook scraping failed: ${error.message}`);

    res.status(500).json({
      success: false,
      message: 'Gamelook scraping failed',
      scraper: 'gamelook',
      requestId: requestId,
      error: error.message
    });
  }
});

app.post('/api/scrape/9game', async (req, res) => {
  const requestId = generateRequestId();
  const logger = new Logger('9game', requestId);

  try {
    logger.info('9Game manual scrape triggered');
    const result = await scrapers['9game'].scrape(logger);

    logger.success(`9Game scraping completed successfully. Items scraped: ${result.items ? result.items.length : 'N/A'}`);

    res.json({
      success: true,
      message: '9Game scraping completed successfully',
      scraper: '9game',
      requestId: requestId,
      data: result
    });
  } catch (error) {
    logger.error(`9Game scraping failed: ${error.message}`);

    res.status(500).json({
      success: false,
      message: '9Game scraping failed',
      scraper: '9game',
      requestId: requestId,
      error: error.message
    });
  }
});

app.post('/api/scrape/gnn', async (req, res) => {
  const requestId = generateRequestId();
  const logger = new Logger('gnn', requestId);

  try {
    logger.info('GNN manual scrape triggered');
    const result = await scrapers.gnn.scrape(logger);

    logger.success(`GNN scraping completed successfully. Items scraped: ${result.items ? result.items.length : 'N/A'}`);

    res.json({
      success: true,
      message: 'GNN scraping completed successfully',
      scraper: 'gnn',
      requestId: requestId,
      data: result
    });
  } catch (error) {
    logger.error(`GNN scraping failed: ${error.message}`);

    res.status(500).json({
      success: false,
      message: 'GNN scraping failed',
      scraper: 'gnn',
      requestId: requestId,
      error: error.message
    });
  }
});

app.post('/api/scrape/taptap', async (req, res) => {
  const requestId = generateRequestId();
  const logger = new Logger('taptap', requestId);

  try {
    logger.info('TapTap manual scrape triggered');
    const result = await scrapers.taptap.scrape(logger);

    logger.success(`TapTap scraping completed successfully. Items scraped: ${result.items ? result.items.length : 'N/A'}`);

    res.json({
      success: true,
      message: 'TapTap scraping completed successfully',
      scraper: 'taptap',
      requestId: requestId,
      data: result
    });
  } catch (error) {
    logger.error(`TapTap scraping failed: ${error.message}`);

    res.status(500).json({
      success: false,
      message: 'TapTap scraping failed',
      scraper: 'taptap',
      requestId: requestId,
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
  console.log(`TapTap scraper: POST http://localhost:${PORT}/api/scrape/taptap`);
});