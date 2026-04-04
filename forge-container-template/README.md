# Forge Container Template

Ready-to-use Docker scaffold for spinning up a new per-repo OpenClaw container with the `lossless-harness` plugin pre-installed.

Each container manages one GitHub repository and communicates with the Dev Harness through the Forge middleware.

## Setup

### 1. Copy this directory

```bash
cp -r forge-container-template/ my-project-container/
cd my-project-container/
```

### 2. Create a Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdef...`)
4. Start a conversation with your new bot (send `/start`)
5. Get your chat ID:
   ```bash
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Look for `"chat":{"id":123456789}` in the response

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Description | Example |
|----------|-------------|---------|
| `FORGE_URL` | Forge middleware URL (not localhost) | `http://10.20.0.85:4100` |
| `FORGE_API_KEY` | Shared secret (must match Forge server) | `my-secure-key-123` |
| `CONTAINER_ID` | Unique container identifier | `my-project-prod` |
| `PROJECT_NAME` | Project name (must match DH project) | `my-project` |
| `REPO_URL` | GitHub repository URL | `https://github.com/org/repo` |
| `TELEGRAM_BOT_TOKEN` | From BotFather (step 2) | `123456789:ABCdef...` |
| `TELEGRAM_CHAT_ID` | From getUpdates (step 2) | `123456789` |

### 4. Register the project in Dev Harness

The project must be registered in DH before the container can submit builds:

```bash
curl -X POST http://<HARNESS_HOST>:4000/v1/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-project",
    "repo_url": "https://github.com/org/repo",
    "description": "My project"
  }'
```

### 5. Start the container

```bash
docker compose up -d
```

Check logs:
```bash
docker compose logs -f
```

The container will automatically register with Forge on startup. You should see:
```
Registered successfully with Forge.
[lossless-harness] Plugin listening on port 8080
```

## How it works

```
Your Telegram ↔ OpenClaw Agent (in container)
                     ↓
              lossless-harness plugin (thin HTTP client)
                     ↓
              Forge Middleware (routing + registry)
                     ↓
              Dev Harness (planning + generation + grading)
                     ↓
              Forge Middleware (receives SSE events)
                     ↓
              Telegram notification → Your Telegram
```

## Plugin API

The plugin exposes these endpoints inside the container:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/harness/submit` | POST | Submit a build request |
| `/harness/status/:taskId?` | GET | Get task status (latest if no ID) |
| `/harness/list` | GET | List recent tasks |
| `/harness/cancel/:taskId` | POST | Cancel a task |
| `/harness/stop` | POST | Emergency stop all runs |

## Troubleshooting

**Container can't reach Forge:**
- Check `FORGE_URL` is the actual host IP, not `localhost`
- Verify Forge is running: `curl $FORGE_URL/forge/registry`
- Check network: `docker compose exec openclaw-container curl $FORGE_URL/forge/registry`

**Registration fails:**
- Check `FORGE_API_KEY` matches between container and Forge server
- The container retries registration — check logs for updates

**No Telegram notifications:**
- Verify bot token with: `curl https://api.telegram.org/bot<TOKEN>/getMe`
- Verify chat ID with: `curl https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=test`
- Check Forge logs for notification send errors

**Build requests fail:**
- Ensure `PROJECT_NAME` matches a registered project in Dev Harness
- Check Forge logs for forwarding errors
