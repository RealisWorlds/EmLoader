// src/utils/logger.js
import settings from '../../settings.js';

// Define log levels
export const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

// Default to INFO level if not specified in settings
const currentLevel = settings.logLevel !== undefined ? settings.logLevel : LOG_LEVELS.INFO;

// add timestamp to these, format: [LEVEL HH:mm:ss]
export const logger = {
  error: (...args) => {
    if (currentLevel >= LOG_LEVELS.ERROR) {
      const timestamp = new Date().toTimeString().split(' ')[0];
      console.error(`[ERROR ${timestamp}]`, ...args);
    }
  },
  warn: (...args) => {
    if (currentLevel >= LOG_LEVELS.WARN) {
      const timestamp = new Date().toTimeString().split(' ')[0];
      console.warn(`[WARN ${timestamp}]`, ...args);
    }
  },
  info: (...args) => {
    if (currentLevel >= LOG_LEVELS.INFO) {
      const timestamp = new Date().toTimeString().split(' ')[0];
      console.log(`[INFO ${timestamp}]`, ...args);
    }
  },
  debug: (...args) => {
    if (currentLevel >= LOG_LEVELS.DEBUG) {
      const timestamp = new Date().toTimeString().split(' ')[0];
      console.log(`[DEBUG ${timestamp}]`, ...args);
    }
  },
  trace: (...args) => {
    if (currentLevel >= LOG_LEVELS.TRACE) {
      const timestamp = new Date().toTimeString().split(' ')[0];
      console.log(`[TRACE ${timestamp}]`, ...args);
    }
  }
};

// Convenience method for backward compatibility
export const log = logger.info;