---
name: kimi-companion
description: Delegate bounded coding or review tasks from Codex to local Kimi Code, especially when parallel execution or reduced Codex implementation work is useful. Use Kimi background jobs, isolated Git worktrees, compact handoffs, and independent Codex verification.
---

# Kimi Companion

Use the `kimi` MCP tools to treat Kimi Code as an implementation worker while Codex remains the supervisor and reviewer.

## Workflow

1. Run `kimi_setup` when availability or authentication is uncertain.
2. Turn the request into a bounded task contract: objective, acceptance criteria, allowed paths, tests, and base ref.
3. Use `kimi_delegate` for implementation. It creates an isolated Git worktree and returns immediately.
4. Start independent tasks in parallel only when their file scopes do not overlap.
5. Poll with `kimi_status`; fetch the compact result with `kimi_result` after completion.
6. Review the returned commit and diff independently. Do not request the full Kimi output unless the compact handoff is insufficient.
7. Send concrete findings back through `kimi_continue`, then review the new checkpoint.

Use `kimi_review` for a second opinion that must not modify the working tree. The bridge uses Kimi plan mode and rejects mutation approvals, but this is policy enforcement rather than an operating-system sandbox; inspect repository state after a review if strict immutability matters.

Never let two write jobs share one working directory. `kimi_delegate` uses separate worktrees by default; preserve that isolation until Codex has reviewed and intentionally integrated a result.
