'use strict';

// Validates and exports configuration from environment variables.
// Throws on missing required vars — caller decides whether to exit or re-throw.

const REQUIRED = ['FORGE_URL', 'FORGE_API_KEY', 'CONTAINER_ID'];

/**
 * Load and validate plugin configuration from environment variables.
 *
 * Required:
 *   FORGE_URL       — full base URL of the Forge middleware
 *   FORGE_API_KEY   — shared secret for authenticating with Forge
 *   CONTAINER_ID    — unique identifier for this container
 *
 * Optional:
 *   PLUGIN_PORT         — port this plugin listens on (default: 8080)
 *   PLUGIN_HOST         — bind address (default: 0.0.0.0)
 *   LOG_LEVEL           — debug | info | warn | error (default: info)
 *   PROJECT_NAME        — human-readable project name passed to Forge on registration
 *   REPO_URL            — GitHub repo URL passed to Forge on registration
 *   TELEGRAM_BOT_TOKEN  — Telegram bot token for this container
 *   TELEGRAM_CHAT_ID    — Telegram chat ID for this container
 *
 * @returns {object} Validated configuration object
 * @throws {Error} If any required variable is missing
 */
function loadConfig() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  return Object.freeze({
    forgeUrl:         process.env.FORGE_URL,
    forgeApiKey:      process.env.FORGE_API_KEY,
    containerId:      process.env.CONTAINER_ID,
    port:             parseInt(process.env.PLUGIN_PORT || '8080', 10),
    pluginHost:       process.env.PLUGIN_HOST || '0.0.0.0',
    logLevel:         process.env.LOG_LEVEL || 'info',
    projectName:      process.env.PROJECT_NAME || '',
    repoUrl:          process.env.REPO_URL || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId:   process.env.TELEGRAM_CHAT_ID || '',
  });
}

module.exports = { loadConfig };
