#!/bin/bash
# Script to show daily article breakdown by feed for VPS and CF starting June 7
# Updated to use dump-latest.sql and save results to markdown

echo "📊 Daily Article Breakdown by Feed (Starting June 7)"
echo "==================================================="
echo ""

# Create temp database from latest VPS dump
echo "Loading VPS data from dump-latest.sql..."
rm -f temp_vps.db
sqlite3 temp_vps.db < dump-latest.sql 2>/dev/null

if [ $? -ne 0 ]; then
    echo "❌ Error loading dump-latest.sql into SQLite"
    exit 1
fi

# First, let's get the date range in the dump
echo "Checking date range in VPS dump..."
sqlite3 temp_vps.db << 'EOF'
SELECT 
    'VPS Date Range' as info,
    MIN(DATE(datetime(fetch_date, 'unixepoch'))) || ' to ' || MAX(DATE(datetime(fetch_date, 'unixepoch'))) as range
FROM articles;
EOF

# Create analysis directory if it doesn't exist
mkdir -p analysis

# Export VPS daily feed breakdown (using fetch_date)
echo "Extracting VPS daily feed data..."
sqlite3 temp_vps.db << 'EOF' > analysis/vps-daily-feed-breakdown-latest.csv
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
" > analysis/cf-daily-feed-breakdown-latest.json 2>/dev/null

# Process the data to create a comparison view and save to markdown
echo ""
echo "Creating comparison report..."

# Create a Python script to process and display the data
cat > process_comparison_markdown.py << 'PYTHON_EOF'
import json
import csv
from collections import defaultdict
from datetime import datetime, timedelta

# Read VPS data
vps_data = defaultdict(lambda: defaultdict(int))
with open('analysis/vps-daily-feed-breakdown-latest.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        feed = row['feed_name']
        date = row['date']
        count = int(row['article_count'])
        vps_data[feed][date] = count

# Read CF data
cf_data = defaultdict(lambda: defaultdict(int))
try:
    with open('analysis/cf-daily-feed-breakdown-latest.json', 'r') as f:
        data = json.load(f)
        for row in data[0]['results']:
            feed = row['feed_name']
            date = row['date']
            count = row['article_count']
            cf_data[feed][date] = count
except Exception as e:
    print(f"Error reading CF data: {e}")

# Get all unique feeds and dates
all_feeds = sorted(set(vps_data.keys()) | set(cf_data.keys()))
all_dates = sorted(set(
    date for feed_data in vps_data.values() for date in feed_data
) | set(
    date for feed_data in cf_data.values() for date in feed_data
))

# Filter dates from June 7 onwards
all_dates = [d for d in all_dates if d >= '2025-06-07']

# Create markdown output
output = []
output.append("# VPS vs Cloudflare Daily Feed Breakdown Analysis")
output.append("")
output.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
output.append("")
output.append("## Daily Article Counts by Feed (Starting June 7, 2025)")
output.append("")

# Create table header
header = "| Feed | Source |"
for date in all_dates:
    header += f" {date[5:]} |"
header += " Total |"
output.append(header)

# Table separator
separator = "|------|--------|"
for _ in all_dates:
    separator += "-------:|"
separator += "------:|"
output.append(separator)

# Track feeds with differences
feeds_with_differences = []

# Print data for each feed
for feed in all_feeds:
    # Calculate totals
    vps_total = sum(vps_data[feed].get(date, 0) for date in all_dates)
    cf_total = sum(cf_data[feed].get(date, 0) for date in all_dates)
    
    # Only include feeds with activity
    if vps_total > 0 or cf_total > 0:
        # VPS row
        vps_row = f"| {feed[:40]} | VPS |"
        for date in all_dates:
            count = vps_data[feed].get(date, 0)
            vps_row += f" {count} |"
        vps_row += f" {vps_total} |"
        output.append(vps_row)
        
        # CF row
        cf_row = f"| | CF |"
        for date in all_dates:
            count = cf_data[feed].get(date, 0)
            cf_row += f" {count} |"
        cf_row += f" {cf_total} |"
        output.append(cf_row)
        
        # Track if there are differences
        if vps_total != cf_total:
            feeds_with_differences.append((feed, vps_total, cf_total, cf_total - vps_total))

# Daily totals section
output.append("")
output.append("## Daily Totals")
output.append("")
output.append("| Metric | Source |" + " ".join(f" {d[5:]} |" for d in all_dates) + " Total |")
output.append("|--------|--------|" + "-------:|" * (len(all_dates) + 1))

# VPS totals
vps_daily_totals = []
vps_grand_total = 0
row = "| All Feeds | VPS |"
for date in all_dates:
    total = sum(vps_data[feed].get(date, 0) for feed in all_feeds)
    vps_daily_totals.append(total)
    vps_grand_total += total
    row += f" {total} |"
row += f" {vps_grand_total} |"
output.append(row)

# CF totals
cf_daily_totals = []
cf_grand_total = 0
row = "| All Feeds | CF |"
for date in all_dates:
    total = sum(cf_data[feed].get(date, 0) for feed in all_feeds)
    cf_daily_totals.append(total)
    cf_grand_total += total
    row += f" {total} |"
row += f" {cf_grand_total} |"
output.append(row)

# Difference row
row = "| **Difference** | |"
for i, date in enumerate(all_dates):
    diff = cf_daily_totals[i] - vps_daily_totals[i]
    if diff > 0:
        row += f" **+{diff}** |"
    elif diff < 0:
        row += f" **{diff}** |"
    else:
        row += " 0 |"
diff_total = cf_grand_total - vps_grand_total
if diff_total > 0:
    row += f" **+{diff_total}** |"
elif diff_total < 0:
    row += f" **{diff_total}** |"
else:
    row += " 0 |"
output.append(row)

# Analysis section
output.append("")
output.append("## Analysis")
output.append("")
output.append("### Key Findings")
output.append("")

# Date-specific analysis
output.append("#### Daily Patterns:")
output.append("")
for i, date in enumerate(all_dates):
    vps_count = vps_daily_totals[i]
    cf_count = cf_daily_totals[i]
    diff = cf_count - vps_count
    
    analysis = f"- **{date}**: VPS: {vps_count}, CF: {cf_count}"
    if diff > 0:
        analysis += f" (CF +{diff})"
    elif diff < 0:
        analysis += f" (CF {diff})"
    
    # Add specific notes for notable patterns
    if date == '2025-06-07' and cf_count > 1000:
        analysis += " - *Bulk import day for CF*"
    elif vps_count == 0:
        analysis += " - *No VPS fetching*"
    elif cf_count == 0:
        analysis += " - *No CF fetching*"
    
    output.append(analysis)

# Feed-specific analysis
output.append("")
output.append("#### Feeds with Significant Differences:")
output.append("")

# Sort by absolute difference
feeds_with_differences.sort(key=lambda x: abs(x[3]), reverse=True)

for feed, vps_total, cf_total, diff in feeds_with_differences[:10]:  # Top 10
    if abs(diff) > 5:  # Only significant differences
        output.append(f"- **{feed}**: VPS: {vps_total}, CF: {cf_total} (Difference: {diff:+d})")

# Summary statistics
output.append("")
output.append("### Summary Statistics")
output.append("")
output.append(f"- **Total articles in VPS** (June 7+): {vps_grand_total}")
output.append(f"- **Total articles in CF** (June 7+): {cf_grand_total}")
output.append(f"- **Overall difference**: {cf_grand_total - vps_grand_total:+d}")
output.append(f"- **Number of active feeds**: {len([f for f in all_feeds if vps_data[f] or cf_data[f]])}")
output.append(f"- **Feeds with differences**: {len(feeds_with_differences)}")

# High-volume feeds
output.append("")
output.append("### Top 5 Most Active Feeds (Combined)")
output.append("")
feed_totals = [(feed, sum(vps_data[feed].values()) + sum(cf_data[feed].values())) for feed in all_feeds]
feed_totals.sort(key=lambda x: x[1], reverse=True)
for i, (feed, total) in enumerate(feed_totals[:5]):
    vps_tot = sum(vps_data[feed].values())
    cf_tot = sum(cf_data[feed].values())
    output.append(f"{i+1}. **{feed}**: {total} total (VPS: {vps_tot}, CF: {cf_tot})")

# Write to file
with open('analysis/daily-feed-breakdown-analysis.md', 'w') as f:
    f.write('\n'.join(output))

print("Analysis saved to: analysis/daily-feed-breakdown-analysis.md")
print("\nQuick Summary:")
print(f"- VPS Total: {vps_grand_total}")
print(f"- CF Total: {cf_grand_total}")
print(f"- Difference: {cf_grand_total - vps_grand_total:+d}")

PYTHON_EOF

# Run the Python script
python3 process_comparison_markdown.py

# Also create a simple CSV for easy viewing
echo ""
echo "Creating summary CSV..."
sqlite3 temp_vps.db << 'EOF' > analysis/vps-cf-daily-summary.csv
.mode csv
.headers on
WITH vps_daily AS (
    SELECT 
        DATE(datetime(fetch_date, 'unixepoch')) as date,
        COUNT(*) as vps_count
    FROM articles
    WHERE DATE(datetime(fetch_date, 'unixepoch')) >= '2025-06-07'
    GROUP BY DATE(datetime(fetch_date, 'unixepoch'))
)
SELECT 
    date,
    vps_count,
    '(Run CF query separately)' as cf_count,
    '(Calculate)' as difference
FROM vps_daily
ORDER BY date;
EOF

# Clean up
rm -f temp_vps.db
rm -f process_comparison_markdown.py

echo ""
echo "📄 Files created in analysis/ directory:"
echo "  - analysis/daily-feed-breakdown-analysis.md (Main analysis report)"
echo "  - analysis/vps-daily-feed-breakdown-latest.csv"
echo "  - analysis/cf-daily-feed-breakdown-latest.json"
echo "  - analysis/vps-cf-daily-summary.csv"
echo ""
echo "✅ Analysis complete! Check analysis/daily-feed-breakdown-analysis.md for the full report."