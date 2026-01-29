/**
 * Structured summary schemas for briefings app
 */

export interface StructuredDailySummaryContent {
  headline: string;
  summary: string;
  keyPoints: string[];
}

export interface StructuredSentiment {
  overall: 'positive' | 'neutral' | 'negative';
  score: number; // -1 to 1
  breakdown?: {
    positive: number;
    neutral: number;
    negative: number;
  };
}

export interface StructuredTopic {
  name: string;
  relevance: number; // 0-1
  keywords: string[];
}

export interface StructuredEntity {
  name: string;
  type: 'person' | 'organization' | 'location' | 'technology' | 'product';
  mentions: number;
  context?: string;
}

export interface StructuredQuote {
  text: string;
  source: string;
  relevance: number; // 0-1
  context?: string;
}

export interface StructuredInsights {
  sentiment: StructuredSentiment;
  topics: StructuredTopic[];
  entities: StructuredEntity[];
  quotes: StructuredQuote[];
}

export interface StructuredArticleRef {
  id: string;
  title: string;
  url: string;
  contribution: 'primary' | 'supporting' | 'minor';
}

export interface StructuredFormatting {
  markdown: string;
  html?: string;
  plainText?: string;
}

export interface StructuredDailySummaryMetadata {
  date: string;
  feedId: string;
  feedName: string;
  articleCount: number;
  generatedAt: string;
  processingTime: number;
}

export interface StructuredDailySummary {
  version: '1.0';
  metadata: StructuredDailySummaryMetadata;
  content: StructuredDailySummaryContent;
  insights: StructuredInsights;
  articles: StructuredArticleRef[];
  formatting: StructuredFormatting;
}

// Helper type for generated content from AI
export interface GeneratedStructuredContent {
  headline: string;
  summary: string;
  keyPoints: string[];
  sentiment: {
    overall: 'positive' | 'neutral' | 'negative';
    score: number;
    breakdown?: {
      positive: number;
      neutral: number;
      negative: number;
    };
  };
  topics: StructuredTopic[];
  entities: StructuredEntity[];
  quotes: StructuredQuote[];
}

export default StructuredDailySummary;
