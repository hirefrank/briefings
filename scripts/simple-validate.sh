#!/bin/bash

echo "Validating all 126 feeds..."
echo ""

VALID=0
INVALID=0
COUNTER=0

# Create output file for invalid feeds
echo "INVALID RSS FEEDS" > invalid-feeds-report.txt
echo "=================" >> invalid-feeds-report.txt
echo "" >> invalid-feeds-report.txt

while IFS='|' read -r is_active name url id; do
  COUNTER=$((COUNTER + 1))
  printf "[%3d/126] %-50s " "$COUNTER" "${name:0:50}"
  
  # Fetch the feed
  RESPONSE=$(curl -s -L -m 10 -o /tmp/feed-content.tmp -w '%{http_code}' \
    -H "User-Agent: Mozilla/5.0 (compatible; FeedValidator/1.0)" \
    -H "Accept: application/rss+xml, application/atom+xml, application/xml, text/xml, */*" \
    "$url" 2>/dev/null)
  
  if [ "$RESPONSE" = "200" ]; then
    # Check if it's RSS/Atom
    if head -20 /tmp/feed-content.tmp | grep -qE '<(rss|feed|channel)' && head -20 /tmp/feed-content.tmp | grep -qE '<?xml|<rss|<feed'; then
      if grep -q '<rss' /tmp/feed-content.tmp; then
        echo "✅ RSS"
      elif grep -q 'xmlns="http://www.w3.org/2005/Atom"' /tmp/feed-content.tmp; then
        echo "✅ Atom"
      else
        echo "✅ XML Feed"
      fi
      VALID=$((VALID + 1))
    else
      echo "❌ Not RSS/Atom"
      STATUS="ACTIVE"
      [ "$is_active" = "0" ] && STATUS="inactive"
      echo "[$STATUS] $name" >> invalid-feeds-report.txt
      echo "  URL: $url" >> invalid-feeds-report.txt
      echo "  ID: $id" >> invalid-feeds-report.txt
      echo "  Error: Not RSS/Atom content" >> invalid-feeds-report.txt
      echo "" >> invalid-feeds-report.txt
      INVALID=$((INVALID + 1))
    fi
  else
    echo "❌ HTTP $RESPONSE"
    STATUS="ACTIVE"
    [ "$is_active" = "0" ] && STATUS="inactive"
    echo "[$STATUS] $name" >> invalid-feeds-report.txt
    echo "  URL: $url" >> invalid-feeds-report.txt
    echo "  ID: $id" >> invalid-feeds-report.txt
    echo "  Error: HTTP $RESPONSE" >> invalid-feeds-report.txt
    echo "" >> invalid-feeds-report.txt
    INVALID=$((INVALID + 1))
  fi
  
  rm -f /tmp/feed-content.tmp
  sleep 0.2
done < all-feeds.txt

echo ""
echo "================================"
echo "FINAL RESULTS:"
echo "✅ Valid feeds: $VALID/126 ($((VALID * 100 / 126))%)"
echo "❌ Invalid feeds: $INVALID/126 ($((INVALID * 100 / 126))%)"
echo ""
echo "Invalid feeds saved to: invalid-feeds-report.txt"