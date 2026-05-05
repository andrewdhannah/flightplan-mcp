/**
 * Node version guard — runs before anything else.
 *
 * Why this exists:
 *   better-sqlite3 and sqlite-vec are native modules — they contain compiled
 *   C++ code that must match the Node version exactly. Pre-built binaries
 *   are only published for Node 18–22. Running on Node 23+ causes a cryptic
 *   200-line C++ compile error during npm install that gives the user no
 *   actionable guidance.
 *
 *   This check catches that failure at runtime with a clear fix instead.
 *   Three layers of protection total:
 *     1. .nvmrc         — catches it before install (nvm users)
 *     2. package.json   — catches it at install time (npm warns)
 *     3. This check     — catches it at runtime if the first two were missed
 *
 * Updated: May 4, 2026
 */
// Split "20.11.0" → ["20","11","0"] → [20,11,0] → take first element.
// The ?? 0 handles the theoretical case where split returns empty —
// 0 will always fail the version check and show the user a clear error.
const nodeMajor = process.versions.node.split('.').map(Number)[0] ?? 0;
if (nodeMajor < 18 || nodeMajor > 22) {
  console.error(
    `\n🪿 Flightplan requires Node 18–22 (you are running Node ${process.versions.node}).\n` +
    `\n` +
    `   Fix:\n` +
    `     nvm use 20        (if you have nvm installed)\n` +
    `     nvm install 20    (if Node 20 is not installed yet)\n` +
    `\n` +
    `   Don't have nvm? Install it:\n` +
    `     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash\n` +
    `   Then close and reopen Terminal, and run: nvm use\n`
  );
  process.exit(1);
}

/**
 * src/index.ts — MCP server entry point
 *
 * Starts the Flightplan MCP server and registers all available tools.
 * This is the file that runs when your agent executes `npx flightplan-mcp`.
 *
 * Phase 1 tools registered here:
 *   get_runway       — Check current token runway state ✅
 *   session_start    — Open a new tracking session ✅
 *   record_session   — Archive session data and close it ✅
 *
 * How MCP works (quick primer):
 *   The agent (Claude Code, Codex, etc.) spawns this process via stdio.
 *   The MCP SDK handles the JSON-RPC protocol between agent and server.
 *   We define tools with a name, description, and input schema.
 *   The agent calls tools by name; we run the handler and return the result.
 *
 * Transport:
 *   StdioServerTransport — communicates via stdin/stdout.
 *   This is the standard transport for local MCP servers.
 *   No port, no HTTP — the agent manages the process lifecycle.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getRunway } from './tools/get_runway.js';
import { sessionStart } from './tools/session_start.js';
import { recordSession } from './tools/record_session.js';

// ─── Server definition ────────────────────────────────────────────────────────

/**
 * The MCP server instance.
 * name and version appear in the agent's tool listing.
 * Keep the name stable — changing it breaks existing agent configs.
 */
const server = new McpServer({
  name: 'flightplan',
  version: '0.1.0',
});

// ─── Tool: get_runway ─────────────────────────────────────────────────────────

/**
 * Registers the get_runway tool with the MCP server.
 *
 * description:
 *   This is what the agent reads to decide when to call the tool.
 *   Keep it action-oriented — "Call this before X" is clearer than "Returns Y."
 *
 * inputSchema:
 *   get_runway takes no parameters — all state comes from the DB.
 *   Empty properties object signals this to the MCP SDK.
 *
 * handler:
 *   Calls getRunway() from get_runway.ts.
 *   Wraps the response in MCP's expected { content: [...] } envelope.
 *   Returns text/plain so the agent can read it directly.
 */
server.tool(
  'get_runway',

  // Description the agent uses to decide when to call this tool.
  'Check your current token runway before high-cost operations. ' +
  'Returns the Goose Scale level, remaining tokens, and a recommended action. ' +
  'Call this at session start and before any large code generation, analysis, or refactoring task.',

  // Input schema — no parameters needed.
  {},

  // Handler — runs when the agent calls get_runway().
  async () => {
    const result = getRunway();

    return {
      content: [
        {
          type: 'text' as const,
          // Serialize the full RunwayResponse as formatted JSON.
          // The agent can parse this or read it as text — both work.
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ─── Tool: session_start ─────────────────────────────────────────────────────

/**
 * Registers session_start — opens a new tracking session.
 * Agent calls this at the beginning of a working session.
 *
 * Parameters:
 *   provider   — optional, which AI tool is running
 *   model      — optional, specific model name
 *   project_id — optional, tag for grouping sessions
 */
server.tool(
  'session_start',

  'Start a new Flightplan tracking session. ' +
  'Call this at the beginning of each working session before doing any work. ' +
  'Returns a session_id you will need when calling record_session() at the end.',

  // Input schema — all fields optional.
  // Zod is what the MCP SDK uses internally for parameter validation.
  // z.string().optional() means: accept a string if present, undefined if not.
  {
    provider:   z.string().optional().describe('AI tool name (e.g. "claude-code")'),
    model:      z.string().optional().describe('Model name if known (e.g. "claude-sonnet-4-6")'),
    project_id: z.string().optional().describe('Optional project tag for grouping sessions'),
  },

  async (params) => {
    const result = sessionStart({
      provider:   typeof params.provider   === 'string' ? params.provider   : undefined,
      model:      typeof params.model      === 'string' ? params.model      : undefined,
      project_id: typeof params.project_id === 'string' ? params.project_id : undefined,
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: record_session ─────────────────────────────────────────────────────

/**
 * Registers record_session — archives session data and closes the session.
 * Agent calls this at the end of a working session with the final token count.
 *
 * Parameters:
 *   tokens_total — REQUIRED. Final token count for the session.
 *   notes        — optional freeform notes about the session.
 */
server.tool(
  'record_session',

  'End the current Flightplan tracking session and record your token usage. ' +
  'Call this when you are done working for the session. ' +
  'Provide tokens_total — your final token count from this session. ' +
  'This data improves your baseline estimate over time.',

  // Input schema — tokens_total required, notes optional.
  // z.number() = required number. z.string().optional() = optional string.
  {
    tokens_total: z.number().describe('Total tokens used in this session (required)'),
    notes:        z.string().optional().describe('Optional notes about this session'),
  },

  async (params) => {
    // Note: tokens_total type is already enforced by z.number() in the Zod
    // schema above — no manual typeof check needed here.
    const result = recordSession({
      tokens_total: params.tokens_total,
      notes: typeof params.notes === 'string' ? params.notes : undefined,
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Start server ─────────────────────────────────────────────────────────────

/**
 * Connects the server to stdio and starts listening for tool calls.
 *
 * connect() is async but we don't await it at the top level —
 * instead we catch errors below and exit with a non-zero code.
 * This gives the agent a clear signal that something went wrong.
 *
 * Note: console.error goes to stderr (not stdout), so it doesn't
 * interfere with the MCP JSON-RPC protocol on stdout.
 */
const transport = new StdioServerTransport();

server.connect(transport).catch((err) => {
  console.error('[flightplan] Fatal: MCP server failed to start:', err);
  process.exit(1);
});
