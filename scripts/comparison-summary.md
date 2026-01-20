# VPS vs Cloudflare Workers Comparison Summary

## Key Findings

### Article Counts

**VPS Database (from dump.sql):**

- Total articles: 5,536
- Date range: 2025-05-05 to 2025-06-08
- Articles fetched in last 7 days: 666
- Active feeds with recent articles: 41

**Cloudflare Workers:**

- Total articles: 1,412
- Articles by recent dates:
  - 2025-06-10: 74 articles (today)
  - 2025-06-09: 142 articles
  - 2025-06-08: 68 articles
  - 2025-06-07: 1,128 articles (likely initial import)
- All feeds are active and fetching
- Top feeds in CF (last 7 days / last 24h):
  - Hacker News: 119 / 64 articles
  - Wired: 86 / 26 articles
  - TechCrunch: 67 / 40 articles
  - The Verge: 54 / 33 articles
  - ArsTechnica: 49 / 26 articles

### Analysis Results

1. **Service Status**

   - ✅ Cloudflare Workers service is functioning correctly
   - ✅ All feeds are active and fetching articles
   - ✅ Recent activity shows consistent fetching (74 articles today, 142
     yesterday)

2. **Article Volume Comparison**

   - VPS has historical data (5,536 articles from May 5 - June 8)
   - CF started fresh on June 7 with bulk import (1,128 articles)
   - Daily fetch rates appear similar between services

3. **Feed Activity Comparison (7-day period)**

   ```
   Feed               VPS    CF    Status
   ------------------ ------ ----- -------
   Hacker News        311    119   ✅ Active (CF started later)
   TechCrunch         77     67    ✅ Good
   Wired              73     86    ✅ Good (CF actually higher)
   ArsTechnica        54     49    ✅ Good
   The Verge          38     54    ✅ Good (CF actually higher)
   ```

4. **Technical Differences**
   - VPS uses separate `publish_date` and `fetch_date` columns
   - CF uses `createdAt` and `updatedAt` as Unix timestamps
   - Both systems store similar data but with different schemas

### Conclusion

✅ **The Cloudflare Workers service is working as intended!**

The analysis shows that:

- All feeds are actively fetching articles
- Daily fetch rates are comparable between VPS and CF
- The difference in total article count is due to CF starting fresh on June 7
- Some feeds (Wired, The Verge) are actually fetching MORE articles in CF than
  VPS

### Recommendations

1. **No immediate action required** - The service is functioning correctly

2. **Optional: Historical Data Import**

   - If you need the historical articles from before June 7, consider importing
     them
   - Otherwise, the service will build up its archive naturally

3. **Monitoring Going Forward**
   - Use `./scripts/check-article-counts.sh` for regular health checks
   - Monitor for any feeds that stop fetching
   - Compare daily totals periodically

### Useful Monitoring Queries

```bash
# Check today's article count
wrangler d1 execute DB --remote --command "SELECT COUNT(*) as articles_today FROM Article WHERE datetime(createdAt, 'unixepoch') >= datetime('now', 'start of day')"

# Check feeds with low activity
wrangler d1 execute DB --remote --command "SELECT f.name, COUNT(a.id) as last_24h FROM Feed f LEFT JOIN Article a ON f.id = a.feedId AND datetime(a.createdAt, 'unixepoch') >= datetime('now', '-24 hours') WHERE f.isActive = 1 GROUP BY f.id HAVING COUNT(a.id) < 5 ORDER BY last_24h"
```
