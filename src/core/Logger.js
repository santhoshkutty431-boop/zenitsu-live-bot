const pino = require('pino');
const fs = require('fs');
const path = require('path');

class Logger {
  constructor(options = {}) {
    const logDir = options.logDir || path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, 'bot.log');
    
    // Set up streams
    const streams = [
      {
        stream: require('pino-pretty')({
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        })
      },
      {
        stream: fs.createWriteStream(logFile, { flags: 'a' })
      }
    ];

    this.pinoLogger = pino({
      level: options.level || 'debug',
      redact: {
        paths: [
          'token', 'HF_TOKEN', 'OPENAI_API_KEY', 'password', 'key',
          '*.token', '*.HF_TOKEN', '*.OPENAI_API_KEY', '*.password', '*.key'
        ],
        censor: '[REDACTED]'
      }
    }, pino.multistream(streams));
  }

  debug(msg, meta = {}) { this.pinoLogger.debug(meta || {}, msg); }
  info(msg, meta = {}) { this.pinoLogger.info(meta || {}, msg); }
  warn(msg, meta = {}) { this.pinoLogger.warn(meta || {}, msg); }
  error(msg, meta = {}) { this.pinoLogger.error(meta || {}, msg); }
  critical(msg, meta = {}) { this.pinoLogger.fatal(meta || {}, msg); }
  security(msg, meta = {}) { this.pinoLogger.info({ security: true, ...(meta || {}) }, `[SECURITY] ${msg}`); }
  perf(msg, meta = {}) { this.pinoLogger.info({ performance: true, ...(meta || {}) }, `[PERFORMANCE] ${msg}`); }
}

module.exports = Logger;
