// backend/src/utils/logger.js - Logger para backend (CommonJS)
const winston = require('winston');

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  format: isDevelopment ? devFormat : prodFormat,
  defaultMeta: {
    service: 'controlfile-backend',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    new winston.transports.Console({ stderrLevels: ['error'] }),
  ],
});

if (isProduction) {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 5 * 1024 * 1024, maxFiles: 5 }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log', maxsize: 5 * 1024 * 1024, maxFiles: 5 }));
}

module.exports = { logger };


