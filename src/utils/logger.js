/**
 * Logger utility module for application logging
 * @module utils/logger
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Get current log level from environment or default to 'info'
const currentLevel = process.env.LOG_LEVEL || 'info';
const currentLevelValue = LOG_LEVELS[currentLevel] || LOG_LEVELS.info;

/**
 * Format log message with timestamp and additional data
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} [data] - Additional data to log
 * @returns {string} Formatted log message
 */
const formatLog = (level, message, data) => {
  const timestamp = new Date().toISOString();
  const baseMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  if (data) {
    if (data instanceof Error) {
      return `${baseMessage}\n${data.stack || data.message}`;
    }
    if (typeof data === 'object') {
      try {
        return `${baseMessage}\n${JSON.stringify(data, null, 2)}`;
      } catch (error) {
        return `${baseMessage}\n[Object cannot be stringified]`;
      }
    }
    return `${baseMessage}\n${data}`;
  }
  
  return baseMessage;
};

/**
 * Logger object with different log level methods
 */
const logger = {
  /**
   * Log error message
   * @param {string} message - Error message
   * @param {Object} [data] - Additional error data
   */
  error: (message, data) => {
    if (currentLevelValue >= LOG_LEVELS.error) {
      console.error(formatLog('error', message, data));
    }
  },
  
  /**
   * Log warning message
   * @param {string} message - Warning message
   * @param {Object} [data] - Additional warning data
   */
  warn: (message, data) => {
    if (currentLevelValue >= LOG_LEVELS.warn) {
      console.warn(formatLog('warn', message, data));
    }
  },
  
  /**
   * Log info message
   * @param {string} message - Info message
   * @param {Object} [data] - Additional info data
   */
  info: (message, data) => {
    if (currentLevelValue >= LOG_LEVELS.info) {
      console.info(formatLog('info', message, data));
    }
  },
  
  /**
   * Log debug message
   * @param {string} message - Debug message
   * @param {Object} [data] - Additional debug data
   */
  debug: (message, data) => {
    if (currentLevelValue >= LOG_LEVELS.debug) {
      console.debug(formatLog('debug', message, data));
    }
  }
};

module.exports = logger;