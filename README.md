# Kimi Companion for Codex

Kimi Companion lets Codex delegate bounded coding tasks to local Kimi Code workers over ACP, run independent jobs in parallel, and review compact Git-backed handoffs instead of importing Kimi's full context.

## Architecture

```text
Codex commands / skill
        | MCP
        v
Kimi Companion MCP server
        | ACP over stdio
        v
     kimi acp
        |
        v
isolated Git worktree + compact handoff
```

Codex remains the supervisor. Kimi keeps its own session context, performs implementation or review work, and returns a structured handoff. Full ACP event streams are stored outside the Codex conversation and are only read on demand.

## Features

- Background implementation jobs over Kimi ACP
- One isolated Git worktree and branch per write job
- Multiple non-overlapping tasks can run in parallel
- Compact status and result tools that do not flood Codex context
- Persistent job metadata and raw ACP event logs
- Resume a Kimi session with Codex review feedback
- Kimi plan-mode review with mutation approvals rejected
- Automatic Git checkpoint when the host has a configured Git identity

## Requirements

- Codex with plugin and local stdio MCP support
- Node.js 20 or later
- Kimi Code CLI available as `kimi`
- Git for isolated write jobs

Install and authenticate Kimi Code first:

```bash
kimi --version
kimi login
```

See the official [Kimi Code CLI guide](https://www.kimi.com/code/docs/kimi-code-cli/) for platform-specific installation instructions. If the executable is not named `kimi`, set `KIMI_BIN` to its absolute path before starting Codex.

## Install

Add this repository as a Codex plugin marketplace:

```bash
codex plugin marketplace add woodongwong/codex-plugin-kimi
```

Open `/plugins`, select the `codex-plugin-kimi` marketplace, and install **Kimi Companion**. Start a new Codex session after installation.

For local development:

```bash
npm install
npm run build
codex plugin marketplace add /absolute/path/to/codex-plugin-kimi
```

## Commands

| Command | Purpose |
|---|---|
| `/kimi:setup` | Check the Kimi CLI bridge |
| `/kimi:delegate <task>` | Start an isolated background implementation |
| `/kimi:review <target>` | Start a read-only second review |
| `/kimi:status [job-id]` | List jobs or inspect one job |
| `/kimi:result <job-id>` | Return the compact handoff and Git checkpoint |
| `/kimi:continue <job-id> <feedback>` | Resume Kimi with Codex findings |
| `/kimi:cancel <job-id>` | Cancel an active turn |

Natural-language use works too:

```text
Give Kimi these three independent tasks in parallel, then review each result.
```

## Context model

The bridge deliberately does not copy the full Kimi transcript into Codex. Codex and Kimi share:

- the original task contract
- acceptance criteria and allowed paths
- the Git base and resulting checkpoint
- a compact handoff containing decisions, tests, risks, and open questions

Raw `session/update` events and Kimi stderr are stored under the plugin data directory. `kimi_result` returns only the compact handoff by default; `full=true` is an explicit diagnostic escape hatch.

## Parallel write safety

Every `kimi_delegate` call creates a branch named `kimi/<job-id>` and a separate worktree under the plugin data directory. Do not delegate overlapping file scopes in parallel. Codex should inspect the returned commit and diff before integrating it.

Kimi is instructed not to commit. After the turn, the bridge stages and commits changes in the isolated worktree using the user's existing Git identity. If no Git identity is configured, the changes remain safely in the worktree and the job result records a warning.

## Security notes

- A write delegation automatically approves Kimi tool requests once for that isolated task.
- A review rejects mutation approvals and asks Kimi to use plan mode, but this is not an operating-system sandbox.
- Kimi shell commands execute locally under the permissions of the user running the plugin.
- Review the task scope and resulting diff before merging or cherry-picking.
- The plugin never pushes branches, opens pull requests, or publishes changes from delegated jobs.

## Development

```bash
npm install
npm run check
npm test
npm run build
npm run validate
```

The published plugin includes the bundled `plugins/kimi/dist/server.mjs`, so users do not need to install the ACP or MCP JavaScript SDK packages separately.

## License

MIT
