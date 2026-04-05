'use strict';

// Structured NDJSON logger with configurable minimum level.
// Info/debug/warn go to stdout; error goes to stderr.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * @param {string} minLevel - Minimum log level to emit ('debug'|'info'|'warn'|'error')
 * @returns {{ debug, info, warn, error }} Logger object
 */
function createLogger(minLevel = 'info') {
  const minNum = LEVELS[minLevel] ?? LEVELS.info;

  function log(level, message, extra = {}) {
    if ((LEVELS[level] ?? 0) < minNum) return;

    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...extra,
    });

    if (level === 'error') {
      process.stderr.write(entry + '\n');
    } else {
      process.stdout.write(entry + '\n');
    }
  }

  return {
    debug: (message, extra) => log('debug', message, extra),
    info:  (message, extra) => log('info',  message, extra),
    warn:  (message, extra) => log('warn',  message, extra),
    error: (message, extra) => log('error', message, extra),
  };
}

module.exports = { createLogger };
