/**
 * src/tokensource/integration.ts — TokenSource Integration Layer
 *
 * Provides a unified API for FlightPlan to interact with TokenSources.
 * Re-exports and wraps the core types and registry implementation.
 */

import type {
  TokenSource,
  TokenSourceRegistry,
  TokenScope,
  TokenUsage,
  HealthStatus,
  TokenObservationReceipt,
} from './types.js';

import {
  getTokenSourceRegistry,
  setTokenSourceRegistry,
  InMemoryTokenSourceRegistry as RegistryImpl,
} from './types.js';

import { OpenWorkAdapter, createOpenWorkAdapterFromEnv } from './openwork_adapter.js';

/**
 * Initialize the TokenSource registry with default sources.
 * Call this during application startup.
 */
export async function initializeTokenSources(): Promise<void> {
  const registry = getTokenSourceRegistry();

  // Register OpenWork adapter if configured
  if (process.env.OPENWORK_API_URL && process.env.OPENWORK_API_KEY) {
    try {
      const openworkAdapter = createOpenWorkAdapterFromEnv();
      registerTokenSource(openworkAdapter);
      console.log('[TokenSource] Registered OpenWork adapter');
    } catch (error) {
      console.warn('[TokenSource] Failed to initialize OpenWork adapter:', error);
    }
  }

  // Log registered sources
  const sources = getTokenSourceRegistry().list();
  console.log(`[TokenSource] Registered ${sources.length} source(s):`, sources.map(s => s.source_id).join(', '));
}

/**
 * Register a TokenSource in the global registry.
 */
export function registerTokenSource(source: TokenSource): void {
  const registry = getTokenSourceRegistry();
  registry.register(source);
}

/**
 * Unregister a TokenSource from the global registry.
 */
export function unregisterTokenSource(sourceId: string): boolean {
  const registry = getTokenSourceRegistry();
  return registry.unregister(sourceId);
}

/**
 * Get a TokenSource by ID.
 */
export function getTokenSource(sourceId: string): TokenSource | undefined {
  return getTokenSourceRegistry().get(sourceId);
}

/**
 * List all registered TokenSources.
 */
export function listTokenSources(): TokenSource[] {
  return getTokenSourceRegistry().list();
}

/**
 * Fetch token usage from all registered sources for a given scope.
 */
export async function fetchAllTokenUsage(scope: TokenScope): Promise<Map<string, TokenUsage>> {
  return getTokenSourceRegistry().fetchAll(scope);
}

/**
 * Fetch token usage from a specific source.
 */
export async function fetchTokenUsageFrom(sourceId: string, scope: TokenScope): Promise<TokenUsage | null> {
  return getTokenSourceRegistry().fetchFrom(sourceId, scope);
}

/**
 * Health check all registered token sources.
 */
export async function healthCheckAllTokenSources(): Promise<Map<string, HealthStatus>> {
  return getTokenSourceRegistry().healthCheckAll();
}

/**
 * Register the default OpenWork adapter if configured.
 * Convenience function for application startup.
 */
export async function initializeDefaultTokenSources(): Promise<void> {
  await initializeTokenSources();
}

/**
 * Register a custom TokenSource.
 * Use this for testing or adding custom sources.
 */
export function addTokenSource(source: TokenSource): void {
  registerTokenSource(source);
}

/**
 * Remove a TokenSource from the registry.
 */
export function removeTokenSource(sourceId: string): boolean {
  return unregisterTokenSource(sourceId);
}

/**
 * Initialize the TokenSource system with default configuration.
 * This is the main entry point for applications.
 */
export async function setupTokenSources(): Promise<void> {
  await initializeTokenSources();
}

/**
 * Shutdown all token sources gracefully.
 */
export async function shutdownTokenSources(): Promise<void> {
  const registry = getTokenSourceRegistry();
  for (const source of registry.list()) {
    if ('destroy' in source && typeof source.destroy === 'function') {
      try {
        source.destroy();
      } catch (error) {
        console.warn(`[TokenSource] Error destroying ${source.source_id}:`, error);
      }
    }
  }
  setTokenSourceRegistry(new RegistryImpl());
}

// Re-export types for convenience
export type {
  TokenSource,
  TokenSourceRegistry,
  TokenScope,
  TokenUsage,
  HealthStatus,
  TokenObservationReceipt,
  InMemoryTokenSourceRegistry,
} from './types.js';

export {
  OpenWorkAdapter,
  createOpenWorkAdapterFromEnv,
} from './openwork_adapter.js';

export {
  getTokenSourceRegistry,
  setTokenSourceRegistry,
} from './types.js';