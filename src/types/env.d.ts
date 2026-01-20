import type { SessionDurableObject } from 'rwsdk/auth';
// Merge CloudflareEnv with the global Env
declare global {
  interface Env {
    // D1 Database
    DB: D1Database;

    // KV Namespaces
    APP_CONFIG_KV: KVNamespace;
    PROMPTS_KV?: KVNamespace;

    // R2 Buckets
    MARKDOWN_OUTPUT_R2: R2Bucket;

    // Queue Bindings
    FEED_FETCH_QUEUE: Queue;
    DAILY_SUMMARY_INITIATOR_QUEUE: Queue;
    DAILY_SUMMARY_PROCESSOR_QUEUE: Queue;
    WEEKLY_SUMMARY_INITIATOR_QUEUE: Queue;
    WEEKLY_SUMMARY_AGGREGATOR_QUEUE: Queue;
    WEEKLY_SUMMARY_GENERATOR_QUEUE: Queue;
    WEEKLY_SUMMARY_POSTPROCESSOR_QUEUE: Queue;
    WEEKLY_SUMMARY_FINALIZER_QUEUE: Queue;
    LEXPAGE_PUBLISH_QUEUE: Queue;
    SLACK_PUBLISH_QUEUE: Queue;
    R2_PUBLISH_QUEUE: Queue;
    LOOPS_PUBLISH_QUEUE: Queue;

    // Dead Letter Queues
    FEED_FETCH_DLQ?: Queue;
    SUMMARY_DLQ?: Queue;
    PUBLISH_DLQ?: Queue;

    // Secrets
    GEMINI_API_KEY: string;
    API_KEY?: string;
    ADMIN_API_KEY?: string;
    SLACK_TOKEN?: string;
    SLACK_WEBHOOK_URL?: string;
    LEX_PAGE_API_KEY?: string;
    LEX_PAGE_API_URL?: string;
    LOOPS_API_KEY?: string;
    LOOPS_LOOP_ID?: string;
    LOOPS_DEFAULT_EMAIL?: string;
    LOOPS_CUSTOM_DIGEST_TRANSACTION_ID?: string;
    RESEND_API_KEY?: string;

    // Environment Variables
    TZ?: string;
    LOG_LEVEL?: string;
    LEX_PAGE_ENABLED?: string;
    SLACK_ENABLED?: string;
    R2_ENABLED?: string;
    LOOPS_ENABLED?: string;
    EMAIL_FROM?: string;
    EMAIL_TO?: string;
    ENVIRONMENT?: 'development' | 'staging' | 'production';

    // RedwoodSDK default bindings
    WEBAUTHN_APP_NAME?: string;
    WEBAUTHN_RP_ID?: string;
    AUTH_SECRET_KEY?: string;
    SESSION_DURABLE_OBJECT?: DurableObjectNamespace<SessionDurableObject>;
    ASSETS?: Fetcher;
  }
}

export {};


