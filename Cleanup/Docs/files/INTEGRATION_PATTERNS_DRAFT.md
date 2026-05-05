## Using Flightplan with Other Tools

Flightplan is designed to work with any LLM client or agent, regardless of
whether that client speaks MCP. There are three integration patterns,
in order of preference:

### Pattern 1 — Native MCP

If your client supports MCP (Model Context Protocol), Flightplan plugs in
directly. The three tools — `get_runway`, `session_start`, `record_session`
— become callable from inside your session.

Configure your client's MCP settings to launch Flightplan as a stdio server.
For Claude Desktop, this looks like:

```json
{
  "mcpServers": {
    "flightplan": {
      "command": "npx",
      "args": ["-y", "flightplan-mcp"]
    }
  }
}
```

This is the richest integration: the agent can check runway mid-session and
adjust behavior without any wrapper code.

### Pattern 2 — CLI as a function tool

If your client supports custom tools or function calling but not MCP, register
`flightplan status --json` as a tool. The agent calls it like any other
function and receives structured runway data.

Example shape (pseudo-code; adapt to your framework):

```ts
{
  name: "get_runway",
  description: "Check current token runway state.",
  handler: async () => {
    const { stdout } = await execFile("flightplan", ["status", "--json"]);
    return JSON.parse(stdout);
  }
}
```

This works with any framework that supports custom tools. The agent gets the
same runway data; it just arrives via subprocess instead of MCP.

> **Note:** Use `execFile` (or an async wrapper around `exec`) rather than
> `execSync`. A blocking call inside an async tool handler will stall the
> agent loop if the CLI takes longer than expected.

### Pattern 3 — Markdown snapshot for handoffs

For LLM clients with no tool-calling at all (a plain chat window with a paste
field), use `flightplan export` to produce a `RUNWAY_STATE.md` snapshot. Paste
it into the conversation and the model gets the same context, just without
the ability to update it mid-session.

This is the fallback that makes Flightplan work *everywhere*, including
ChatGPT-style chat UIs, mobile clients, and any tool that accepts text.

---

### Carrier compatibility

| Mode | Command | Best for |
|:---|:---|:---|
| MCP Live | `get_runway()` (called by agent) | Clients with native MCP |
| JSON Pipe | `flightplan status --json` | Frameworks with custom tools |
| MD Snapshot | `flightplan export` | Plain chat UIs, handoffs |

> **Verifying support for a specific client:** MCP support and function-calling
> capabilities change quickly. Check your client's current docs before
> committing to an integration pattern. If a client added MCP support since
> you last looked, prefer Pattern 1.

### Recommended call points

Whichever pattern you use, the same three call points apply:

- **`session_start()`** — when the agent begins meaningful work
- **`get_runway()`** — before any expensive operation, or whenever the agent
  wants to budget remaining context
- **`record_session()`** — at session end, to archive tokens used and
  contribute to Dead Reckoning calibration (Phase 2)
