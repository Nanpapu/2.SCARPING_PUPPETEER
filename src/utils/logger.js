const fs = require('fs');
const path = require('path');

class Logger {
  constructor(scraper, requestId) {
    this.scraper = scraper;
    this.requestId = requestId;
    this.logDir = path.join(__dirname, '../../logs');
    this.logFile = this.createLogFile();

    // Ensure logs directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  createLogFile() {
    const now = new Date();
    const dateStr = now.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).replace(/[\/\s:]/g, '-');

    return path.join(this.logDir, `${this.scraper}-${dateStr}-${this.requestId}.log`);
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh'
    });

    const logEntry = `[${timestamp}] [${level}] [${this.scraper}] [${this.requestId}] ${message}\n`;

    // Write to file
    fs.appendFileSync(this.logFile, logEntry);

    // Also log to console with request ID for identification
    console.log(`[${this.requestId}] ${message}`);
  }

  info(message) {
    this.log(message, 'INFO');
  }

  error(message) {
    this.log(message, 'ERROR');
  }

  warn(message) {
    this.log(message, 'WARN');
  }

  success(message) {
    this.log(message, 'SUCCESS');
  }
}

// Generate unique request ID
function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

module.exports = { Logger, generateRequestId };