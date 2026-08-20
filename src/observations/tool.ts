/**
 * src/observations/tool.ts — MCP tool for RuntimeResourceObservation emission
 *
 * Registers the `emit_observation` MCP tool. This is the explicit
 * observation interface — when the agent or Librarian asks FlightPlan
 * "what is the current resource state?", this tool answers with a
 * structured observation.
 *
 * Design:
 *   - Explicit tool, not implicit (observation is a deliberate act)
 *   - Does not persist (Librarian decides what to do with observations)
 *   - Does not make policy decisions (gates.ts owns that)
 *   - Returns JSON matching runtime-resource-observation-v1.schema.json
 *
 * DB access:
 *   Uses dynamic import for openDb() to avoid circular deps at module level.
 *   Same pattern as gates.ts and landing.ts.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { emitObservation } from './emission.js';

/**
 * Register the emit_observation tool with an MCP server.
 *
 * @param server - MCP server instance to register with
 */
export function registerObservationTool(server: McpServer): void {
  server.tool(
    'emit_observation',

    'Emit a RuntimeResourceObservation — a structured snapshot of current ' +
      'token consumption, estimate, and variance. This is FlightPlan\'s ' +
      'sensor output for the Librarian evidence store. Call this to get ' +
      'a governed observation of resource state. Does not persist — ' +
      'Librarian decides what to do with observations.',

    {
      session_id: z
        .string()
        .optional()
        .describe('Override session ID. If omitted, reads from active_session.'),
      work_packet_id: z
        .string()
        .optional()
        .describe('Work Packet ID if this session is governed. Omit for ungoverned sessions.'),
      work_order_id: z
        .string()
        .optional()
        .describe('Librarian Work Order ID if present. Omit if not applicable.'),
      model: z
        .string()
        .optional()
        .describe('Override model for estimate lookup.'),
      provider: z
        .string()
        .optional()
        .describe('Override provider for estimate lookup.'),
      project: z
        .string()
        .optional()
        .describe('Override project for estimate lookup.'),
    },

    async (params) => {
      // Dynamic import to avoid circular deps — same pattern as gates.ts
      const { openDb } = await import('../db/connection.js');
      const db = openDb();

      const observation = emitObservation(db, {
        session_id: typeof params.session_id === 'string' ? params.session_id : undefined,
        work_packet_id: typeof params.work_packet_id === 'string' ? params.work_packet_id : undefined,
        work_order_id: typeof params.work_order_id === 'string' ? params.work_order_id : undefined,
        estimate_input: {
          model: typeof params.model === 'string' ? params.model : undefined,
          provider: typeof params.provider === 'string' ? params.provider : undefined,
          project: typeof params.project === 'string' ? params.project : undefined,
        },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(observation, null, 2),
          },
        ],
      };
    },
  );
}
