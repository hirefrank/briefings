#!/bin/bash

# Create all Cloudflare Queues for Briefings application

echo "Creating Cloudflare Queues for Briefings..."

# List of all queues needed
queues=(
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

# Create each queue
for queue in "${queues[@]}"; do
  echo "Creating queue: $queue"
  wrangler queues create "$queue"
  echo "---"
done

echo "All queues created successfully!"
echo ""
echo "Note: Your wrangler.jsonc is already configured with the correct bindings."
echo "The queues are now ready to use."