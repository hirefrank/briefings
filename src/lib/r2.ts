/**
 * R2 Storage Service for Briefings
 * Stores weekly digests for historical context (novelty checking)
 */

import type { R2Bucket } from '@cloudflare/workers-types';

// ============================================================================
// TYPES
// ============================================================================

export interface StoredDigest {
  weekStart: string; // ISO date string
  weekEnd: string; // ISO date string
  title: string;
  topics: string[]; // Topics/themes covered
  recapContent: string; // The recap content
  generatedAt: string; // ISO timestamp
}

export interface DigestContext {
  digestCount: number;
  recentTitles: string[];
  recentTopics: string[];
  contextString: string; // Pre-formatted context for prompts
}

// ============================================================================
// R2 STORAGE SERVICE
// ============================================================================

export class R2Storage {
  private readonly bucket: R2Bucket;
  private readonly prefix: string;

  constructor(bucket: R2Bucket, prefix = 'digests') {
    this.bucket = bucket;
    this.prefix = prefix;
  }

  /**
   * Generate key for a digest based on week start date
   * Format: digests/2026-W03.json
   */
  private getKey(weekStart: Date): string {
    const year = weekStart.getFullYear();
    const weekNum = this.getWeekNumber(weekStart);
    return `${this.prefix}/${year}-W${String(weekNum).padStart(2, '0')}.json`;
  }

  /**
   * Get ISO week number for a date
   */
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  /**
   * Store a weekly digest to R2
   */
  async storeDigest(digest: {
    weekStart: string; // ISO date or date string
    weekEnd: string;
    title: string;
    topics: string[];
    recapContent: string;
    generatedAt: string;
  }): Promise<string> {
    const weekStartDate = new Date(digest.weekStart);
    const key = this.getKey(weekStartDate);

    const stored: StoredDigest = {
      weekStart: weekStartDate.toISOString(),
      weekEnd: new Date(digest.weekEnd).toISOString(),
      title: digest.title,
      topics: digest.topics,
      recapContent: digest.recapContent,
      generatedAt: digest.generatedAt,
    };

    await this.bucket.put(key, JSON.stringify(stored, null, 2), {
      httpMetadata: {
        contentType: 'application/json',
      },
    });

    console.log(`[R2] Stored digest: ${key}`);
    return key;
  }

  /**
   * Get a specific digest by week start date
   */
  async getDigest(weekStart: Date): Promise<StoredDigest | null> {
    const key = this.getKey(weekStart);
    const object = await this.bucket.get(key);

    if (!object) {
      return null;
    }

    const text = await object.text();
    return JSON.parse(text) as StoredDigest;
  }

  /**
   * Get the N most recent digests for context
   * Used to ensure novelty in new digests
   */
  async getRecentDigests(count: number): Promise<StoredDigest[]> {
    const digests: StoredDigest[] = [];
    const now = new Date();

    // Look back up to count + 2 weeks to handle potential gaps
    for (let i = 1; i <= count + 2 && digests.length < count; i++) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - i * 7);

      // Normalize to Monday of that week
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
      weekStart.setDate(diff);
      weekStart.setHours(0, 0, 0, 0);

      const digest = await this.getDigest(weekStart);
      if (digest) {
        digests.push(digest);
      }
    }

    return digests;
  }

  /**
   * Build context for prompts from recent digests
   * Used in clustering and digest generation prompts
   */
  async buildDigestContext(maxDigests = 4): Promise<DigestContext> {
    const recentDigests = await this.getRecentDigests(maxDigests);

    if (recentDigests.length === 0) {
      return {
        digestCount: 0,
        recentTitles: [],
        recentTopics: [],
        contextString: 'No previous digests available.',
      };
    }

    const recentTitles = recentDigests.map((d) => d.title);
    const recentTopics = recentDigests.flatMap((d) => d.topics || []);

    const contextString = recentDigests
      .map((d) => {
        const weekDate = new Date(d.weekStart).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        return `Week of ${weekDate}: "${d.title}"\n  Topics: ${(d.topics || []).join(', ')}`;
      })
      .join('\n\n');

    return {
      digestCount: recentDigests.length,
      recentTitles,
      recentTopics,
      contextString,
    };
  }

  /**
   * List all digest keys (for debugging/admin)
   */
  async listDigestKeys(limit = 50): Promise<string[]> {
    const list = await this.bucket.list({
      prefix: this.prefix,
      limit,
    });

    return list.objects.map((obj) => obj.key);
  }

  /**
   * Delete a specific digest (for cleanup)
   */
  async deleteDigest(weekStart: Date): Promise<void> {
    const key = this.getKey(weekStart);
    await this.bucket.delete(key);
    console.log(`[R2] Deleted digest: ${key}`);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createR2Storage(bucket: R2Bucket): R2Storage {
  return new R2Storage(bucket);
}
