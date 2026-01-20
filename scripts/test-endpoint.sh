#!/bin/bash

# Load environment variables from .env if it exists
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Load from .dev.vars if it exists (Cloudflare's local env file)
if [ -f .dev.vars ]; then
  export $(cat .dev.vars | grep -v '^#' | xargs)
fi

# Use the first argument as the endpoint
ENDPOINT=$1
METHOD=${2:-GET}
DATA=$3

# Determine the API URL (production or local)
if [[ "$ENDPOINT" == *":prod" ]]; then
  API_URL=${API_URL:-https://briefings.hirefrank.workers.dev}
  ENDPOINT=${ENDPOINT%:prod}
else
  API_URL=${API_URL:-http://localhost:8787}
fi

# Construct the full URL
FULL_URL="$API_URL$ENDPOINT"

# Build curl command
CURL_CMD="curl -i"

# Add method
if [ "$METHOD" != "GET" ]; then
  CURL_CMD="$CURL_CMD -X $METHOD"
fi

# Add API key header if available
if [ -n "$API_KEY" ] || [ -n "$ADMIN_API_KEY" ]; then
  KEY=${API_KEY:-$ADMIN_API_KEY}
  CURL_CMD="$CURL_CMD -H 'X-API-Key: $KEY'"
fi

# Add data if provided
if [ -n "$DATA" ]; then
  CURL_CMD="$CURL_CMD -H 'Content-Type: application/json' -d '$DATA'"
fi

# Add URL
CURL_CMD="$CURL_CMD '$FULL_URL'"

# Execute
echo "Executing: $CURL_CMD"
eval $CURL_CMD