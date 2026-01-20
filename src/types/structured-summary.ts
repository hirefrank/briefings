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

// Schema for Gemini API JSON generation
export const DAILY_SUMMARY_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      maxLength: 120,
      description: "One compelling line that captures the day's main theme",
    },
    summary: {
      type: 'string',
      description: '2-3 paragraphs covering all major stories',
    },
    keyPoints: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 7,
      description: 'Most important takeaways as bullet points',
    },
    sentiment: {
      type: 'object',
      properties: {
        overall: {
          enum: ['positive', 'neutral', 'negative'],
          description: 'Overall sentiment of the news',
        },
        score: {
          type: 'number',
          minimum: -1,
          maximum: 1,
          description: 'Numerical sentiment score from -1 (very negative) to 1 (very positive)',
        },
        breakdown: {
          type: 'object',
          properties: {
            positive: { type: 'number', minimum: 0, maximum: 1 },
            neutral: { type: 'number', minimum: 0, maximum: 1 },
            negative: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['positive', 'neutral', 'negative'],
        },
      },
      required: ['overall', 'score'],
    },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Topic name' },
          relevance: { type: 'number', minimum: 0, maximum: 1 },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 5,
            description: 'Related keywords for this topic',
          },
        },
        required: ['name', 'relevance', 'keywords'],
      },
      maxItems: 8,
      description: 'Main themes and topics covered',
    },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: {
            enum: ['person', 'organization', 'location', 'technology', 'product'],
          },
          mentions: { type: 'number', minimum: 1 },
          context: { type: 'string', description: 'Context where first mentioned' },
        },
        required: ['name', 'type', 'mentions'],
      },
      maxItems: 12,
      description: 'Key people, companies, places, and technologies mentioned',
    },
    quotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 300 },
          source: { type: 'string' },
          relevance: { type: 'number', minimum: 0, maximum: 1 },
          context: { type: 'string', description: 'Context around the quote' },
        },
        required: ['text', 'source', 'relevance'],
      },
      maxItems: 3,
      description: 'Most impactful quotes from the articles',
    },
  },
  required: ['headline', 'summary', 'keyPoints', 'sentiment', 'topics', 'entities', 'quotes'],
} as const;

// Weekly summary types (simplified for now)
export interface StructuredWeeklySummary {
  version: '1.0';
  metadata: {
    weekNumber: number;
    year: number;
    startDate: string;
    endDate: string;
    feedId: string;
    feedName: string;
    dailySummaryCount: number;
    totalArticleCount: number;
  };
  content: {
    headline: string;
    executiveSummary: string;
    weeklyThemes: string[];
  };
  highlights: {
    topStories: Array<{
      title: string;
      summary: string;
      date: string;
      impact: 'high' | 'medium' | 'low';
    }>;
    trendingTopics: Array<{
      topic: string;
      momentum: 'rising' | 'stable' | 'declining';
      mentions: number;
    }>;
    keyDevelopments: Array<{
      category: string;
      developments: string[];
    }>;
  };
  formatting: {
    markdown: string;
    html?: string;
  };
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
