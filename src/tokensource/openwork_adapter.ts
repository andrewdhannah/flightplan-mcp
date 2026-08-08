/**
 * src/tokensource/openwork_adapter.ts — OpenWork TokenSource Adapter
 *
 * Implements the TokenSource interface for OpenWork.
 * Fetches token usage from OpenWork API.
 */

import type {
  TokenSource,
  TokenScope,
  TokenUsage,
  HealthStatus,
} from './types.js';

/**
 * Configuration for OpenWork adapter
 */
export interface OpenWorkAdapterConfig {
  /** OpenWork API base URL */
  baseUrl: string;
  /** API key or OAuth token */
  apiKey: string;
  /** Organization ID (optional, for org-scoped queries) */
  organizationId?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Number of retries for failed requests */
  maxRetries?: number;
  /** Base delay for exponential backoff (ms) */
  retryBaseDelayMs?: number;
}

/**
 * OpenWork API response types (subset)
 */
interface OpenWorkUsageResponse {
  tokens_consumed: number;
  tokens_remaining?: number;
  tokens_limit?: number;
  breakdown?: {
    by_model?: Record<string, number>;
    by_provider?: Record<string, number>;
  };
  metadata?: Record<string, unknown>;
}

interface OpenWorkHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency_ms?: number;
  details?: Record<string, unknown>;
}

/**
 * OpenWork TokenSource Adapter
 * Implements the TokenSource interface for OpenWork API.
 */
export class OpenWorkAdapter implements TokenSource {
  readonly source_id = 'openwork';
  readonly name = 'OpenWork';
  readonly version = '1.0.0';

  private config: Required<OpenWorkAdapterConfig>;
  private abortController: AbortController | null = null;

  constructor(config: OpenWorkAdapterConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      apiKey: config.apiKey,
      organizationId: config.organizationId ?? '',
      timeoutMs: config.timeoutMs ?? 10000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 500,
    };
  }

  /**
   * Fetch token usage from OpenWork API.
   */
  async fetchUsage(scope: TokenScope): Promise<TokenUsage> {
    const url = this.buildUrl(scope);
    const response = await this.fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(`OpenWork API error: ${response.status} ${response.statusText}`);
    }

    const data: OpenWorkUsageResponse = await response.json();

    return this.mapToTokenUsage(data, scope);
  }

  /**
   * Health check for OpenWork API.
   */
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return {
          healthy: false,
          latency_ms: latencyMs,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data: OpenWorkHealthResponse = await response.json();

      return {
        healthy: data.status === 'healthy',
        latency_ms: latencyMs,
        details: data.details,
      };
    } catch (error) {
      return {
        healthy: false,
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build the API URL for the given scope.
   */
  private buildUrl(scope: TokenScope): string {
    const base = `${this.config.baseUrl}/api/v1`;
    const params = new URLSearchParams();

    switch (scope.scope_type) {
      case 'session':
        params.set('session_id', scope.scope_id);
        break;
      case 'project':
        params.set('project_id', scope.scope_id);
        break;
      case 'organization':
        params.set('organization_id', this.config.organizationId || scope.scope_id);
        break;
      case 'global':
        // No additional params needed
        break;
    }

    if (scope.model) params.set('model', scope.model);
    if (scope.provider) params.set('provider', scope.provider);

    return `${base}/usage?${params.toString()}`;
  }

  /**
   * Fetch with exponential backoff retry logic.
   */
  private async fetchWithRetry(url: string, attempt = 0): Promise<Response> {
    this.abortController = new AbortController();
    const timeoutId = setTimeout(() => this.abortController?.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      // Don't retry on abort or non-retryable errors
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      if (attempt < this.config.maxRetries) {
        const delay = this.config.retryBaseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Build request headers with authentication.
   */
  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `FlightPlan-TokenSource/1.0.0`,
    };
  }

  /**
   * Map OpenWork API response to TokenUsage.
   */
  private mapToTokenUsage(data: OpenWorkUsageResponse, scope: TokenScope): TokenUsage {
    return {
      tokens_consumed: data.tokens_consumed ?? 0,
      tokens_remaining: data.tokens_remaining,
      tokens_limit: data.tokens_limit,
      timestamp: new Date().toISOString(),
      metadata: data.metadata,
      breakdown: data.breakdown,
    };
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.abortController?.abort();
  }
}

/**
 * Factory function to create an OpenWork adapter from environment variables.
 */
export function createOpenWorkAdapterFromEnv(): OpenWorkAdapter {
  const baseUrl = process.env.OPENWORK_API_URL;
  const apiKey = process.env.OPENWORK_API_KEY;
  const organizationId = process.env.OPENWORK_ORG_ID;

  if (!baseUrl || !apiKey) {
    throw new Error('OPENWORK_API_URL and OPENWORK_API_KEY environment variables are required');
  }

  return new OpenWorkAdapter({
    baseUrl,
    apiKey,
    organizationId: organizationId,
  });
}

/**
 * Default export for convenience.
 */
export default OpenWorkAdapter;