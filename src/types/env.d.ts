declare global {
  interface Env {
    // D1 Database
    DB: D1Database;

    // KV Namespaces
    BRIEFINGS_CONFIG_KV: KVNamespace;
    PROMPTS_KV?: KVNamespace;

    // R2 Buckets
    briefings_md_output: R2Bucket;

    // Queue Bindings
    FEED_FETCH_QUEUE: Queue;
    DAILY_SUMMARY_INITIATOR_QUEUE: Queue;
    DAILY_SUMMARY_PROCESSOR_QUEUE: Queue;
    WEEKLY_DIGEST_QUEUE: Queue;

    // Secrets
    GEMINI_API_KEY: string;
    API_KEY?: string;
    ADMIN_API_KEY?: string;
    RESEND_API_KEY?: string;

    // Environment Variables
    TZ?: string;
    LOG_LEVEL?: string;
    R2_ENABLED?: string;
    EMAIL_FROM?: string;
    EMAIL_TO?: string;
    EMAIL_SUBJECT_PREFIX?: string;
    ENVIRONMENT?: "development" | "staging" | "production";
  }
}

export {};
