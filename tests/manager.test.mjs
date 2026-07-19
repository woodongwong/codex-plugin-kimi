import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { KimiJobManager } from "../plugins/kimi/src/runtime/manager.mjs";

const execFile = promisify(execFileCallback);
const fakeKimi = path.resolve("tests/fixtures/fake-kimi.mjs");
const terminal = new Set(["completed", "blocked", "failed", "cancelled"]);

async function git(cwd, ...args) {
  return execFile("git", ["-C", cwd, ...args]);
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-companion-test-"));
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  await git(repo, "init", "-q");
  await git(repo, "config", "user.name", "Kimi Companion Test");
  await git(repo, "config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(repo, "README.md"), "# fixture\n", "utf8");
  await git(repo, "add", "README.md");
  await git(repo, "commit", "-qm", "initial");

  const manager = new KimiJobManager({
    binary: fakeKimi,
    dataDir: path.join(root, "data"),
  });
  await manager.initialize();
  return { root, repo, manager };
}

async function waitForTerminal(manager, jobId, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await manager.status(jobId);
    if (terminal.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
}

test("parallel write jobs use isolated worktrees and create Git checkpoints", async (t) => {
  const { root, repo, manager } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const [first, second] = await Promise.all([
    manager.delegate({ cwd: repo, task: "first task", acceptanceCriteria: ["write worker.txt"] }),
    manager.delegate({ cwd: repo, task: "second task", acceptanceCriteria: ["write worker.txt"] }),
  ]);
  assert.notEqual(first.worktree, second.worktree);
  assert.notEqual(first.branch, second.branch);

  const [firstDone, secondDone] = await Promise.all([
    waitForTerminal(manager, first.id),
    waitForTerminal(manager, second.id),
  ]);
  assert.equal(firstDone.status, "completed", firstDone.error);
  assert.equal(secondDone.status, "completed", secondDone.error);

  for (const job of [firstDone, secondDone]) {
    assert.equal(job.result.git.committed, true);
    assert.deepEqual(job.result.handoff.changed_files, ["worker.txt"]);
    assert.match(await fs.readFile(path.join(job.worktree, "worker.txt"), "utf8"), /fake Kimi/);
  }

  await assert.rejects(fs.access(path.join(repo, "worker.txt")));
});

test("continue resumes the ACP session and reuses the job worktree", async (t) => {
  const { root, repo, manager } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const started = await manager.delegate({ cwd: repo, task: "continuation task" });
  const first = await waitForTerminal(manager, started.id);
  assert.equal(first.status, "completed", first.error);
  const sessionId = first.sessionId;
  const worktree = first.worktree;

  const continued = await manager.continue(first.id, "Refine the result");
  assert.equal(continued.attempt, 2);
  const second = await waitForTerminal(manager, first.id);
  assert.equal(second.status, "completed", second.error);
  assert.equal(second.sessionId, sessionId);
  assert.equal(second.worktree, worktree);
  assert.equal(second.attempt, 2);
});

test("review jobs leave the target directory unchanged", async (t) => {
  const { root, repo, manager } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const started = await manager.review({ cwd: repo, task: "Review this repository" });
  const result = await waitForTerminal(manager, started.id);
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.result.handoff.summary, "Fake review completed.");
  assert.equal((await git(repo, "status", "--porcelain")).stdout, "");
});

test("cancelling an active ACP turn records cancelled instead of failed", async (t) => {
  const { root, repo, manager } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const started = await manager.delegate({ cwd: repo, task: "[slow] wait for cancellation" });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = await manager.status(started.id);
    if (current.phase === "working") break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  await manager.cancel(started.id);
  const result = await waitForTerminal(manager, started.id);
  assert.equal(result.status, "cancelled", result.error);
});
