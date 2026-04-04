# Phase: OpenClaw-to-Harness Integration Layer (Forge)

**Date:** 2026-04-02  
**Updated:** 2026-04-04 — aligned with current DH API (v1 prefix, V3 pipeline fields)

---

## Prompt for Claude Code

> We are building an OpenClaw-to-Harness integration layer. This is a new microservice called **Forge** that sits between OpenClaw project containers and the development harness. Review the entire existing harness codebase before starting.
>
> ---
>
> **Architecture overview:**
>
> ```
> Your Telegram
>      ↓
> Per-repo OpenClaw Container (thin plugin)
>      ↓
> Forge Middleware (new microservice)
>      ↓
> Development Harness HTTP API (v1)
> ```
>
> Status flows back:
>
> ```
> Development Harness
>      ↓ (SSE: GET /v1/events/stream)
> Forge Middleware
>      ↓
> Routes to correct Container's Telegram Bot
>      ↓
> Your Telegram
> ```
>
> **Critical design constraint:** All host addresses, ports, URLs, and Telegram tokens must be configurable — never hardcoded or assumed to be localhost. Containers and the harness may be on different machines in the future. Adding a new container or moving an existing one to a new machine must require only a config/registry update, zero code changes.
>
> ---
>
> **Part 1 — Forge Middleware (new microservice)**
>
> Create a standalone microservice called `forge` in a new `forge/` directory at the project root.
>
> **Container registry:**
> - Forge maintains a registry of known OpenClaw containers
> - Each registry entry contains:
>   - `container_id` — unique identifier for this container
>   - `project_name` — human readable project name (must match a registered project in DH via `POST /v1/projects`)
>   - `repo_url` — the GitHub repository this container is responsible for
>   - `host` — the host/IP where this container runs (never assumed to be localhost)
>   - `port` — the port the container's thin plugin listens on
>   - `telegram_bot_token` — the Telegram bot token for this container's bot
>   - `telegram_chat_id` — the chat ID to send status notifications to
>   - `registered_at` — timestamp
>   - `active` — boolean
> - Registry is persisted to DB — not a flat file
> - Registry is manageable via Forge's own admin API and via the Command Center UI
>
> **Forge API endpoints:**
>
> Container-facing (called by the thin plugin inside each container):
> - `POST /forge/register` — register or update a container in the registry
> - `POST /forge/request` — submit a build request on behalf of a container. Payload must include: container_id, description (what is being built), is_new_project (boolean). Optional: type ("build"|"grade"|"deploy"), build_mode ("chunk"|"design_first"), assignee. Forge validates, enriches with project_name and repo_url from the registry, and forwards to harness `POST /v1/requests`
> - `GET /forge/status/:task_id` — get high-level status of a task. Proxies to `GET /v1/runs/:task_id`. Returns one-line status only — no grading detail
> - `GET /forge/tasks?container_id=x` — list recent tasks for a specific container. Proxies to `GET /v1/runs` filtered by project_id (looked up from container registry)
> - `POST /forge/cancel/:task_id` — cancel a task, forwarded to harness `POST /v1/orchestrator/cancel/:task_id`
> - `POST /forge/stop` — emergency stop, forwarded to harness `POST /v1/orchestrator/emergency-stop`
>
> Admin-facing (called by Command Center):
> - `GET /forge/registry` — list all registered containers
> - `POST /forge/registry/:container_id` — update a registry entry
> - `DELETE /forge/registry/:container_id` — deregister a container
>
> **Harness status callback handling:**
> - Forge subscribes to harness task events via SSE (`GET /v1/events/stream`)
> - On high-level events (task complete, blocked, canceled, emergency stop) Forge:
>   - Looks up which container submitted the task using task ID → project_id → container registry
>   - Looks up that container's Telegram bot token and chat ID from the registry
>   - Sends a Telegram notification to that specific container's bot
>   - Never sends notifications to the wrong container's bot
> - Notification format:
>   - ✅ Complete: `"[project_name] — RELEASE READY | Task: [task_id]"`
>   - 🚫 Blocked: `"[project_name] — BLOCKED: [gate] — [one line reason] | Task: [task_id]"`
>   - ⛔ Canceled: `"[project_name] — CANCELED | Task: [task_id]"`
>   - 🛑 Emergency stop: `"ALL RUNS STOPPED — emergency stop activated"`
> - Notification failures are logged but never block anything
>
> **Harness API reference (current endpoints Forge needs to call):**
> - `POST /v1/projects` — register a project. Body: `{ name, repo_url, description?, local_checkout_path? }`
> - `POST /v1/requests` — submit a build request. Body: `{ description, project_name, is_new_project, repo_url, type?, build_mode?, assignee? }`
> - `GET /v1/runs` — list all task runs
> - `GET /v1/runs/:id` — get task detail with chunks, events, evaluations
> - `POST /v1/orchestrator/cancel/:taskId` — cancel a task
> - `POST /v1/orchestrator/emergency-stop` — emergency stop all runs
> - `GET /v1/orchestrator/status` — orchestrator status (running, queue size, current task)
> - `GET /v1/events/stream` — SSE stream for real-time task lifecycle events
>
> **Forge config (environment variables, never hardcoded):**
> - `FORGE_PORT` — port Forge listens on
> - `HARNESS_URL` — full base URL of the harness API (e.g. http://10.20.0.85:4000)
> - `FORGE_DB_PATH` — SQLite database path for the registry
> - `FORGE_API_KEY` — simple shared secret for authenticating container plugin calls
>
> ---
>
> **Part 2 — Thin OpenClaw Plugin (installed inside each container)**
>
> Create a plugin called `lossless-harness` following the same conventions as the existing `lossless-claw` plugin already installed on the system.
>
> This plugin must be as thin as possible — all logic lives in Forge, not here.
>
> **Plugin config (per container, set at container startup via environment variables):**
> - `FORGE_URL` — full URL of the Forge middleware (never assumed to be localhost)
> - `FORGE_API_KEY` — shared secret matching Forge's key
> - `CONTAINER_ID` — unique ID for this container, matching registry entry
>
> **Plugin behavior:**
> - On startup: call `POST /forge/register` with this container's details to ensure it is registered
> - Expose these capabilities to the OpenClaw agent inside the container:
>
> `harness_submit(description, is_new_project, priority?)` — submit a build request to Forge. The plugin automatically includes container_id and repo_url from its own config — the agent does not need to specify these.
>
> `harness_status(task_id?)` — get status of a specific task or most recent task if no ID given
>
> `harness_list()` — list recent tasks for this container
>
> `harness_cancel(task_id)` — cancel a task
>
> `harness_stop()` — emergency stop all runs
>
> **Agent interaction via Telegram:**
>
> The OpenClaw agent inside the container (whichever agent the user is talking to) should handle these natural language intents using the plugin capabilities above:
>
> - "Build X" / "Make X" / "Add X to the project" → calls `harness_submit`, confirms back with task ID
> - "What's the status?" / "How's the build going?" → calls `harness_status`, returns one-line answer
> - "Show recent builds" / "What has been done?" → calls `harness_list`, returns short list with status emoji
> - "Cancel that" / "Cancel task [ID]" → calls `harness_cancel`, confirms
> - "Stop everything" / "Emergency stop" → calls `harness_stop`, confirms
> - Ambiguous build request → agent asks one clarifying question before submitting. Maximum one question per submission flow.
>
> The agent should never dump raw API responses into Telegram. All responses must be human-readable and concise. Detail lives in the Command Center.
>
> **Agent autonomy:**
> - The agent may decide independently to submit a build request based on conversation context or its own judgment
> - When submitting autonomously it must notify the user via Telegram immediately: `"🔨 I've submitted a build request for [what]: Task [task_id]"`
> - Autonomous submissions follow the same path as manual ones — no special handling needed
>
> ---
>
> **Part 3 — Command Center UI additions**
>
> Add a **Forge** section to the Command Center sidebar navigation (as a new top-level section alongside Developer, Email, Health, Projects, Money, Settings):
> - Container registry table: shows all registered containers with container_id, project name, repo, host, active status, last seen
> - Each row has: edit host/port, deactivate, deregister actions
> - Add new container form: container_id, project name, repo URL, host, port, Telegram bot token, Telegram chat ID
> - Forge connection status: shows whether Forge middleware is reachable and its version
>
> Add a **Forge** column or filter to the main task list so tasks can be filtered by which container submitted them.
>
> ---
>
> **Part 4 — Docker scaffold for per-repo containers**
>
> Create a `forge-container-template/` directory with a ready-to-use Docker scaffold for spinning up a new per-repo OpenClaw container with the thin plugin pre-installed.
>
> The scaffold should include:
> - `Dockerfile` — based on the existing OpenClaw Docker setup, with `lossless-harness` plugin pre-installed
> - `docker-compose.yml` — with all required environment variables as placeholders with comments explaining each one
> - `.env.example` — documenting every required environment variable:
>   - `FORGE_URL` — URL of the Forge middleware
>   - `FORGE_API_KEY` — shared secret
>   - `CONTAINER_ID` — unique ID for this container
>   - `REPO_URL` — the GitHub repo this container manages
>   - `PROJECT_NAME` — human readable project name
>   - `TELEGRAM_BOT_TOKEN` — this container's Telegram bot token
>   - `TELEGRAM_CHAT_ID` — chat ID for notifications
> - `README.md` — step by step instructions for spinning up a new per-repo container:
>   1. Copy this directory
>   2. Fill in `.env`
>   3. Create a new Telegram bot via BotFather
>   4. Register the container with Forge
>   5. Start the container
>
> ---
>
> **Definition of done:**
>
> - Forge middleware starts cleanly and connects to the harness
> - A container using the thin plugin can register with Forge on startup
> - Submitting a build request from a container's Telegram bot results in a task appearing in the harness and Command Center
> - Task completion triggers a Telegram notification to the correct container's bot only — not to other containers
> - Moving a container to a new host requires only updating the registry entry in Forge — no code changes
> - Two containers for two different repos can run simultaneously with no cross-contamination of notifications or tasks
> - The Command Center registry view shows all containers and allows editing host/port without restart
> - The Docker scaffold can be copied, configured, and started to produce a working new per-repo container
> - All host addresses are configurable via environment variables — localhost never appears hardcoded anywhere in Forge or the plugin
