const pino = require('pino');
const fs = require('fs');
const path = require('path');

class Logger {
  constructor(options = {}) {
    const streams = [];

    try {
      const pinoPretty = require('pino-pretty');
      streams.push({
        stream: pinoPretty({
          colorize: false,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        })
      });
    } catch (e) {
      streams.push({ stream: process.stdout });
    }

    try {
      const logDir = options.logDir || path.join(__dirname, '../../logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logFile = path.join(logDir, 'bot.log');
      streams.push({ stream: fs.createWriteStream(logFile, { flags: 'a' }) });
    } catch (e) {
      // Safe fallback
    }

    try {
      this.pinoLogger = pino({
        level: options.level || 'debug',
        redact: {
          paths: [
            'token', 'HF_TOKEN', 'OPENAI_API_KEY', 'password', 'key',
            '*.token', '*.HF_TOKEN', '*.OPENAI_API_KEY', '*.password', '*.key'
          ],
          censor: '[REDACTED]'
        }
      }, pino.multistream(streams.length > 0 ? streams : [{ stream: process.stdout }]));
    } catch (e) {
      this.pinoLogger = console;
    }
  }

  debug(msg, meta = {}) { (this.pinoLogger.debug || console.log).call(this.pinoLogger, meta || {}, msg); }
  info(msg, meta = {}) { (this.pinoLogger.info || console.log).call(this.pinoLogger, meta || {}, msg); }
  warn(msg, meta = {}) { (this.pinoLogger.warn || console.warn).call(this.pinoLogger, meta || {}, msg); }
  error(msg, meta = {}) { (this.pinoLogger.error || console.error).call(this.pinoLogger, meta || {}, msg); }
  critical(msg, meta = {}) { (this.pinoLogger.fatal || this.pinoLogger.error || console.error).call(this.pinoLogger, meta || {}, msg); }
  security(msg, meta = {}) { (this.pinoLogger.info || console.log).call(this.pinoLogger, { security: true, ...(meta || {}) }, `[SECURITY] ${msg}`); }
  perf(msg, meta = {}) { (this.pinoLogger.info || console.log).call(this.pinoLogger, { performance: true, ...(meta || {}) }, `[PERFORMANCE] ${msg}`); }
}

module.exports = Logger;
