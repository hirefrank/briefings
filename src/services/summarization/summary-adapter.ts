// @ts-nocheck - Legacy code with type mismatches, needs refactoring
/**
 * Adapter for converting between structured and markdown summary formats
 */

import type {
  StructuredDailySummary,
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
}
