# Flightplan MCP — Installation Guide

## Prerequisites

- **Node.js 18–22** (Node 20 LTS recommended)
- **npm** (comes with Node)
- **nvm** (recommended for Node version management)

Flightplan requires Node 18–22 because `better-sqlite3` and `sqlite-vec`
publish pre-built binaries for these versions only. Node 23+ requires
compiling native modules from source, which fails without a specific
C++20 toolchain. An engine guard enforces this in `package.json`, and a
runtime check in `src/index.ts` provides a clear error message if you
accidentally run on the wrong version.

---

## Method 1: Global Install (via npm)

```bash
npm install -g flightplan-mcp
```

After install, run the init wizard:

```bash
flightplan-mcp init
```

Then verify:

```bash
flightplan status
flightplan --help
```

---

## Method 2: Clone and Install (from GitHub)

```bash
git clone https://github.com/andrewdhannah/flightplan-mcp.git
cd flightplan-mcp
nvm use 20          # or: nvm use (if .nvmrc is configured)
npm install
npm run build
npm run smoke
```

Then either:

**A) Use directly (no global install):**

```bash
node dist/status.js           # check runway
node dist/index.js            # MCP server
node dist/cli.js              # init wizard
```

**B) Link globally for convenience (optional):**

```bash
npm link
flightplan status             # works from anywhere
```

---

## Method 3: Run Without Installing (via npx)

```bash
npx flightplan-mcp init       # first-time setup
npx flightplan-mcp            # start MCP server
```

Note: The `flightplan` CLI binary (`status`, `stats`, `estimate`, etc.)
requires either global install (`npm install -g`) or local clone. The
`npx` method only runs the MCP server and init wizard.

For the full CLI experience, use Method 1 (global install) or Method 2B (npm link).

---

## MCP Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flightplan": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/to/flightplan-mcp/dist/index.js"]
    }
  }
}
```

Replace `/ABSOLUTE/PATH/` with the actual absolute path to the cloned
repository. For global installs, you can also use:

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

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.flightplan]
command = "npx"
args = ["-y", "flightplan-mcp"]
```

Or for a local build:

```toml
[mcp_servers.flightplan]
command = "node"
args = ["/ABSOLUTE/PATH/flightplan-mcp/dist/index.js"]
```

### OpenWork

In OpenWork settings > Extensions > MCP Servers, add a new server:

```
Name: Flightplan
Command: node
Args: ["/ABSOLUTE/PATH/flightplan-mcp/dist/index.js"]
```

---

## First-Time Setup

After installing, run the init wizard:

```bash
flightplan-mcp init
```

You will be asked three questions:

1. **Provider name** — What AI tool do you use? (e.g., `Claude Code`, `Codex`)
2. **Session baseline** — How many tokens is a typical session?
   - Default: 40,000. Adjust based on your experience.
   - After 5 sessions, Dead Reckoning auto-calibrates this value.
3. **Warning threshold** — At what % should Flightplan warn you?
   - Default: 25%. You'll see a warning when 25% of your runway remains.

The wizard creates `~/.flightplan/flightplan.db` with your settings.

---

## Verify Installation

```bash
# Check smoke test (dependencies, DB, schema)
npm run smoke

# Run the build
npm run build

# Run all tests (uses in-memory DBs — never touches live DB)
npm test

# Check runway status
flightplan status
```

---

## Node Version Troubleshooting

**Problem:** `Error: The module was compiled against a different Node.js version`

**Fix:**
```bash
nvm use 20
npm rebuild
```

**Problem:** `Node 23+ C++ compile error`

**Fix:** Install Node 20 via nvm:
```bash
nvm install 20
nvm use 20
npm install
```

---

## Test Safety

All tests use in-memory SQLite databases. They **never** read, write, or
mutate the live DB at `~/.flightplan/flightplan.db`. The `FLIGHTPLAN_DB_PATH`
environment variable can be set to redirect the DB to a different file for
testing purposes.
