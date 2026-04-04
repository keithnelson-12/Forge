#!/bin/bash
set -e

echo "╔══════════════════════════════════════════════════╗"
echo "║  Forge Container: ${CONTAINER_ID:-unknown}       "
echo "║  Project: ${PROJECT_NAME:-unknown}               "
echo "║  Forge URL: ${FORGE_URL:-not set}                "
echo "╚══════════════════════════════════════════════════╝"

# Validate required env vars
MISSING=""
[ -z "$FORGE_URL" ] && MISSING="$MISSING FORGE_URL"
[ -z "$FORGE_API_KEY" ] && MISSING="$MISSING FORGE_API_KEY"
[ -z "$CONTAINER_ID" ] && MISSING="$MISSING CONTAINER_ID"
[ -z "$PROJECT_NAME" ] && MISSING="$MISSING PROJECT_NAME"
[ -z "$REPO_URL" ] && MISSING="$MISSING REPO_URL"
[ -z "$TELEGRAM_BOT_TOKEN" ] && MISSING="$MISSING TELEGRAM_BOT_TOKEN"
[ -z "$TELEGRAM_CHAT_ID" ] && MISSING="$MISSING TELEGRAM_CHAT_ID"

if [ -n "$MISSING" ]; then
  echo "ERROR: Missing required environment variables:$MISSING"
  echo "Copy .env.example to .env and fill in all values."
  exit 1
fi

# Register with Forge middleware
echo "Registering with Forge at ${FORGE_URL}..."
REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${FORGE_URL}/forge/register" \
  -H "Content-Type: application/json" \
  -H "x-forge-key: ${FORGE_API_KEY}" \
  -d "{
    \"container_id\": \"${CONTAINER_ID}\",
    \"project_name\": \"${PROJECT_NAME}\",
    \"repo_url\": \"${REPO_URL}\",
    \"host\": \"$(hostname -I | awk '{print $1}')\",
    \"port\": ${PLUGIN_PORT:-8080},
    \"telegram_bot_token\": \"${TELEGRAM_BOT_TOKEN}\",
    \"telegram_chat_id\": \"${TELEGRAM_CHAT_ID}\"
  }" 2>/dev/null || echo -e "\nfailed")

HTTP_CODE=$(echo "$REGISTER_RESPONSE" | tail -1)
BODY=$(echo "$REGISTER_RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  echo "Registered successfully with Forge."
else
  echo "WARNING: Registration with Forge returned $HTTP_CODE — will retry in background."
  echo "Response: $BODY"
fi

# Start the thin plugin
echo "Starting lossless-harness plugin on port ${PLUGIN_PORT:-8080}..."
cd /app/plugin
exec node index.js
