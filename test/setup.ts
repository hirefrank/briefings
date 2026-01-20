import { beforeEach, afterEach, vi } from 'vitest';

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mock global types
declare global {
  let createMockBatch: <T>(messages: T[]) => MessageBatch<T>;
}

// Global test utilities
global.createMockBatch = <T>(messages: T[]) => ({
  messages: messages.map((body) => ({
    id: crypto.randomUUID(),
    timestamp: new Date(),
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  })),
  queue: 'test-queue',
  ackAll: vi.fn(),
  retryAll: vi.fn(),
});

// Mock console to reduce noise
global.console = {
  ...console,
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: console.error, // Keep error for debugging
  trace: vi.fn(),
  assert: vi.fn(),
};
