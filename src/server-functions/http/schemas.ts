import { z } from 'zod';

/**
 * Request schemas for HTTP endpoints
 */

// Feed Fetch Request Schema
export const FeedFetchRequestSchema = z
  .object({
    feedUrl: z.string().url().optional(),
    feedName: z.string().optional(),
    force: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      // If feedUrl is provided, feedName must also be provided
      if (data.feedUrl && !data.feedName) {
        return false;
      }
      return true;
    },
    {
      message: 'feedName is required when feedUrl is provided',
      path: ['feedName'],
    }
  );

// Daily Summary Request Schema
export const DailySummaryRequestSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
  feedName: z.string().optional(),
  force: z.boolean().optional().default(false),
});

// Weekly Summary Request Schema
export const WeeklySummaryRequestSchema = z
  .object({
    weekStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .optional(),
    weekEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .optional(),
    force: z.boolean().optional().default(false),
    feedGroupId: z.string().uuid().optional(),
  })
  .refine(
    (data) => {
      // If one date is provided, both must be provided
      if ((data.weekStartDate && !data.weekEndDate) || (!data.weekStartDate && data.weekEndDate)) {
        return false;
      }

      // If both dates are provided, start date must be before end date
      if (data.weekStartDate && data.weekEndDate) {
        return new Date(data.weekStartDate) < new Date(data.weekEndDate);
      }

      return true;
    },
    {
      message:
        'Both weekStartDate and weekEndDate must be provided, and start date must be before end date',
    }
  );

// Response schemas
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.record(z.any()).optional(),
  requestId: z.string().uuid().optional(),
  timestamp: z.string(),
});

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.any()).optional(),
  timestamp: z.string(),
});

// Type exports
export type FeedFetchRequest = z.infer<typeof FeedFetchRequestSchema>;
export type DailySummaryRequest = z.infer<typeof DailySummaryRequestSchema>;
export type WeeklySummaryRequest = z.infer<typeof WeeklySummaryRequestSchema>;
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Validation utilities
 */

/**
 * Parse and validate request body
 */
export async function parseRequestBody<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  try {
    const contentType = request.headers.get('content-type');

    let body: unknown;

    if (contentType?.includes('application/json')) {
      const text = await request.text();
      if (!text.trim()) {
        body = {};
      } else {
        body = JSON.parse(text);
      }
    } else if (contentType?.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    } else {
      // For GET requests or empty body, use URL search params
      const url = new URL(request.url);
      body = Object.fromEntries(url.searchParams.entries());

      // Convert boolean strings
      Object.keys(body).forEach((key) => {
        if (body[key] === 'true') body[key] = true;
        if (body[key] === 'false') body[key] = false;
      });
    }

    return schema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationErrors = error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
      }));

      throw new ValidationError('Request validation failed', validationErrors);
    }

    if (error instanceof SyntaxError) {
      throw new ValidationError('Invalid JSON in request body');
    }

    throw error;
  }
}

/**
 * Validate queue message
 */
export function validateQueueMessage<T>(message: unknown, schema: z.ZodSchema<T>): T {
  try {
    return schema.parse(message);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationErrors = error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
      }));

      throw new ValidationError('Queue message validation failed', validationErrors);
    }

    throw error;
  }
}

/**
 * Create success response
 */
export function createSuccessResponse(
  message: string,
  data?: Record<string, unknown>,
  requestId?: string
): Response {
  const response: ApiResponse = {
    success: true,
    message,
    data,
    requestId,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(response, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

/**
 * Create error response
 */
export function createErrorResponse(
  error: string,
  statusCode: number = 400,
  code?: string,
  details?: Record<string, unknown>
): Response {
  const response: ErrorResponse = {
    success: false,
    error,
    code,
    details,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(response, null, 2), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

/**
 * Create validation error response
 */
export function createValidationErrorResponse(validationError: ValidationError): Response {
  return createErrorResponse(validationError.message, 400, 'VALIDATION_ERROR', {
    errors: validationError.errors,
  });
}

/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  public readonly errors?: Array<{
    field: string;
    message: string;
    code: string;
  }>;

  constructor(message: string, errors?: Array<{ field: string; message: string; code: string }>) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Date validation utilities
 */
export function validateAndParseDate(dateString?: string, defaultToToday = true): string {
  if (!dateString) {
    if (defaultToToday) {
      return new Date().toISOString().split('T')[0];
    }
    throw new ValidationError('Date is required');
  }

  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (isNaN(date.getTime())) {
    throw new ValidationError('Invalid date format. Use YYYY-MM-DD.');
  }

  return date.toISOString().split('T')[0];
}

/**
 * Calculate week date range
 */
export function calculateWeekRange(
  startDate?: string,
  endDate?: string
): {
  weekStartDate: string;
  weekEndDate: string;
} {
  if (startDate && endDate) {
    return {
      weekStartDate: validateAndParseDate(startDate, false),
      weekEndDate: validateAndParseDate(endDate, false),
    };
  }

  // Default to current week up to today (Monday-Sunday definition)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Calculate days from Monday
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  // Get this Monday
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysFromMonday);

  // Calculate the end date: the earlier of (this Sunday OR today)
  const thisSunday = new Date(thisMonday);
  thisSunday.setDate(thisMonday.getDate() + 6);

  // Use the earlier of Sunday or today as the end date (no future dates)
  const calculatedEndDate = thisSunday <= today ? thisSunday : today;

  // If the end date is before Monday, use the previous week
  let monday = thisMonday;
  let finalEndDate = calculatedEndDate;

  if (calculatedEndDate < thisMonday) {
    // Use previous week (Monday to Sunday)
    monday = new Date(thisMonday);
    monday.setDate(thisMonday.getDate() - 7);
    finalEndDate = new Date(monday);
    finalEndDate.setDate(monday.getDate() + 6);
  }

  return {
    weekStartDate: monday.toISOString().split('T')[0],
    weekEndDate: finalEndDate.toISOString().split('T')[0],
  };
}
