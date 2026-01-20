#!/bin/bash

# Verify Cloudflare Infrastructure for Briefings Application
# This script checks that all required resources exist in production

echo "🔍 Verifying Cloudflare Infrastructure for Briefings"
echo "===================================================="
echo ""

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track overall status
ALL_GOOD=true

# Function to check if a command succeeded
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1${NC}"
    else
        echo -e "${RED}✗ $1${NC}"
        ALL_GOOD=false
    fi
}

echo "1. Checking D1 Database"
echo "-----------------------"
wrangler d1 list 2>/dev/null | grep -q "briefings-db"
check_status "D1 Database 'briefings-db' exists"

# Get database ID from wrangler.jsonc
DB_ID=$(grep -A2 '"DB"' wrangler.jsonc | grep database_id | cut -d'"' -f4)
if [ ! -z "$DB_ID" ]; then
    echo "   Database ID: $DB_ID"
fi
echo ""

echo "2. Checking KV Namespaces"
echo "-------------------------"
# Check production KV
KV_ID="d2a54fe6670b4ec582739d8fcd18d59e"
wrangler kv namespace list 2>/dev/null | grep -q "$KV_ID"
check_status "Production KV namespace exists (ID: $KV_ID)"

# Check preview KV
PREVIEW_KV_ID="1482453d2eb54506b890ad1c9508cc47"
wrangler kv namespace list 2>/dev/null | grep -q "$PREVIEW_KV_ID"
check_status "Preview KV namespace exists (ID: $PREVIEW_KV_ID)"

# Check KV contents
echo ""
echo "   Checking KV contents..."
KV_KEYS=$(wrangler kv key list --namespace-id="$KV_ID" 2>/dev/null | grep -c "name")
if [ "$KV_KEYS" -gt 0 ]; then
    echo -e "   ${GREEN}✓ Found $KV_KEYS keys in production KV${NC}"
    
    # Check for specific required keys
    wrangler kv key list --namespace-id="$KV_ID" 2>/dev/null | grep -q "feeds.json"
    check_status "   feeds.json exists"
    
    # Count prompt files
    PROMPT_COUNT=$(wrangler kv key list --namespace-id="$KV_ID" 2>/dev/null | grep -c "prompts/")
    if [ "$PROMPT_COUNT" -gt 0 ]; then
        echo -e "   ${GREEN}✓ Found $PROMPT_COUNT prompt templates${NC}"
    fi
else
    echo -e "   ${RED}✗ No keys found in KV${NC}"
    ALL_GOOD=false
fi
echo ""

echo "3. Checking R2 Buckets"
echo "----------------------"
wrangler r2 bucket list 2>/dev/null | grep -q "briefings-markdown-output"
check_status "R2 bucket 'briefings-markdown-output' exists"
echo ""

echo "4. Checking Queues"
echo "------------------"
# List of required queues
QUEUES=(
    "briefings-feed-fetch"
    "briefings-daily-summary-initiator"
    "briefings-daily-summary-processor"
    "briefings-weekly-summary-initiator"
    "briefings-weekly-summary-aggregator"
    "briefings-weekly-summary-generator"
    "briefings-weekly-summary-postprocessor"
    "briefings-weekly-summary-finalizer"
    "briefings-slack-publish"
    "briefings-lexpage-publish"
    "briefings-r2-publish"
)

QUEUE_OUTPUT=$(wrangler queues list 2>/dev/null)
for queue in "${QUEUES[@]}"; do
    echo "$QUEUE_OUTPUT" | grep -q "$queue"
    check_status "Queue '$queue' exists"
done
echo ""

echo "5. Checking Secrets"
echo "-------------------"
echo "Checking for required secrets (values hidden for security)..."

# Get list of secrets
SECRETS=$(wrangler secret list 2>/dev/null)

# Check required secrets
echo "$SECRETS" | grep -q "GEMINI_API_KEY"
check_status "GEMINI_API_KEY is set"

# Check optional secrets
echo ""
echo "Optional secrets:"
echo "$SECRETS" | grep -q "SLACK_TOKEN" && echo -e "${GREEN}✓ SLACK_TOKEN is set${NC}" || echo -e "${YELLOW}⚠ SLACK_TOKEN not set${NC}"
echo "$SECRETS" | grep -q "SLACK_WEBHOOK_URL" && echo -e "${GREEN}✓ SLACK_WEBHOOK_URL is set${NC}" || echo -e "${YELLOW}⚠ SLACK_WEBHOOK_URL not set${NC}"
echo "$SECRETS" | grep -q "LEX_PAGE_API_KEY" && echo -e "${GREEN}✓ LEX_PAGE_API_KEY is set${NC}" || echo -e "${YELLOW}⚠ LEX_PAGE_API_KEY not set${NC}"
echo "$SECRETS" | grep -q "AUTH_SECRET_KEY" && echo -e "${GREEN}✓ AUTH_SECRET_KEY is set${NC}" || echo -e "${YELLOW}⚠ AUTH_SECRET_KEY not set${NC}"
echo ""

echo "6. Checking Worker Deployment"
echo "-----------------------------"
WORKER_NAME="briefings-redwood-app"
wrangler whoami >/dev/null 2>&1
if [ $? -eq 0 ]; then
    # Try to get worker info
    WORKER_INFO=$(wrangler deployments list 2>/dev/null | head -n 5)
    if [ ! -z "$WORKER_INFO" ]; then
        echo -e "${GREEN}✓ Worker deployed${NC}"
        echo "   Recent deployments:"
        echo "$WORKER_INFO" | tail -n +2 | head -3 | sed 's/^/   /'
    else
        echo -e "${YELLOW}⚠ Could not verify worker deployment${NC}"
    fi
else
    echo -e "${RED}✗ Not logged in to Cloudflare${NC}"
    ALL_GOOD=false
fi
echo ""

echo "7. Checking Environment Variables"
echo "---------------------------------"
echo "Checking wrangler.jsonc vars configuration..."

# Check if vars are set in wrangler.jsonc
grep -q '"vars"' wrangler.jsonc
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Environment variables configured in wrangler.jsonc${NC}"
    
    # Show configured vars
    echo "   Configured vars:"
    grep -A10 '"vars"' wrangler.jsonc | grep -E '^\s*"[A-Z_]+"' | sed 's/^/   /' | head -10
else
    echo -e "${YELLOW}⚠ No vars section found in wrangler.jsonc${NC}"
fi
echo ""

echo "===================================================="
if [ "$ALL_GOOD" = true ]; then
    echo -e "${GREEN}✅ All infrastructure components verified!${NC}"
    echo ""
    echo "Your Cloudflare infrastructure is ready for deployment."
else
    echo -e "${RED}❌ Some infrastructure components are missing or misconfigured.${NC}"
    echo ""
    echo "Please check the errors above and run the appropriate setup commands."
fi
echo ""

echo "📝 Quick Reference:"
echo "- D1 Database: wrangler d1 create briefings-db"
echo "- KV Namespace: wrangler kv:namespace create APP_CONFIG_KV"
echo "- R2 Bucket: wrangler r2 bucket create briefings-markdown-output"
echo "- Queues: ./scripts/create-queues.sh"
echo "- Secrets: wrangler secret put GEMINI_API_KEY"
echo "- Deploy: pnpm run release"