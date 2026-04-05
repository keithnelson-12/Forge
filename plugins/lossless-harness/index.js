'use strict';

// lossless-harness — Thin OpenClaw plugin for Forge middleware integration
//
// Runs inside each per-repo OpenClaw container. Exposes a local HTTP API that
// the OpenClaw agent calls; every call is proxied to the Forge middleware.
// All business logic lives in Forge — this plugin is intentionally minimal.
//
// Endpoints:
//   POST /harness/submit         — submit a build request
//   GET  /harness/status/:taskId — status of a specific task
//   GET  /harness/status         — status of the latest task
//   GET  /harness/list           — list recent tasks for this container
//   POST /harness/cancel/:taskId — cancel a task
//   POST /harness/stop           — emergency stop all runs
//   GET  /health                 — health check

const express = require('express');
const { ForgeClient } = require('./src/forge-client.js');
const { createLogger } = require('./src/logger.js');
const { loadConfig } = require('./src/config.js');

// ── App factory ────────────────────────────────────────────────────────────
//
// Exported so tests can construct the app with a mock ForgeClient without
// needing real env vars or a running Forge server.

/**
 * Build and return the Express application wired to the given ForgeClient.
 *
 * @param {ForgeClient} forgeClient
 * @param {{ containerId: string, forgeUrl: string }} config
 * @returns {import('express').Application}
 */
function createApp(forgeClient, config) {
  const app = express();
  app.use(express.json());

  // ── Health ───────────────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      container_id: config.containerId,
      forge_url: config.forgeUrl,
      uptime: process.uptime(),
    });
  });

  // ── Build operations ─────────────────────────────────────────────────────

  /**
   * POST /harness/submit
   * Body: { description, is_new_project?, priority?, build_mode? }
   */
  app.post('/harness/submit', async (req, res) => {
    const { description, is_new_project, priority, build_mode } = req.body || {};
    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }
    try {
      const result = await forgeClient.submitRequest({
        description,
        is_new_project: is_new_project ?? false,
        priority,
        build_mode,
      });
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: `Forge unreachable: ${err.message}` });
    }
  });

  /**
   * GET /harness/status/:taskId — status of a specific task.
   * Separate from the no-taskId route because Express 4.x (path-to-regexp 0.1.x)
   * does not support optional path segments (:param?).
   */
  app.get('/harness/status/:taskId', async (req, res) => {
    try {
      const result = await forgeClient.getStatus(req.params.taskId);
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: `Forge unreachable: ${err.message}` });
    }
  });

  /**
   * GET /harness/status — returns the most recent task for this container.
   */
  app.get('/harness/status', async (_req, res) => {
    try {
      const result = await forgeClient.getLatestTask();
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: `Forge unreachable: ${err.message}` });
    }
  });

  /**
   * GET /harness/list — list recent tasks for this container.
   */
  app.get('/harness/list', async (_req, res) => {
    try {
      const result = await forgeClient.listTasks();
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: `Forge unreachable: ${err.message}` });
    }
  });

  /**
   * POST /harness/cancel/:taskId — cancel the specified task.
   */
  app.post('/harness/cancel/:taskId', async (req, res) => {
    try {
      const result = await forgeClient.cancelTask(req.params.taskId);
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: `Forge unreachable: ${err.message}` });
    }
  });

  /**
   * POST /harness/stop — emergency stop; halts the active task for this container.
   */
  app.post('/harness/stop', async (_req, res) => {
    try {
      const result = await forgeClient.emergencyStop();
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: `Forge unreachable: ${err.message}` });
    }
  });

  return app;
}

// ── Auto-registration ──────────────────────────────────────────────────────

/**
 * Register this container with Forge. Failure is logged as a warning but
 * never prevents startup.
 */
async function register(forgeClient, config, logger) {
  try {
    const result = await forgeClient.register({
      container_id:       config.containerId,
      project_name:       config.projectName,
      repo_url:           config.repoUrl,
      host:               config.pluginHost,
      port:               config.port,
      telegram_bot_token: config.telegramBotToken,
      telegram_chat_id:   config.telegramChatId,
    });
    if (result.status >= 400) {
      logger.warn('forge registration returned error', {
        status: result.status,
        data: result.data,
      });
    } else {
      logger.info('registered with forge', { container_id: config.containerId });
    }
  } catch (err) {
    logger.warn('forge registration failed — startup continues', {
      error: err.message,
    });
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

/**
 * Start the HTTP server, register with Forge, and return the server instance.
 * Exported so tests can start/stop the server on a dynamic port.
 *
 * @param {import('express').Application} app
 * @param {ForgeClient} forgeClient
 * @param {object} config
 * @param {{ info, warn, error }} logger
 * @returns {import('http').Server}
 */
function startServer(app, forgeClient, config, logger) {
  return app.listen(config.port, '0.0.0.0', async () => {
    logger.info('lossless-harness plugin started', {
      port: config.port,
      host: '0.0.0.0',
      container_id: config.containerId,
      forge_url: config.forgeUrl,
    });
    await register(forgeClient, config, logger);
  });
}

// ── Entry point ────────────────────────────────────────────────────────────

// Auto-start only when invoked directly (not when required by tests).
if (require.main === module) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`[lossless-harness] ${err.message}\n`);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  const forgeClient = new ForgeClient(config, logger);
  const app = createApp(forgeClient, config);
  startServer(app, forgeClient, config, logger);
}

// Export for tests — tests can call createApp() with a mock ForgeClient
// without needing real env vars.
module.exports = { createApp, startServer };
