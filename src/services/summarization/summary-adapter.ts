// @ts-nocheck - Legacy code with type mismatches, needs refactoring
/**
 * Adapter for converting between structured and markdown summary formats
 */

import type {
  StructuredDailySummary,
  StructuredDailySummaryContent,
  StructuredInsights,
  StructuredArticleRef,
} from '../../types/structured-summary.js';
import { format } from 'date-fns';

export class SummaryAdapter {
  /**
   * Convert structured summary to markdown format for backward compatibility
   */
  static toMarkdown(structured: StructuredDailySummary): string {
    const { content, insights, metadata } = structured;

    let markdown = `# ${content.headline}\n\n`;

    // Add main summary content
    markdown += `${content.summary}\n\n`;

    // Add key points section
    if (content.keyPoints.length > 0) {
      markdown += `## Key Points\n`;
      content.keyPoints.forEach((point) => {
        markdown += `- ${point}\n`;
      });
      markdown += '\n';
    }

    // Add topics section if available
    if (insights.topics.length > 0) {
      markdown += `## Topics\n`;
      insights.topics
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 5) // Top 5 topics
        .forEach((topic) => {
          markdown += `- **${topic.name}**: ${topic.keywords.join(', ')}\n`;
        });
      markdown += '\n';
    }

    // Add quotes section if available
    if (insights.quotes.length > 0) {
      markdown += `## Notable Quotes\n`;
      insights.quotes
        .sort((a, b) => b.relevance - a.relevance)
        .forEach((quote) => {
          markdown += `> "${quote.text}" - ${quote.source}\n\n`;
        });
    }

    // Add metadata footer
    const sentimentEmoji = this.getSentimentEmoji(insights.sentiment.overall);
    markdown += `---\n`;
    markdown += `*${metadata.articleCount} articles • Sentiment: ${insights.sentiment.overall} ${sentimentEmoji} (${insights.sentiment.score.toFixed(2)}) • Generated: ${format(new Date(metadata.generatedAt), 'PPpp')}*`;

    return markdown;
  }

  /**
   * Parse legacy markdown to structured format (best effort)
   * Used for gradual migration of existing data
   */
  static fromMarkdown(
    markdown: string,
    metadata: {
      date?: Date | string;
      feedId?: string;
      feedName?: string;
      articleCount?: number;
    }
  ): StructuredDailySummary {
    const parsedContent = this.parseMarkdownContent(markdown);
    const extractedInsights = this.extractInsightsFromMarkdown(markdown);

    return {
      version: '1.0',
      metadata: {
        date: metadata.date
          ? typeof metadata.date === 'string'
            ? metadata.date
            : format(metadata.date, 'yyyy-MM-dd')
          : format(new Date(), 'yyyy-MM-dd'),
        feedId: metadata.feedId || 'unknown',
        feedName: metadata.feedName || 'Unknown Feed',
        articleCount: metadata.articleCount || 0,
        generatedAt: new Date().toISOString(),
        processingTime: 0,
      },
      content: parsedContent,
      insights: extractedInsights,
      articles: this.extractArticleRefsFromMarkdown(markdown),
      formatting: {
        markdown,
      },
    };
  }

  /**
   * Parse markdown content to extract structured elements
   */
  private static parseMarkdownContent(markdown: string): StructuredDailySummaryContent {
    const lines = markdown.split('\n');
    let headline = 'Daily Summary';
    let summary = '';
    const keyPoints: string[] = [];
    let currentSection = 'header';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('# ')) {
        headline = trimmed.substring(2).trim();
        currentSection = 'summary';
      } else if (trimmed.startsWith('## Key Points') || trimmed.startsWith('## Topics')) {
        currentSection = 'keypoints';
      } else if (trimmed.startsWith('## ')) {
        currentSection = 'other';
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (currentSection === 'keypoints') {
          keyPoints.push(trimmed.substring(2).trim());
        }
      } else if (currentSection === 'summary' && trimmed.length > 0 && !trimmed.startsWith('*')) {
        summary += (summary ? ' ' : '') + trimmed;
      }
    }

    // Clean up summary
    summary = summary.replace(/\s+/g, ' ').trim();

    return {
      headline: headline || 'Daily Summary',
      summary: summary || 'No summary available',
      keyPoints: keyPoints.length > 0 ? keyPoints : ['No key points available'],
    };
  }

  /**
   * Extract basic insights from markdown (best effort)
   */
  private static extractInsightsFromMarkdown(markdown: string): StructuredInsights {
    return {
      sentiment: {
        overall: 'neutral',
        score: 0,
      },
      topics: [],
      entities: [],
      quotes: this.extractQuotesFromMarkdown(markdown),
    };
  }

  /**
   * Extract quotes from markdown
   */
  private static extractQuotesFromMarkdown(markdown: string) {
    const quotes = [];
    const quoteRegex = /> "(.*?)" - (.*?)$/gm;
    let match;

    while ((match = quoteRegex.exec(markdown)) !== null) {
      quotes.push({
        text: match[1],
        source: match[2],
        relevance: 0.5,
      });
    }

    return quotes;
  }

  /**
   * Extract article references from markdown
   */
  private static extractArticleRefsFromMarkdown(markdown: string): StructuredArticleRef[] {
    const articles: StructuredArticleRef[] = [];
    const linkRegex = /\* \[([^\]]+)\]\(([^)]+)\): (.+)$/gm;
    const bulletRegex = /\* ([^:]+): (.+)$/gm;
    let match;

    // Extract linked articles
    while ((match = linkRegex.exec(markdown)) !== null) {
      articles.push({
        id: `article-${articles.length + 1}`,
        title: match[1],
        url: match[2],
        contribution:
          articles.length === 0 ? 'primary' : articles.length < 3 ? 'supporting' : 'minor',
      });
    }

    // Extract non-linked articles
    const markdownWithoutLinks = markdown.replace(linkRegex, '');
    while ((match = bulletRegex.exec(markdownWithoutLinks)) !== null) {
      articles.push({
        id: `article-${articles.length + 1}`,
        title: match[1],
        url: '#',
        contribution:
          articles.length === 0 ? 'primary' : articles.length < 3 ? 'supporting' : 'minor',
      });
    }

    return articles;
  }

  /**
   * Get emoji for sentiment
   */
  private static getSentimentEmoji(sentiment: 'positive' | 'neutral' | 'negative'): string {
    switch (sentiment) {
      case 'positive':
        return '📈';
      case 'negative':
        return '📉';
      default:
        return '📊';
    }
  }

  /**
   * Validate structured summary has required fields
   */
  static validateStructuredSummary(structured: unknown): structured is StructuredDailySummary {
    if (!structured) return false;

    try {
      return (
        structured.version === '1.0' &&
        structured.metadata &&
        structured.content &&
        structured.insights &&
        structured.formatting &&
        typeof structured.content?.headline === 'string' &&
        typeof structured.content?.summary === 'string' &&
        Array.isArray(structured.content?.keyPoints) &&
        structured.insights?.sentiment &&
        Array.isArray(structured.insights?.topics) &&
        Array.isArray(structured.insights?.entities) &&
        Array.isArray(structured.insights?.quotes)
      );
    } catch {
      return false;
    }
  }

  /**
   * Extract minimal structured data from markdown for search/filtering
   */
  static extractSearchableData(markdown: string): {
    topics: string[];
    sentiment: number;
    entities: string[];
  } {
    const topics: string[] = [];
    const entities: string[] = [];
    let sentiment = 0;

    // Simple keyword extraction for topics
    const topicKeywords = ['AI', 'crypto', 'blockchain', 'tech', 'startup', 'market', 'economy'];
    topicKeywords.forEach((keyword) => {
      if (markdown.toLowerCase().includes(keyword.toLowerCase())) {
        topics.push(keyword);
      }
    });

    // Simple sentiment analysis based on keywords
    const positiveWords = [
      'growth',
      'success',
      'breakthrough',
      'innovation',
      'positive',
      'rise',
      'gain',
    ];
    const negativeWords = ['decline', 'fall', 'crisis', 'problem', 'issue', 'concern', 'drop'];

    let positiveCount = 0;
    let negativeCount = 0;

    positiveWords.forEach((word) => {
      if (markdown.toLowerCase().includes(word)) positiveCount++;
    });

    negativeWords.forEach((word) => {
      if (markdown.toLowerCase().includes(word)) negativeCount++;
    });

    sentiment = (positiveCount - negativeCount) / Math.max(positiveCount + negativeCount, 1);

    return { topics, sentiment, entities };
  }
}
