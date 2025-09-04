# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Development:**
- `npm install` - Install dependencies
- `npm start` - Start the Express server (same as `npm run dev`)
- `node src/index.js` - Direct server start

**Docker:**
- `docker-compose up --build` - Build and run containerized app
- `curl -X POST http://localhost:3000/api/scrape/sohu` - Trigger manual scrape
- `curl http://localhost:3000/health` - Health check

## Architecture

This is a simple web scraper service with two main components:

**Core Classes:**
- `SohuScraper` (src/scraper.js) - Puppeteer-based scraper class that handles the actual web scraping logic
- Express server (src/index.js) - HTTP API wrapper around the scraper

**Scraper Architecture:**
- Target: https://www.sohu.com/ using CSS selector `ul.news[data-spm="top-news1"] a.titleStyle`
- Retry mechanism: 3 attempts with 2-second delays
- Output: Timestamped JSON files in Vietnamese timezone (GMT+7) saved to `results/` directory
- File naming: `sohu-DD-MM-YYYY-HH-MM.json`

**Docker Setup:**
- Uses system Chromium (`/usr/bin/chromium`) instead of bundled Chromium for better Docker compatibility
- Configured for both Windows Docker Desktop and Ubuntu VPS deployment
- Environment variable `PUPPETEER_EXECUTABLE_PATH` controls Chromium path

**API Endpoints:**
- `POST /api/scrape/sohu` - Manual scrape trigger (returns scraped data + metadata)
- `GET /health` - Health check endpoint

**Key Configuration:**
- Vietnamese timezone handling for timestamps (GMT+7)
- Headless Chromium with Docker-optimized args (`--no-sandbox`, `--disable-setuid-sandbox`, etc.)
- Manual trigger only - no scheduling/cron functionality