const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4,
  SECURITY: 5,
  PERFORMANCE: 6
};

class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(__dirname, '../../logs');
    this.consoleMinLevel = LOG_LEVELS[options.consoleMinLevel || 'INFO'];
    this.fileMinLevel = LOG_LEVELS[options.fileMinLevel || 'WARNING'];

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.logFile = path.join(this.logDir, 'bot.log');
    this.errorFile = path.join(this.logDir, 'bot.err.log');
  }

  log(levelName, message, meta = {}) {
    const level = LOG_LEVELS[levelName.toUpperCase()] || LOG_LEVELS.INFO;
    const timestamp = new Date().toISOString();

    const logEntry = {
      timestamp,
      level: levelName.toUpperCase(),
      message,
      ...meta
    };

    const logString = JSON.stringify(logEntry);

    // Console output
    if (level >= this.consoleMinLevel) {
      const color = this.getColorForLevel(levelName);
      console.log(`${color}[${timestamp}] [${levelName.toUpperCase()}] ${message}\x1b[0m`, Object.keys(meta).length ? meta : '');
    }

    // File output
    if (level >= this.fileMinLevel) {
      this.writeToFile(this.logFile, logString + '\n');
    }

    if (level >= LOG_LEVELS.ERROR) {
      this.writeToFile(this.errorFile, logString + '\n');
    }
  }

  getColorForLevel(level) {
    switch (level.toUpperCase()) {
      case 'DEBUG': return '\x1b[36m'; // cyan
      case 'INFO': return '\x1b[32m'; // green
      case 'WARNING': return '\x1b[33m'; // yellow
      case 'ERROR': return '\x1b[31m'; // red
      case 'CRITICAL': return '\x1b[41m\x1b[37m'; // white on red
      case 'SECURITY': return '\x1b[35m'; // magenta
      case 'PERFORMANCE': return '\x1b[34m'; // blue
      default: return '\x1b[0m';
    }
  }

  writeToFile(filePath, data) {
    try {
      fs.appendFileSync(filePath, data, 'utf8');
    } catch (err) {
      console.error('Failed to write log to file:', err.message);
    }
  }

  debug(msg, meta) { this.log('DEBUG', msg, meta); }
  info(msg, meta) { this.log('INFO', msg, meta); }
  warn(msg, meta) { this.log('WARNING', msg, meta); }
  error(msg, meta) { this.log('ERROR', msg, meta); }
  critical(msg, meta) { this.log('CRITICAL', msg, meta); }
  security(msg, meta) { this.log('SECURITY', msg, meta); }
  perf(msg, meta) { this.log('PERFORMANCE', msg, meta); }
}

module.exports = Logger;
