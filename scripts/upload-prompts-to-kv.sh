#!/bin/bash

# Upload prompt YAML files to Cloudflare KV
# This script uploads all prompts from the prompts/ directory to APP_CONFIG_KV

set -e

echo "Uploading prompts to Cloudflare KV..."

# Change to the briefings app directory
cd "$(dirname "$0")/.."

# Upload each prompt file
for file in prompts/*.yaml; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    key="prompts/$filename"
    
    echo "Uploading $filename to KV key: $key"
    
    # Upload to production KV namespace
    wrangler kv:key put "$key" --path "$file" \
      --binding APP_CONFIG_KV \
      --preview false
  fi
done

echo "✅ All prompts uploaded successfully!"
echo ""
echo "Uploaded prompts:"
wrangler kv:key list --binding APP_CONFIG_KV --prefix "prompts/" --preview false