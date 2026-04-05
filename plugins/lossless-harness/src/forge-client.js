'use strict';

// HTTP client for all Forge middleware API calls.
// Injects x-forge-key on every request. Returns { status, data } objects.
// Handles non-JSON responses gracefully.

class ForgeClient {
  /**
   * @param {{ forgeUrl: string, forgeApiKey: string, containerId: string }} config
   * @param {{ debug, info, warn, error }} logger
   */
  constructor(config, logger) {
    this.forgeUrl    = config.forgeUrl;
    this.containerId = config.containerId;
    this.logger      = logger;
    this._headers    = {
      'Content-Type': 'application/json',
      'x-forge-key': config.forgeApiKey,
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  async _request(method, path, body) {
    const url = `${this.forgeUrl}${path}`;
    const options = { method, headers: this._headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    this.logger.debug('forge request', { method, url });

    let resp;
    try {
      resp = await fetch(url, options);
    } catch (err) {
      this.logger.error('forge unreachable', { url, error: err.message });
      throw err;
    }

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON body — return raw text so callers can surface it
      data = { raw: text };
    }

    this.logger.debug('forge response', { status: resp.status, url });
    return { status: resp.status, data };
  }

  _get(path)         { return this._request('GET',    path); }
  _post(path, body)  { return this._request('POST',   path, body); }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register this container with Forge.
   * @param {{ container_id, project_name, repo_url, host, port,
   *           telegram_bot_token, telegram_chat_id }} details
   */
  register(details) {
    return this._post('/forge/register', details);
  }

  /**
   * Submit a build request to Forge.
   * @param {{ description, is_new_project, priority?, build_mode? }} payload
   */
  submitRequest(payload) {
    return this._post('/forge/request', {
      container_id: this.containerId,
      ...payload,
    });
  }

  /**
   * Get status for a specific task.
   * @param {string} taskId
   */
  getStatus(taskId) {
    return this._get(`/forge/status/${encodeURIComponent(taskId)}`);
  }

  /**
   * List tasks for this container, with optional extra query params.
   * @param {Record<string, string>} [extra] - Additional query params
   */
  listTasks(extra = {}) {
    const params = new URLSearchParams({
      container_id: this.containerId,
      ...extra,
    });
    return this._get(`/forge/tasks?${params.toString()}`);
  }

  /**
   * Fetch the most recent task for this container.
   */
  getLatestTask() {
    return this.listTasks({ limit: '1' });
  }

  /**
   * Cancel a specific task.
   * @param {string} taskId
   */
  cancelTask(taskId) {
    return this._post(`/forge/cancel/${encodeURIComponent(taskId)}`);
  }

  /**
   * Emergency stop — halt the current active task for this container.
   */
  emergencyStop() {
    return this._post('/forge/stop', { container_id: this.containerId });
  }
}

module.exports = { ForgeClient };
