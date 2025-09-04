# Sohu.com Web Scraper

Simple web scraper for sohu.com using Puppeteer with Docker support for Windows and Ubuntu VPS deployment.

## Features

- Scrapes https://www.sohu.com/ for news links
- Extracts links using CSS selector: `ul.news[data-spm="top-news1"] a.titleStyle`
- Saves results to timestamped JSON files in Vietnamese timezone (GMT+7)
- Docker containerization with system Chromium
- Simple Express API with manual trigger endpoints
- Retry mechanism (3 attempts) for reliability

## JSON Output Format

```json
{
  "timestamp": "2025-09-04T14:30:00+07:00",
  "source": "https://www.sohu.com/",
  "data": [
    {
      "href": "https://www.sohu.com/a/123456789",
      "title": "News title here"
    }
  ],
  "total": 10
}
```

## API Endpoints

- `POST /api/scrape/sohu` - Trigger manual scrape
- `GET /health` - Health check

## Quick Start

### Using Docker (Recommended)

1. Build and run with Docker Compose:
```bash
docker-compose up --build
```

2. Trigger scraping:
```bash
curl -X POST http://localhost:3000/api/scrape/sohu
```

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Trigger scraping:
```bash
curl -X POST http://localhost:3000/api/scrape/sohu
```

## File Structure

```
├── src/
│   ├── index.js        # Express server
│   └── scraper.js      # Puppeteer scraper service
├── results/            # JSON output files
├── Dockerfile          # Docker configuration
├── docker-compose.yml  # Docker Compose setup
├── .env               # Environment variables
└── package.json       # Dependencies
```

## Results

Scraped data is saved to `results/` directory with filename format: `sohu-DD-MM-YYYY-HH-MM.json`

## Docker Deployment

The Dockerfile uses system Chromium for better compatibility:

- Works on Windows Docker Desktop
- Works on Ubuntu VPS
- No complex browser installation steps
- Optimized for headless operation

## Environment Variables

- `NODE_ENV`: Environment (development/production)
- `PORT`: Server port (default: 3000)
- `PUPPETEER_EXECUTABLE_PATH`: Chromium path (set automatically in Docker)