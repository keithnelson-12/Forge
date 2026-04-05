'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Snapshot of env vars we touch so we can restore them after each test
const ENV_KEYS = [
  'FORGE_URL',
  'FORGE_API_KEY',
  'CONTAINER_ID',
  'PLUGIN_PORT',
  'PLUGIN_HOST',
  'LOG_LEVEL',
  'PROJECT_NAME',
  'REPO_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

describe('loadConfig', () => {
  let saved = {};

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    });
    // Bust the require cache so each test gets a fresh module evaluation
    delete require.cache[require.resolve('../src/config.js')];
  });

  function fresh() {
    delete require.cache[require.resolve('../src/config.js')];
    return require('../src/config.js');
  }

  it('returns config when all required vars are set', () => {
    process.env.FORGE_URL = 'http://forge:3000';
    process.env.FORGE_API_KEY = 'secret-key';
    process.env.CONTAINER_ID = 'container-1';

    const { loadConfig } = fresh();
    const cfg = loadConfig();

    assert.equal(cfg.forgeUrl, 'http://forge:3000');
    assert.equal(cfg.forgeApiKey, 'secret-key');
    assert.equal(cfg.containerId, 'container-1');
  });

  it('applies defaults for optional vars', () => {
    process.env.FORGE_URL = 'http://forge:3000';
    process.env.FORGE_API_KEY = 'secret-key';
    process.env.CONTAINER_ID = 'container-1';

    const { loadConfig } = fresh();
    const cfg = loadConfig();

    assert.equal(cfg.port, 8080);
    assert.equal(cfg.pluginHost, '0.0.0.0');
    assert.equal(cfg.logLevel, 'info');
    assert.equal(cfg.projectName, '');
    assert.equal(cfg.repoUrl, '');
    assert.equal(cfg.telegramBotToken, '');
    assert.equal(cfg.telegramChatId, '');
  });

  it('respects optional env var overrides', () => {
    process.env.FORGE_URL = 'http://forge:3000';
    process.env.FORGE_API_KEY = 'secret-key';
    process.env.CONTAINER_ID = 'container-1';
    process.env.PLUGIN_PORT = '9090';
    process.env.PLUGIN_HOST = '10.0.0.1';
    process.env.LOG_LEVEL = 'debug';
    process.env.PROJECT_NAME = 'my-project';
    process.env.REPO_URL = 'https://github.com/org/repo';
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.TELEGRAM_CHAT_ID = '12345';

    const { loadConfig } = fresh();
    const cfg = loadConfig();

    assert.equal(cfg.port, 9090);
    assert.equal(cfg.pluginHost, '10.0.0.1');
    assert.equal(cfg.logLevel, 'debug');
    assert.equal(cfg.projectName, 'my-project');
    assert.equal(cfg.repoUrl, 'https://github.com/org/repo');
    assert.equal(cfg.telegramBotToken, 'bot-token');
    assert.equal(cfg.telegramChatId, '12345');
  });

  it('throws when FORGE_URL is missing', () => {
    process.env.FORGE_API_KEY = 'secret-key';
    process.env.CONTAINER_ID = 'container-1';

    const { loadConfig } = fresh();
    assert.throws(
      () => loadConfig(),
      (err) => {
        assert.match(err.message, /FORGE_URL/);
        return true;
      }
    );
  });

  it('throws when FORGE_API_KEY is missing', () => {
    process.env.FORGE_URL = 'http://forge:3000';
    process.env.CONTAINER_ID = 'container-1';

    const { loadConfig } = fresh();
    assert.throws(
      () => loadConfig(),
      (err) => {
        assert.match(err.message, /FORGE_API_KEY/);
        return true;
      }
    );
  });

  it('throws when CONTAINER_ID is missing', () => {
    process.env.FORGE_URL = 'http://forge:3000';
    process.env.FORGE_API_KEY = 'secret-key';

    const { loadConfig } = fresh();
    assert.throws(
      () => loadConfig(),
      (err) => {
        assert.match(err.message, /CONTAINER_ID/);
        return true;
      }
    );
  });

  it('includes all missing vars in the error message', () => {
    // No env vars set — all three required are missing
    const { loadConfig } = fresh();
    assert.throws(
      () => loadConfig(),
      (err) => {
        assert.match(err.message, /FORGE_URL/);
        assert.match(err.message, /FORGE_API_KEY/);
        assert.match(err.message, /CONTAINER_ID/);
        return true;
      }
    );
  });
});
