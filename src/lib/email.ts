/**
 * Resend Email Service
 * Handles sending weekly digest emails via Resend API
 */

import { Resend } from 'resend';
import { marked } from 'marked';
import { Logger } from './logger.js';
import { ApiError, ErrorCode } from './errors.js';

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface SendEmailOptions {
  to: EmailRecipient[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Resend email client wrapper
 */
export class ResendEmailService {
  private readonly resend: Resend;
  private readonly logger: ReturnType<typeof Logger.forService>;
  private readonly fromEmail: string;

  constructor(options: {
    apiKey: string;
    fromEmail: string;
    logger?: ReturnType<typeof Logger.forService>;
  }) {
    this.resend = new Resend(options.apiKey);
    this.fromEmail = options.fromEmail;
    this.logger = options.logger || Logger.forService('ResendEmailService');
  }

  /**
   * Send an email via Resend
   */
  async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
    try {
      this.logger.info('Sending email via Resend', {
        to: options.to.map(r => r.email),
        subject: options.subject,
        from: options.from || this.fromEmail,
      });

      const { data, error } = await this.resend.emails.send({
        from: options.from || this.fromEmail,
        to: options.to.map(r => r.email),
        subject: options.subject,
        html: options.html,
        replyTo: options.replyTo,
        tags: options.tags,
      });

      if (error) {
        this.logger.error('Resend API error', error as Error, {
          subject: options.subject,
          to: options.to.map(r => r.email),
        });

        throw new ApiError(
          `Failed to send email: ${error.message}`,
          ErrorCode.API_ERROR,
          500,
          {
            service: 'resend',
            operation: 'sendEmail',
            metadata: {
              error: error.message,
              subject: options.subject,
            },
          }
        );
      }

      this.logger.info('Email sent successfully', {
        messageId: data?.id,
        subject: options.subject,
        to: options.to.map(r => r.email),
      });

      return {
        success: true,
        messageId: data?.id,
      };
    } catch (error) {
      this.logger.error('Failed to send email', error as Error, {
        subject: options.subject,
        to: options.to.map(r => r.email),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send weekly digest email
   */
  async sendWeeklyDigest(options: {
    to: EmailRecipient[];
    title: string;
    content: string;
    weekStart: string;
    weekEnd: string;
  }): Promise<EmailResult> {
    const html = this.formatWeeklyDigest({
      title: options.title,
      content: options.content,
      weekStart: options.weekStart,
      weekEnd: options.weekEnd,
    });

    return this.sendEmail({
      to: options.to,
      subject: options.title,
      html,
      tags: [
        { name: 'type', value: 'weekly-digest' },
        { name: 'week_start', value: options.weekStart },
        { name: 'week_end', value: options.weekEnd },
      ],
    });
  }

  /**
   * Format weekly digest as HTML email
   */
  private formatWeeklyDigest(options: {
    title: string;
    content: string;
    weekStart: string;
    weekEnd: string;
  }): string {
    // Convert markdown to HTML (basic conversion)
    const htmlContent = this.markdownToHtml(options.content);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(options.title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #1a1a1a;
      font-size: 24px;
      margin-bottom: 10px;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
    }
    h2 {
      color: #2a2a2a;
      font-size: 20px;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    h3 {
      color: #3a3a3a;
      font-size: 18px;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    p {
      margin-bottom: 16px;
    }
    ul, ol {
      margin-bottom: 16px;
      padding-left: 24px;
    }
    li {
      margin-bottom: 8px;
    }
    a {
      color: #0066cc;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    code {
      background-color: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 14px;
    }
    pre {
      background-color: #f4f4f4;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      font-size: 14px;
      color: #666;
      text-align: center;
    }
    .meta {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${this.escapeHtml(options.title)}</h1>
    <div class="meta">
      Week of ${options.weekStart} to ${options.weekEnd}
    </div>
    <div class="content">
      ${htmlContent}
    </div>
    <div class="footer">
      <p>Thanks for reading! This is your weekly digest of tech and culture stories.</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Convert markdown to HTML using marked
   */
  private markdownToHtml(markdown: string): string {
    return marked.parse(markdown, {
      gfm: true,      // GitHub-flavored markdown (tables, strikethrough, etc.)
      breaks: true,   // Convert single newlines to <br>
    }) as string;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Create a ResendEmailService instance
   */
  static create(options: {
    apiKey: string;
    fromEmail: string;
    logger?: ReturnType<typeof Logger.forService>;
  }): ResendEmailService {
    return new ResendEmailService(options);
  }
}

/**
 * Create a Resend email service instance
 */
export function createEmailService(
  apiKey: string,
  fromEmail: string
): ResendEmailService {
  return ResendEmailService.create({ apiKey, fromEmail });
}
