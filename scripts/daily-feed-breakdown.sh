#!/bin/bash
# Script to show daily article breakdown by feed for VPS and CF starting June 7

echo "📊 Daily Article Breakdown by Feed (Starting June 7)"
echo "==================================================="
echo ""

# Create temp database from VPS dump
echo "Loading VPS data..."
rm -f temp_vps.db
sqlite3 temp_vps.db < dump.sql 2>/dev/null

# First, let's get the list of all feeds from both systems
echo "Gathering feed data..."

# Export VPS daily feed breakdown (using fetch_date)
sqlite3 temp_vps.db << 'EOF' > vps-daily-feed-breakdown.csv
.mode csv
.headers on
SELECT 
    f.name as feed_name,
    DATE(datetime(a.fetch_date, 'unixepoch')) as date,
    COUNT(a.id) as article_count
FROM feeds f
JOIN articles a ON f.id = a.feed_id
WHERE DATE(datetime(a.fetch_date, 'unixepoch')) >= '2025-06-07'
GROUP BY f.name, DATE(datetime(a.fetch_date, 'unixepoch'))
ORDER BY f.name, date;
EOF

# Get CF daily feed breakdown
echo "Getting Cloudflare data..."
wrangler d1 execute DB --remote --json --command "
SELECT 
    f.name as feed_name,
    DATE(datetime(a.createdAt, 'unixepoch')) as date,
    COUNT(a.id) as article_count
FROM Feed f
JOIN Article a ON f.id = a.feedId
WHERE DATE(datetime(a.createdAt, 'unixepoch')) >= '2025-06-07'
GROUP BY f.name, DATE(datetime(a.createdAt, 'unixepoch'))
ORDER BY f.name, date
" > cf-daily-feed-breakdown.json 2>/dev/null

# Process the data to create a comparison view
echo ""
echo "Creating comparison report..."

# Create a Python script to process and display the data
cat > process_comparison.py << 'PYTHON_EOF'
import json
import csv
from collections import defaultdict
from datetime import datetime, timedelta

# Read VPS data
vps_data = defaultdict(lambda: defaultdict(int))
with open('vps-daily-feed-breakdown.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        feed = row['feed_name']
        date = row['date']
        count = int(row['article_count'])
        vps_data[feed][date] = count

# Read CF data
cf_data = defaultdict(lambda: defaultdict(int))
try:
    with open('cf-daily-feed-breakdown.json', 'r') as f:
        data = json.load(f)
        for row in data[0]['results']:
            feed = row['feed_name']
            date = row['date']
            count = row['article_count']
            cf_data[feed][date] = count
except:
    print("Error reading CF data")

# Get all unique feeds and dates
all_feeds = sorted(set(vps_data.keys()) | set(cf_data.keys()))
all_dates = sorted(set(
    date for feed_data in vps_data.values() for date in feed_data
) | set(
    date for feed_data in cf_data.values() for date in feed_data
))

# Filter dates from June 7 onwards
all_dates = [d for d in all_dates if d >= '2025-06-07']

# Print header
print(f"\n{'Feed':<50} {'Source':<6} " + " ".join(f"{d[5:]:>5}" for d in all_dates) + f" {'Total':>6}")
print("-" * (58 + len(all_dates) * 6 + 6))

# Print data for each feed
for feed in all_feeds:
    # VPS row
    vps_total = 0
    vps_row = f"{feed[:49]:<50} {'VPS':<6}"
    for date in all_dates:
        count = vps_data[feed].get(date, 0)
        vps_total += count
        vps_row += f" {count:>5}"
    vps_row += f" {vps_total:>6}"
    
    # CF row
    cf_total = 0
    cf_row = f"{'':<50} {'CF':<6}"
    for date in all_dates:
        count = cf_data[feed].get(date, 0)
        cf_total += count
        cf_row += f" {count:>5}"
    cf_row += f" {cf_total:>6}"
    
    # Diff row
    diff_row = f"{'':<50} {'Diff':<6}"
    for date in all_dates:
        vps_count = vps_data[feed].get(date, 0)
        cf_count = cf_data[feed].get(date, 0)
        diff = cf_count - vps_count
        if diff != 0:
            diff_row += f" {diff:>+5}"
        else:
            diff_row += f" {'':>5}"
    diff_total = cf_total - vps_total
    if diff_total != 0:
        diff_row += f" {diff_total:>+6}"
    else:
        diff_row += f" {'':>6}"
    
    # Only print feeds with activity
    if vps_total > 0 or cf_total > 0:
        print(vps_row)
        print(cf_row)
        if vps_total != cf_total:
            print(diff_row)
        print()

# Print daily totals
print("-" * (58 + len(all_dates) * 6 + 6))
print(f"{'DAILY TOTALS':<50} {'Source':<6} " + " ".join(f"{d[5:]:>5}" for d in all_dates) + f" {'Total':>6}")
print("-" * (58 + len(all_dates) * 6 + 6))

# VPS totals
vps_daily_totals = []
vps_grand_total = 0
row = f"{'All Feeds':<50} {'VPS':<6}"
for date in all_dates:
    total = sum(vps_data[feed].get(date, 0) for feed in all_feeds)
    vps_daily_totals.append(total)
    vps_grand_total += total
    row += f" {total:>5}"
row += f" {vps_grand_total:>6}"
print(row)

# CF totals
cf_daily_totals = []
cf_grand_total = 0
row = f"{'All Feeds':<50} {'CF':<6}"
for date in all_dates:
    total = sum(cf_data[feed].get(date, 0) for feed in all_feeds)
    cf_daily_totals.append(total)
    cf_grand_total += total
    row += f" {total:>5}"
row += f" {cf_grand_total:>6}"
print(row)

# Difference
row = f"{'All Feeds':<50} {'Diff':<6}"
for i, date in enumerate(all_dates):
    diff = cf_daily_totals[i] - vps_daily_totals[i]
    if diff != 0:
        row += f" {diff:>+5}"
    else:
        row += f" {'':>5}"
diff_total = cf_grand_total - vps_grand_total
if diff_total != 0:
    row += f" {diff_total:>+6}"
else:
    row += f" {'':>6}"
print(row)

PYTHON_EOF

# Run the Python script
python3 process_comparison.py

# Save a more detailed CSV for further analysis
echo ""
echo "Creating detailed CSV comparison..."

sqlite3 temp_vps.db << 'EOF' > vps-feed-daily-detailed.csv
.mode csv
.headers on
SELECT 
    f.name as feed_name,
    DATE(datetime(a.fetch_date, 'unixepoch')) as date,
    COUNT(a.id) as vps_articles,
    'VPS' as source
FROM feeds f
JOIN articles a ON f.id = a.feed_id
WHERE DATE(datetime(a.fetch_date, 'unixepoch')) >= '2025-06-07'
GROUP BY f.name, DATE(datetime(a.fetch_date, 'unixepoch'))
ORDER BY date DESC, f.name;
EOF

# Clean up
rm -f temp_vps.db
rm -f process_comparison.py

echo ""
echo "📄 Files created:"
echo "  - vps-daily-feed-breakdown.csv"
echo "  - cf-daily-feed-breakdown.json"
echo "  - vps-feed-daily-detailed.csv"
echo ""
echo "✅ Analysis complete!"