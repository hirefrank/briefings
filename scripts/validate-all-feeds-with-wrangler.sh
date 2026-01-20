#!/bin/bash

echo "🔍 Getting all feeds from database..."
echo ""

# Get all feeds as JSON
FEEDS_JSON=$(pnpm wrangler d1 execute briefings-db --remote --json --command="SELECT id, name, url, isActive FROM Feed ORDER BY name" 2>/dev/null | grep -A 10000 '"results"' | jq -r '.results')

if [ -z "$FEEDS_JSON" ]; then
  echo "❌ Failed to fetch feeds from database"
  exit 1
fi

# Count total feeds
TOTAL_FEEDS=$(echo "$FEEDS_JSON" | jq 'length')
echo "Found $TOTAL_FEEDS total feeds"
echo ""
echo "🔄 Validating EVERY feed..."
echo ""

# Create temp file for results
RESULTS_FILE="feed-validation-results-$(date +%Y%m%d-%H%M%S).txt"
INVALID_FILE="invalid-feeds-$(date +%Y%m%d-%H%M%S).txt"

# Initialize counters
VALID_COUNT=0
INVALID_COUNT=0
ACTIVE_INVALID_COUNT=0

# Header for results
echo "Feed Validation Results - $(date)" > "$RESULTS_FILE"
echo "=================================" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

echo "INVALID FEEDS:" > "$INVALID_FILE"
echo "==============" >> "$INVALID_FILE"
echo "" >> "$INVALID_FILE"

# Process each feed
echo "$FEEDS_JSON" | jq -c '.[]' | while IFS= read -r feed; do
  ID=$(echo "$feed" | jq -r '.id')
  NAME=$(echo "$feed" | jq -r '.name')
  URL=$(echo "$feed" | jq -r '.url')
  IS_ACTIVE=$(echo "$feed" | jq -r '.isActive')
  
  # Progress counter
  CURRENT=$((VALID_COUNT + INVALID_COUNT + 1))
  
  printf "[%d/%d] %-50s " "$CURRENT" "$TOTAL_FEEDS" "${NAME:0:50}"
  
  # Validate the feed
  RESPONSE=$(curl -s -L -m 15 -w '\n%{http_code}' \
    -H "User-Agent: Mozilla/5.0 (compatible; FeedValidator/1.0)" \
    -H "Accept: application/rss+xml, application/atom+xml, application/xml, text/xml, */*" \
    "$URL" 2>/dev/null)
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  CONTENT=$(echo "$RESPONSE" | sed '$d')
  
  # Check response
  if [ "$HTTP_CODE" != "200" ]; then
    echo "❌ HTTP $HTTP_CODE"
    echo "❌ $NAME - HTTP $HTTP_CODE - $URL" >> "$INVALID_FILE"
    if [ "$IS_ACTIVE" = "1" ]; then
      echo "   [ACTIVE]" >> "$INVALID_FILE"
      ((ACTIVE_INVALID_COUNT++))
    fi
    ((INVALID_COUNT++))
  elif echo "$CONTENT" | head -c 1000 | grep -qE '<(rss|channel|feed|atom)'; then
    # It's likely an RSS/Atom feed
    if echo "$CONTENT" | grep -q '<rss'; then
      echo "✅ RSS"
    elif echo "$CONTENT" | grep -q 'xmlns="http://www.w3.org/2005/Atom"'; then
      echo "✅ Atom"
    else
      echo "✅ Feed"
    fi
    ((VALID_COUNT++))
  else
    # Not RSS/Atom
    echo "❌ Not RSS/Atom"
    echo "❌ $NAME - Not RSS/Atom content - $URL" >> "$INVALID_FILE"
    if [ "$IS_ACTIVE" = "1" ]; then
      echo "   [ACTIVE]" >> "$INVALID_FILE"
      ((ACTIVE_INVALID_COUNT++))
    fi
    ((INVALID_COUNT++))
  fi
  
  # Small delay
  sleep 0.1
done

echo ""
echo ""
echo "📊 Final Results:"
echo "================="
echo "✅ Valid feeds: $VALID_COUNT/$TOTAL_FEEDS"
echo "❌ Invalid feeds: $INVALID_COUNT/$TOTAL_FEEDS"
echo "⚠️  Active invalid feeds: $ACTIVE_INVALID_COUNT"
echo ""
echo "💾 Invalid feeds saved to: $INVALID_FILE"
echo "💾 Full results saved to: $RESULTS_FILE"