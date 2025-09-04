# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Development:**
- `npm install` - Install dependencies
- `npm start` - Start the multi-website scraper server
- `node src/index.js` - Direct server start
- `node test-scraper.js` - Test Sohu scraper directly (no server needed)

**Docker:**
- `docker-compose up --build` - Build and run containerized app
- `curl -X POST http://localhost:3000/api/scrape/sohu` - Trigger Sohu scrape
- `curl http://localhost:3000/health` - Health check (shows available scrapers)

## Architecture

This is a **multi-website scraper service** designed to handle different websites with different scraping strategies:

### Project Structure
```
src/
├── index.js                    # Main Express server
└── scrapers/
    └── sohu/
        └── sohu-scraper.js     # Sohu.com scraper (Puppeteer)
results/
└── sohu/                       # Sohu scraping results
```

### Scraper Types
1. **Puppeteer Scrapers** (for JS-heavy sites): Like Sohu scraper
2. **HTTP Scrapers** (for static sites): Future scrapers for sites without JS

### Adding New Scrapers

**Step 1: Create scraper file**
- Path: `src/scrapers/{website}/{website}-scraper.js`
- Config at top of file (BATCH_SIZE, selectors, etc.)
- Must export class with `scrape()` method

**Step 2: Add to main server**
- Import in `src/index.js` 
- Add to `scrapers` object
- Add API endpoint `POST /api/scrape/{website}`

**Step 3: Create results folder**
- `results/{website}/` for output files

### Sohu Scraper Details
- **Config**: All settings at top of `src/scrapers/sohu/sohu-scraper.js`
- **Target**: https://www.sohu.com/ using CSS selector `ul.news[data-spm="top-news1"] a.titleStyle`
- **Batch processing**: 50 links parallel (configurable in SCRAPER_CONFIG)
- **Output**: `results/sohu/sohu-DD-MM-YYYY-HH-MM.json` (Vietnamese timezone GMT+7)
- **Data fields**: href, title, time, location, image, description
- **Retry mechanism**: 3 attempts with 2-second delays

### Key Configuration
- **Per-scraper config**: Set BATCH_SIZE, selectors, etc. at top of each scraper file
- **Environment**: Only NODE_ENV and PORT in .env, scraper settings in individual files
- **Docker**: Uses system Chromium (`PUPPETEER_EXECUTABLE_PATH` for container path)
- **Results**: Separate folders per website in `results/` directory