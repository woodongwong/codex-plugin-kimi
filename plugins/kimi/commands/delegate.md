---
description: Delegate an implementation task to Kimi Code in an isolated worktree
argument-hint: [task]
---

Delegate this task to Kimi Code: $ARGUMENTS

Before calling `kimi_delegate`, inspect enough repository context to provide a self-contained task contract with concrete acceptance criteria, allowed paths, suggested tests, the absolute repository path, and an appropriate base ref. Return the job id and worktree immediately; do not poll continuously unless the user asked to wait.
