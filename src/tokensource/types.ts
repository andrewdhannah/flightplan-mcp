/**
 * src/tokensource/types.ts — TokenSource Interface Definitions
 *
 * Defines the TokenSource interface and related types for FlightPlan
 * to consume token data from external sources (OpenWork, etc.).
 */

// ─── TokenScope ──────────────────────────────────────────────────────────────

/**
 * Health status for a token source.
 */
export interface HealthStatus {
  /** Whether the source is healthy */
  healthy: boolean;
  /** Latency in milliseconds (optional) */
  latency_ms?: number;
  /** Error message if unhealthy (optional) */
  error?: string;
  /** Additional details (optional) */
  details?: Record<string, unknown>;
}

/**
 * Defines the scope of token usage to fetch.
 */
export interface TokenScope {
  /** Type of scope: session, project, organization, or global */
  scope_type: 'session' | 'project' | 'organization' | 'global';
  /** Identifier for the scope (session ID, project ID, org ID, etc.) */
  scope_id: string;
  /** Optional: specific model or provider to filter by */
  model?: string;
  provider?: string;
}

// ─── TokenUsage ──────────────────────────────────────────────────────────────

/**
 * Token usage data returned by a TokenSource.
 */
export interface TokenUsage {
  /** Total tokens consumed in the scope */
  tokens_consumed: number;
  /** Tokens remaining (if quota-based source) */
  tokens_remaining?: number;
  /** Token limit/quota (if applicable) */
  tokens_limit?: number;
  /** Timestamp of the measurement (ISO 8601) */
  timestamp: string;
  /** Source-specific metadata */
  metadata?: Record<string, unknown>;
  /** Breakdown by model/provider if available */
  breakdown?: {
    by_model?: Record<string, number>;
    by_provider?: Record<string, number>;
  };
}

// ─── TokenSource Interface ───────────────────────────────────────────────────

/**
 * Interface that all token sources must implement.
 * FlightPlan uses this to fetch token usage from external sources.
 */
export interface TokenSource {
  /** Unique identifier for this token source (e.g., 'openwork', 'anthropic', 'local') */
  readonly source_id: string;

  /** Human-readable name */
  readonly name: string;

  /** Version of the adapter implementation */
  readonly version: string;

  /**
   * Fetch current token usage for a given scope.
   * @param scope - The scope of token usage to fetch
   * @returns Token usage data
   */
  fetchUsage(scope: TokenScope): Promise<TokenUsage>;

  /**
   * Optional: Subscribe to real-time token updates.
   * @param scope - The scope to subscribe to
   * @param callback - Called when new usage data is available
   * @returns Unsubscribe function
   */
  subscribe?(scope: TokenScope, callback: (usage: TokenUsage) => void): () => void;

  /**
   * Health check for the token source.
   * @returns Health status
   */
  healthCheck(): Promise<HealthStatus>;

  /**
   * Optional: Get supported scope types
   */
  getSupportedScopes?(): TokenScope['scope_type'][];
}

// ─── TokenSource Registry ────────────────────────────────────────────────────

/**
 * Registry for managing multiple token sources.
 * Allows FlightPlan to query multiple token sources uniformly.
 */
export interface TokenSourceRegistry {
  /** Register a new token source */
  register(source: TokenSource): void;

  /** Unregister a token source by ID */
  unregister(sourceId: string): boolean;

  /** Get a token source by ID */
  get(sourceId: string): TokenSource | undefined;

  /** List all registered token sources */
  list(): TokenSource[];

  /**
   * Fetch usage from all registered sources for a given scope.
   * Returns a map of source_id -> TokenUsage.
   */
  fetchAll(scope: TokenScope): Promise<Map<string, TokenUsage>>;

  /**
   * Fetch usage from a specific source.
   */
  fetchFrom(sourceId: string, scope: TokenScope): Promise<TokenUsage | null>;

  /**
   * Health check all registered sources.
   */
  healthCheckAll(): Promise<Map<string, HealthStatus>>;
}

// ─── Token Observation Receipt ───────────────────────────────────────────────

/**
 * Receipt for a token observation from a TokenSource.
 * Stored in receipts/token-observations/
 */
export interface TokenObservationReceipt {
  /** Unique receipt ID */
  receipt_id: string;
  /** Type of receipt */
  receipt_type: 'TOKEN_OBSERVATION';
  /** Token source that produced this observation */
  source_id: string;
  /** Scope of the observation */
  scope: TokenScope;
  /** Token usage observed */
  usage: {
    tokens_consumed: number;
    tokens_remaining?: number;
    tokens_limit?: number;
    breakdown?: {
      by_model?: Record<string, number>;
      by_provider?: Record<string, number>;
    };
  };
  /** Timestamp of the observation */
  observed_at: string;
  /** Adapter version that produced this observation */
  adapter_version: string;
  /** Health status at time of observation */
  health_status: 'healthy' | 'degraded' | 'unhealthy';
  /** Integrity hash of the receipt content */
  integrity_hash: string;
  /** Schema version */
  schema_version: '1.0';
}

// ─── TokenSource Registry Implementation ────────────────────────────────────

/**
 * In-memory implementation of TokenSourceRegistry.
 * In production, this could be backed by persistent storage.
 */
export class InMemoryTokenSourceRegistry implements TokenSourceRegistry {
  private sources = new Map<string, TokenSource>();

  register(source: TokenSource): void {
    if (this.sources.has(source.source_id)) {
      throw new Error(`TokenSource with id ${source.source_id} already registered`);
    }
    this.sources.set(source.source_id, source);
  }

  unregister(sourceId: string): boolean {
    return this.sources.delete(sourceId);
  }

  get(sourceId: string): TokenSource | undefined {
    return this.sources.get(sourceId);
  }

  list(): TokenSource[] {
    return Array.from(this.sources.values());
  }

  async fetchAll(scope: TokenScope): Promise<Map<string, TokenUsage>> {
    const results = new Map<string, TokenUsage>();
    for (const [sourceId, source] of this.sources) {
      try {
        const usage = await source.fetchUsage(scope);
        results.set(source.source_id, usage);
      } catch (error) {
        // Log error but don't fail the whole batch
        console.error(`[TokenSourceRegistry] Failed to fetch from ${source.source_id}:`, error);
      }
    }
    return results;
  }

  async fetchFrom(sourceId: string, scope: TokenScope): Promise<TokenUsage | null> {
    const source = this.sources.get(sourceId);
    if (!source) return null;
    try {
      return await source.fetchUsage(scope);
    } catch (error) {
      console.error(`[TokenSourceRegistry] Failed to fetch from ${sourceId}:`, error);
      return null;
    }
  }

  async healthCheckAll(): Promise<Map<string, HealthStatus>> {
    const results = new Map<string, HealthStatus>();
    for (const [sourceId, source] of this.sources) {
      try {
        const health = await source.healthCheck();
        results.set(sourceId, health);
      } catch (error) {
        results.set(sourceId, {
          healthy: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }
}

// ─── Singleton Registry Instance ─────────────────────────────────────────────

/**
 * Global singleton registry instance.
 * Use getTokenSourceRegistry() to access.
 */
let _registry: InMemoryTokenSourceRegistry | null = null;

export function getTokenSourceRegistry(): InMemoryTokenSourceRegistry {
  if (!_registry) {
    _registry = new InMemoryTokenSourceRegistry();
  }
  return _registry;
}

export function setTokenSourceRegistry(registry: InMemoryTokenSourceRegistry): void {
  _registry = registry;
}