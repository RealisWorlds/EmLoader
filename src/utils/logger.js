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

export const logger = {
  error: (...args) => {
    if (currentLevel >= LOG_LEVELS.ERROR) console.error('[ERROR]', ...args);
  },
  warn: (...args) => {
    if (currentLevel >= LOG_LEVELS.WARN) console.warn('[WARN]', ...args);
  },
  info: (...args) => {
    if (currentLevel >= LOG_LEVELS.INFO) console.log('[INFO]', ...args);
  },
  debug: (...args) => {
    if (currentLevel >= LOG_LEVELS.DEBUG) console.log('[DEBUG]', ...args);
  },
  trace: (...args) => {
    if (currentLevel >= LOG_LEVELS.TRACE) console.log('[TRACE]', ...args);
  }
};

// Convenience method for backward compatibility
export const log = logger.info;