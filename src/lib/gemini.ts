/**
 * Gemini API Client for Briefings RSS Summarization System
 * Standalone client - no external dependencies
 */

import {
  ApiError,
  RateLimitError,
  TimeoutError,
  ErrorCode,
} from './errors.js';
import { DEFAULT_GENERATION_CONFIG, GEMINI_MODELS } from './constants.js';

// ============================================================================
// TYPES
// ============================================================================

export interface GeminiGenerationConfig {
  model?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface GeminiResponse {
  text: string;
  finishReason?: string;
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
      role?: string;
    };
    finishReason?: string;
    index?: number;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  promptFeedback?: {
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
    blockReason?: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<Record<string, unknown>>;
  };
}

// ============================================================================
// GEMINI CLIENT
// ============================================================================

export class GeminiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultConfig: Partial<GeminiGenerationConfig>;
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly timeout: number;

  constructor(options: {
    apiKey: string;
    defaultConfig?: Partial<GeminiGenerationConfig>;
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    timeout?: number;
  }) {
    this.apiKey = options.apiKey;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

    this.defaultConfig = {
      ...DEFAULT_GENERATION_CONFIG,
      ...options.defaultConfig,
    };

    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelay = options.baseDelay ?? 1000;
    this.maxDelay = options.maxDelay ?? 32000;
    this.timeout = options.timeout ?? 60000;
  }

  /**
   * Generate content using Gemini API
   */
  async generateContent(
    prompt: string,
    config?: Partial<GeminiGenerationConfig>
  ): Promise<GeminiResponse> {
    const model = config?.model || this.defaultConfig.model || GEMINI_MODELS.FLASH;
    const fullConfig = { ...this.defaultConfig, ...config, model };

    console.log(`[Gemini] Generating content with ${model}, prompt length: ${prompt.length}`);

    try {
      const response = await this.makeRequest(model, {
        contents: [
          {
            parts: [{ text: prompt }],
            role: 'user',
          },
        ],
        generationConfig: {
          temperature: fullConfig.temperature,
          topP: fullConfig.topP,
          topK: fullConfig.topK,
          maxOutputTokens: fullConfig.maxOutputTokens,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      });

      const result = this.extractResponse(response);

      console.log(`[Gemini] Generated ${result.text.length} chars, finish: ${result.finishReason}`);

      return result;
    } catch (error) {
      console.error(`[Gemini] Failed to generate content:`, error);
      throw error;
    }
  }

  /**
   * Generate JSON-structured content
   */
  async generateJSON<T = unknown>(
    prompt: string,
    config?: Partial<GeminiGenerationConfig>
  ): Promise<T> {
    const jsonPrompt = `${prompt}\n\nIMPORTANT: Return your response as valid JSON only. Do not include any markdown formatting, code blocks, or explanations. Only output the raw JSON object.`;

    const response = await this.generateContent(jsonPrompt, config);

    try {
      let jsonText = response.text.trim();
      jsonText = jsonText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      jsonText = jsonText.replace(/^```\s*/i, '').replace(/```\s*$/i, '');

      return JSON.parse(jsonText) as T;
    } catch (error) {
      console.error(`[Gemini] Failed to parse JSON:`, response.text.substring(0, 200));

      throw new ApiError('Failed to parse JSON response from Gemini', ErrorCode.API_ERROR, 500, {
        service: 'gemini',
        operation: 'generateJSON',
        metadata: {
          responsePreview: response.text.substring(0, 200),
          parseError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Generate content with automatic retry on failure
   */
  async generateWithRetry(
    prompt: string,
    options: {
      config?: Partial<GeminiGenerationConfig>;
      maxRetries?: number;
      onRetry?: (attempt: number, error: Error) => void;
    } = {}
  ): Promise<GeminiResponse> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.generateContent(prompt, options.config);
      } catch (error) {
        lastError = error as Error;

        if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = this.calculateBackoff(attempt);
          console.warn(`[Gemini] Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${lastError.message}`);

          if (options.onRetry) {
            options.onRetry(attempt + 1, lastError);
          }

          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Failed to generate content after retries');
  }

  /**
   * Make API request to Gemini
   */
  private async makeRequest(
    model: string,
    body: Record<string, unknown>
  ): Promise<GeminiApiResponse> {
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type');
      let data: GeminiApiResponse;

      if (contentType && contentType.includes('application/json')) {
        data = (await response.json()) as GeminiApiResponse;
      } else {
        const text = await response.text();

        if (response.status === 524 || text.includes('error code: 524')) {
          throw new TimeoutError(
            'Cloudflare timeout (524): Origin server did not respond in time',
            { service: 'gemini', operation: 'generateContent' }
          );
        }

        throw new ApiError(
          `Unexpected response format from API: ${text.substring(0, 100)}`,
          ErrorCode.API_ERROR,
          response.status,
          { service: 'gemini', operation: 'generateContent' }
        );
      }

      if (data.error) {
        throw this.createApiError(data.error, response.status);
      }

      if (!response.ok) {
        throw new ApiError(
          `Gemini API request failed: ${response.statusText}`,
          ErrorCode.API_ERROR,
          response.status,
          { service: 'gemini', operation: 'generateContent' }
        );
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError('Gemini API request timed out', {
          service: 'gemini',
          operation: 'generateContent',
          metadata: { timeout: this.timeout },
        });
      }

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        `Gemini API request failed: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.API_ERROR,
        500,
        { service: 'gemini', operation: 'generateContent' }
      );
    }
  }

  /**
   * Create appropriate error from API response
   */
  private createApiError(error: Record<string, unknown>, statusCode: number): ApiError {
    const message = (error.message as string) || 'Gemini API error';

    if (statusCode === 429 || (error.code as number) === 429) {
      const retryAfter = this.extractRetryAfter(error);
      return new RateLimitError(`Gemini API rate limit exceeded: ${message}`, retryAfter, {
        service: 'gemini',
        operation: 'generateContent',
      });
    }

    let errorCode = ErrorCode.API_ERROR;
    if (statusCode === 401 || (error.status as string) === 'UNAUTHENTICATED') {
      errorCode = ErrorCode.API_AUTHENTICATION;
    } else if (statusCode === 404) {
      errorCode = ErrorCode.API_NOT_FOUND;
    }

    return new ApiError(message, errorCode, statusCode, {
      service: 'gemini',
      operation: 'generateContent',
    });
  }

  /**
   * Extract retry-after value from error
   */
  private extractRetryAfter(error: Record<string, unknown>): number | undefined {
    const details = error.details as Array<Record<string, unknown>> | undefined;
    if (details) {
      for (const detail of details) {
        const metadata = detail.metadata as Record<string, unknown> | undefined;
        if (metadata?.['retry-after']) {
          const retryAfter = metadata['retry-after'];
          if (typeof retryAfter === 'string' || typeof retryAfter === 'number') {
            return parseInt(String(retryAfter), 10);
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Extract response from API data
   */
  private extractResponse(data: GeminiApiResponse): GeminiResponse {
    if (!data.candidates || data.candidates.length === 0) {
      throw new ApiError('No candidates in Gemini response', ErrorCode.API_ERROR, 500, {
        service: 'gemini',
        operation: 'extractResponse',
      });
    }

    const candidate = data.candidates[0];
    if (!candidate) {
      throw new ApiError('Invalid candidate in Gemini response', ErrorCode.API_ERROR, 500, {
        service: 'gemini',
        operation: 'extractResponse',
      });
    }

    const text = candidate.content?.parts?.[0]?.text || '';

    if (!text && candidate.finishReason === 'MAX_TOKENS') {
      const partialText = candidate.content?.parts?.map((part) => part.text || '').join('') || '';
      if (partialText) {
        return {
          text: `${partialText}\n\n[Response truncated due to length]`,
          finishReason: candidate.finishReason,
        };
      }

      throw new ApiError(
        'Response truncated: Maximum token limit reached. Try reducing input size.',
        ErrorCode.API_ERROR,
        500,
        { service: 'gemini', operation: 'extractResponse' }
      );
    }

    if (!text) {
      if (data.promptFeedback?.blockReason) {
        throw new ApiError(
          `Content blocked by Gemini: ${data.promptFeedback.blockReason}`,
          ErrorCode.API_ERROR,
          400,
          { service: 'gemini', operation: 'extractResponse' }
        );
      }

      throw new ApiError('No text content in Gemini response', ErrorCode.API_ERROR, 500, {
        service: 'gemini',
        operation: 'extractResponse',
      });
    }

    const response: GeminiResponse = { text };

    if (candidate.finishReason) {
      response.finishReason = candidate.finishReason;
    }

    if (candidate.safetyRatings) {
      response.safetyRatings = candidate.safetyRatings;
    }

    return response;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(attempt: number): number {
    const delay = Math.min(
      this.baseDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5),
      this.maxDelay
    );
    return Math.round(delay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a GeminiClient instance
   */
  static create(options: {
    apiKey: string;
    defaultConfig?: Partial<GeminiGenerationConfig>;
  }): GeminiClient {
    return new GeminiClient(options);
  }
}
