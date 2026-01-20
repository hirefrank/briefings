#!/bin/bash

# Clear a Cloudflare Queue
# Usage: ./clear-queue.sh <queue-name>

if [ $# -eq 0 ]; then
    echo "Usage: $0 <queue-name>"
    echo "Example: $0 briefings-daily-summary-processor"
    exit 1
fi

QUEUE_NAME=$1

echo "Clearing queue: $QUEUE_NAME"

# Remove the consumer
wrangler queues consumer worker remove $QUEUE_NAME briefings

# Re-add the consumer
wrangler queues consumer worker add $QUEUE_NAME briefings

echo "Queue $QUEUE_NAME cleared and consumer re-added"