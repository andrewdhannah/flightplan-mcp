/**
 * tests/tokensource/openwork_adapter.test.ts — Unit tests for OpenWorkAdapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenWorkAdapter, createOpenWorkAdapterFromEnv } from '../../src/tokensource/openwork_adapter.js';
import type { TokenScope, TokenUsage, HealthStatus } from '../../src/tokensource/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OpenWorkAdapter', () => {
  let adapter: ReturnType<typeof createTestAdapter>;
  const mockConfig = {
    baseUrl: 'https://api.openwork.example.com',
    apiKey: 'test-api-key',
    organizationId: 'org-123',
    timeoutMs: 5000,
    maxRetries: 2,
    retryBaseDelayMs: 100,
  };

  function createTestAdapter() {
    return new OpenWorkAdapter({
      baseUrl: 'https://api.openwork.example.com',
      apiKey: 'test-api-key',
      organizationId: 'org-123',
      timeoutMs: 5000,
      maxRetries: 2,
      retryBaseDelayMs: 100,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create adapter with correct properties', () => {
      const adapter = createTestAdapter();
      expect(adapter.source_id).toBe('openwork');
      expect(adapter.name).toBe('OpenWork');
      expect(adapter.version).toBe('1.0.0');
    });

    it('should create adapter from environment variables', () => {
      process.env.OPENWORK_API_URL = 'https://api.openwork.example.com';
      process.env.OPENWORK_API_KEY = 'test-key';
      process.env.OPENWORK_ORG_ID = 'org-123';

      const adapter = createOpenWorkAdapterFromEnv();
      expect(adapter.config.baseUrl).toBe('https://api.openwork.example.com');
      expect(adapter.config.apiKey).toBe('test-key');
      expect(adapter.config.organizationId).toBe('org-123');

      delete process.env.OPENWORK_API_URL;
      delete process.env.OPENWORK_API_KEY;
      delete process.env.OPENWORK_ORG_ID;
    });

    it('should throw if required env vars missing', () => {
      delete process.env.OPENWORK_API_URL;
      delete process.env.OPENWORK_API_KEY;
      expect(() => createOpenWorkAdapterFromEnv()).toThrow('OPENWORK_API_URL and OPENWORK_API_KEY environment variables are required');
    });
  });

  describe('fetchUsage', () => {
    it('should fetch usage for session scope', async () => {
      const adapter = createTestAdapter();
      const mockResponse: TokenUsage = {
        tokens_consumed: 1500,
        tokens_remaining: 8500,
        tokens_limit: 10000,
        timestamp: new Date().toISOString(),
        breakdown: {
          by_model: { 'claude-3': 1000, 'gpt-4': 500 },
          by_provider: { anthropic: 1000, openai: 500 },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tokens_consumed: 1500,
          tokens_remaining: 8500,
          tokens_limit: 10000,
          breakdown: {
            by_model: { 'claude-3': 1000, 'gpt-4': 500 },
            by_provider: { anthropic: 1000, openai: 500 },
          },
        }),
      });

      const scope = { scope_type: 'session' as const, scope_id: 'session-123' };
      const result = await createTestAdapter().fetchUsage({ scope_type: 'session', scope_id: 'session-123' });

      expect(result.tokens_consumed).toBe(1500);
      expect(result.tokens_remaining).toBe(8500);
      expect(result.breakdown?.by_model).toEqual({ 'claude-3': 1000, 'gpt-4': 500 });
    });

    it('should fetch usage for project scope', async () => {
      const adapter = createTestAdapter();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tokens_consumed: 5000,
          tokens_remaining: 5000,
          tokens_limit: 10000,
        }),
      });

      const result = await createTestAdapter().fetchUsage({ scope_type: 'project', scope_id: 'project-456' });
      expect(result.tokens_consumed).toBe(5000);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(createTestAdapter().fetchUsage({ scope_type: 'session', scope_id: 'sess-1' }))
        .rejects.toThrow('OpenWork API error: 401 Unauthorized');
    });

    it('should retry on transient failure', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tokens_consumed: 100, tokens_remaining: 9900, tokens_limit: 10000 }),
        });

      const result = await createTestAdapter().fetchUsage({ scope_type: 'session', scope_id: 'sess-1' });
      expect(result.tokens_consumed).toBe(100);
    });

    it('should not retry on non-retryable errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(createTestAdapter().fetchUsage({ scope_type: 'session', scope_id: 'sess-1' }))
        .rejects.toThrow('OpenWork API error: 400 Bad Request');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy', latency_ms: 50 }),
      });

      const result = await createTestAdapter().healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const result = await createTestAdapter().healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('503');
    });

    it('should return unhealthy on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await createTestAdapter().healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('fetchWithRetry', () => {
    it('should retry on network error with exponential backoff', async () => {
      const adapter = createTestAdapter();
      const startTime = Date.now();

      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tokens_consumed: 100, tokens_remaining: 9900, tokens_limit: 10000 }),
        });

      const result = await adapter.fetchUsage({ scope_type: 'session', scope_id: 'sess-1' });
      expect(result.tokens_consumed).toBe(100);

      const elapsed = Date.now() - startTime;
      // Should have waited ~100ms + 200ms = 300ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(250);
    });

    it('should not retry on 4xx errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(createTestAdapter().fetchUsage({ scope_type: 'session', scope_id: 'sess-1' }))
        .rejects.toThrow('OpenWork API error: 404 Not Found');
    });
  });

  describe('healthCheck', () => {
    it('should measure latency', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      const result = await createTestAdapter().healthCheck();
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('destroy', () => {
    it('should abort pending requests', () => {
      const adapter = createTestAdapter();
      adapter.destroy();
      // Should not throw
      expect(() => adapter.destroy()).not.toThrow();
    });
  });
});

describe('createOpenWorkAdapterFromEnv', () => {
  beforeEach(() => {
    delete process.env.OPENWORK_API_URL;
    delete process.env.OPENWORK_API_KEY;
    delete process.env.OPENWORK_ORG_ID;
  });

  afterEach(() => {
    delete process.env.OPENWORK_API_URL;
    delete process.env.OPENWORK_API_KEY;
    delete process.env.OPENWORK_ORG_ID;
  });

  it('should create adapter from environment variables', () => {
    process.env.OPENWORK_API_URL = 'https://api.openwork.example.com';
    process.env.OPENWORK_API_KEY = 'test-key';
    process.env.OPENWORK_ORG_ID = 'org-123';

    const adapter = createOpenWorkAdapterFromEnv();
    expect(adapter.config.baseUrl).toBe('https://api.openwork.example.com');
    expect(adapter.config.apiKey).toBe('test-key');
    expect(adapter.config.organizationId).toBe('org-123');
  });

  it('should throw if required env vars missing', () => {
    expect(() => createOpenWorkAdapterFromEnv()).toThrow('OPENWORK_API_URL and OPENWORK_API_KEY environment variables are required');
  });
});