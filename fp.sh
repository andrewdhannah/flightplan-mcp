#!/usr/bin/env bash
# fp.sh — Flightplan developer shortcuts
#
# Usage (from project root):
#   ./fp.sh status     — flightplan status
#   ./fp.sh export     — flightplan export
#   ./fp.sh publish    — build + bump patch version + publish to npm
#   ./fp.sh push       — git push + push tags
#
# To use as a global command from anywhere, add to ~/.zshrc:
#   alias fp="/Users/andrew/desktop/flightplan-mcp/fp.sh"

# ── Safety: exit immediately if any command fails ─────────────────────────────
# This means if `npm run build` fails, it won't accidentally run `npm publish`.
set -e

# ── Resolve project root ──────────────────────────────────────────────────────
# SCRIPT_DIR is the folder this script lives in, regardless of where you run it.
# This means `fp publish` works even if your terminal is in a different folder.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Command router ────────────────────────────────────────────────────────────
case "$1" in

  status)
    # Show current token runway — the main glanceable display.
    flightplan status
    ;;

  export)
    # Write RUNWAY_STATE.md to the project root for pasting into other LLMs.
    cd "$SCRIPT_DIR"
    flightplan export
    ;;

  publish)
    # Full release flow: build → bump patch version → publish to npm.
    # set -e means this stops at the first failure — won't publish broken code.
    cd "$SCRIPT_DIR"
    npm run build
    npm version patch
    npm publish
    ;;

  push)
    # Push commits and version tags to GitHub.
    cd "$SCRIPT_DIR"
    git push && git push --tags
    ;;

  *)
    # Unknown command — print usage so it's self-documenting.
    echo ""
    echo "  🪿 Flightplan dev shortcuts"
    echo ""
    echo "  fp status     — flightplan status"
    echo "  fp export     — flightplan export"
    echo "  fp publish    — build + bump version + npm publish"
    echo "  fp push       — git push + push tags"
    echo ""
    ;;

esac
