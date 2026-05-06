# FlightPlan Runway State
**Generated:** 2026-05-06T03:54:14.730Z
**Source:** `flightplan export` (Flightplan v0.1.0)
**Provider:** Claude Code

> ⚠️ This is a point-in-time snapshot. If significant time has passed since
> this timestamp, ask the user to run `flightplan export` again for fresh data.
> Token counts change as the session progresses — treat old snapshots as estimates.

## Agent Contract

*Read this before doing anything else.*

| Level | State | Action |
| :--- | :--- | :--- |
| 🔴 HONK | Runway exhausted | **Stop.** Finish current sentence. Call `record_session()`. Nothing new. |
| 🟠 TURBULENCE | Runway tight | **Do not start large tasks.** Wrap up or checkpoint only. |
| 🟡 HEADWIND | Burning fast | **Small, scoped tasks only.** Finish what's open before starting new work. |
| 🟢 CRUISING | Healthy | Proceed. Re-evaluate runway before any major operation. |
| ⬜ PREFLIGHT | No session | Call `session_start()` before beginning work. |

**Before any major task:** check the Goose Scale level in Section 1.
**When uncertain:** default to the more conservative behaviour above.

## 1. High-Level Metadata (The "Compass")
*Orients the LLM immediately. Read this section first.*

- **Goose Scale Level:** PREFLIGHT
- **Session Active:** No
- **Runway Remaining:** 100% (40,000 tokens)
- **Tokens Observed:** 0 / 40,000 baseline
- **Warning Threshold:** 25% (warnings enabled)
- **Project Health:** Standby — no session active

### What the Goose Scale level means right now
No session is active. Call `session_start()` before beginning work.
Token tracking will not function until a session is open.

## 2. Active Session (The "Flight Log")

No session is currently active (PREFLIGHT state).

The user has not called `session_start()` yet, or the previous session
was closed with `record_session()`. Token counts are not being tracked.

To begin tracking: call `session_start()` in your AI tool.

## 3. Dead Reckoning Status

- **Sessions Archived:** 1
- **Phase 2 Status:** ⏳ Unlocks in 4 more sessions

**Currently unavailable (Phase 1 — returns null):**
- `burn_rate_per_hour` — requires 5+ archived sessions
- `time_remaining_minutes` — derived from burn rate
- `token_range` — confidence interval from session variance

These fields activate automatically after 4 more completed sessions.

## 4. How To Use This File

You are reading a Flightplan runway state snapshot. Here is how to use it:

1. **Check staleness first.** Compare the `Generated` timestamp above against
   the current time. If it is more than 30 minutes old, ask the user to run
   `flightplan export` again before making decisions based on token counts.

2. **Use the Goose Scale level.** The level in Section 1 is your primary signal.
   CRUISING = proceed normally. HEADWIND = start wrapping up soon.
   TURBULENCE = prioritize finishing current task. HONK = land now.

3. **Do not estimate what is null.** Fields marked as unavailable in Section 3
   are genuinely unknown — do not substitute 0 or invent estimates. Say so.

4. **This replaces `get_runway()`.** If you cannot call MCP tools, this file
   gives you the same data. Treat it as equivalent to a `get_runway()` response.

## 5. Deliberately Deferred (Do Not Act On These Yet)

The following features are planned but not yet built. Do not suggest
implementations or ask about them unless the user raises them first:

- **Dead Reckoning (Phase 2):** Auto-calibrating baseline, velocity calculation,
  confidence intervals. Unlocks after 5 sessions.
- **Formation Trust (Phase 3):** Community velocity profiles, Flock File,
  opt-in anonymous session sharing.
- **Flightplan Lite:** Prompt-only version for LLMs without file upload.

---

> **Snapshot taken at 2026-05-06T03:54:14.730Z.**
> Re-export before long tasks, refactors, or multi-step operations.
> Run `flightplan export` to get fresh data.
