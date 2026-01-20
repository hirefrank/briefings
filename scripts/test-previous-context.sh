#!/bin/bash

# Test the previous context feature
# This script calls the test endpoint to verify the feature works correctly

echo "Testing Previous Context Feature..."
echo "=================================="

# Get the API URL from environment or use default
API_URL="${API_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-test-api-key}"

# Call the test endpoint
echo "Calling test endpoint..."
response=$(curl -s -X GET \
  "${API_URL}/test/previous-context" \
  -H "Content-Type: application/json")

# Pretty print the response
echo "$response" | jq .

# Check if the test was successful
if echo "$response" | jq -e '.success == true' > /dev/null; then
  echo ""
  echo "✅ Previous context feature is working correctly!"
  
  # Extract key metrics
  echo ""
  echo "Test Results:"
  echo "-------------"
  echo "Backward compatibility: $(echo "$response" | jq -r '.analysis.backwardCompatibility.success')"
  echo "Context enabled: $(echo "$response" | jq -r '.analysis.withContext.hasContext')"
  echo "Previous summaries available: $(echo "$response" | jq -r '.analysis.withContext.previousSummariesAvailable')"
  echo "Context count: $(echo "$response" | jq -r '.analysis.withContext.contextCount')"
  
  # Show context influence
  if echo "$response" | jq -e '.analysis.comparison.contextInfluence.hasContextMarkers == true' > /dev/null; then
    echo ""
    echo "Context appears to be influencing the summary!"
    echo "Found keywords: $(echo "$response" | jq -r '.analysis.comparison.contextInfluence.contextKeywords | join(", ")')"
  fi
else
  echo ""
  echo "❌ Test failed!"
  echo "Error: $(echo "$response" | jq -r '.message // .error')"
  exit 1
fi