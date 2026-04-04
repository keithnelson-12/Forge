// lossless-harness — Thin OpenClaw plugin for Forge middleware integration
//
// This plugin runs inside each per-repo OpenClaw container.
// All logic lives in Forge — this is just a thin HTTP client + local API.
//
// Capabilities exposed to the OpenClaw agent:
//   harness_submit(description, is_new_project, priority?)
//   harness_status(task_id?)
//   harness_list()
//   harness_cancel(task_id)
//   harness_stop()

const express = require("express");
const app = express();
app.use(express.json());

const FORGE_URL = process.env.FORGE_URL;
const FORGE_API_KEY = process.env.FORGE_API_KEY;
const CONTAINER_ID = process.env.CONTAINER_ID;
const PORT = process.env.PLUGIN_PORT || 8080;

const headers = {
  "Content-Type": "application/json",
  "x-forge-key": FORGE_API_KEY,
};

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    container_id: CONTAINER_ID,
    forge_url: FORGE_URL,
    uptime: process.uptime(),
  });
});

// Submit a build request
app.post("/harness/submit", async (req, res) => {
  try {
    const { description, is_new_project, priority, build_mode } = req.body;
    if (!description) {
      return res.status(400).json({ error: "description is required" });
    }
    const resp = await fetch(`${FORGE_URL}/forge/request`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        container_id: CONTAINER_ID,
        description,
        is_new_project: is_new_project ?? false,
        priority,
        build_mode,
      }),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: `Forge unreachable: ${err.message}` });
  }
});

// Get task status
app.get("/harness/status/:taskId?", async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const url = taskId
      ? `${FORGE_URL}/forge/status/${taskId}`
      : `${FORGE_URL}/forge/tasks?container_id=${CONTAINER_ID}&limit=1`;
    const resp = await fetch(url, { headers });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: `Forge unreachable: ${err.message}` });
  }
});

// List recent tasks
app.get("/harness/list", async (_req, res) => {
  try {
    const resp = await fetch(
      `${FORGE_URL}/forge/tasks?container_id=${CONTAINER_ID}`,
      { headers }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: `Forge unreachable: ${err.message}` });
  }
});

// Cancel a task
app.post("/harness/cancel/:taskId", async (req, res) => {
  try {
    const resp = await fetch(
      `${FORGE_URL}/forge/cancel/${req.params.taskId}`,
      { method: "POST", headers }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: `Forge unreachable: ${err.message}` });
  }
});

// Emergency stop
app.post("/harness/stop", async (_req, res) => {
  try {
    const resp = await fetch(`${FORGE_URL}/forge/stop`, {
      method: "POST",
      headers,
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: `Forge unreachable: ${err.message}` });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[lossless-harness] Plugin listening on port ${PORT}`);
  console.log(`[lossless-harness] Container: ${CONTAINER_ID}`);
  console.log(`[lossless-harness] Forge: ${FORGE_URL}`);
});
