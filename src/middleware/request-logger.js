// backend/src/middleware/request-logger.js
const { logger } = require('../utils/logger');

module.exports = (req, res, next) => {
  logger.info('HTTP', {
    method: req.method,
    path: req.path,
    origin: req.headers.origin,
    userId: req.user?.uid,
  });
  next();
};


