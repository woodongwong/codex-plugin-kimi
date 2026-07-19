import os from "node:os";
import path from "node:path";

import { AcpWorker, friendlyAcpError } from "./acp-worker.mjs";
import { finalizeWorktree, prepareWorktree, repositoryInfo } from "./git-worktree.mjs";
import { buildTaskPrompt, parseHandoff } from "./prompt.mjs";
import { JobStore } from "./store.mjs";
import { executableVersion, newJobId, nowIso, uniqueStrings } from "./util.mjs";

const TERMINAL_STATUSES = new Set(["completed", "blocked", "failed", "cancelled"]);
const JOB_ID_PATTERN = /^kimi-[0-9]{14}-[a-f0-9]{8}$/;

function publicJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    task: job.task,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    cwd: job.cwd,
    worktree: job.worktree ?? null,
    branch: job.branch ?? null,
    baseCommit: job.baseCommit ?? null,
    sessionId: job.sessionId ?? null,
    attempt: job.attempt,
    result: job.result ?? null,
    error: job.error ?? null,
  };
}

export class KimiJobManager {
  constructor(options = {}) {
    this.binary = options.binary ?? process.env.KIMI_BIN ?? "kimi";
    this.dataDir = path.resolve(
      options.dataDir ??
        process.env.KIMI_COMPANION_DATA ??
        process.env.PLUGIN_DATA ??
        path.join(os.homedir(), ".codex", "kimi-companion"),
    );
    this.store = options.store ?? new JobStore(this.dataDir);
    this.active = new Map();
  }

  async initialize() {
    await this.store.initialize();
    const jobs = await this.store.list();
    for (const job of jobs) {
      if (["queued", "running", "cancelling"].includes(job.status)) {
        job.status = "failed";
        job.phase = "interrupted";
        job.error = "The Codex MCP runtime stopped before this background job completed.";
        await this.store.save(job);
      }
    }
  }

  async setup() {
    const kimi = await executableVersion(this.binary);
    return {
      ready: kimi.available,
      binary: this.binary,
      kimi,
      dataDir: this.dataDir,
      nextStep: kimi.available ? "Kimi is available. Authentication is verified when a session starts." : "Install Kimi Code CLI and run `kimi login`.",
    };
  }

  async delegate(input) {
    const availability = await executableVersion(this.binary);
    if (!availability.available) {
      throw new Error(`Kimi Code CLI is unavailable: ${availability.detail}`);
    }

    const id = newJobId();
    const cwd = path.resolve(input.cwd);
    const prepared = await prepareWorktree({
      cwd,
      baseRef: input.baseRef ?? "HEAD",
      dataDir: this.dataDir,
      jobId: id,
    });
    const createdAt = nowIso();
    const job = {
      version: 1,
      id,
      kind: "write",
      permissionMode: "write",
      status: "queued",
      phase: "queued",
      task: String(input.task).trim(),
      cwd,
      repoRoot: prepared.repoRoot,
      worktree: prepared.worktree,
      branch: prepared.branch,
      baseCommit: prepared.baseCommit,
      acceptanceCriteria: uniqueStrings(input.acceptanceCriteria),
      allowedPaths: uniqueStrings(input.allowedPaths),
      testCommands: uniqueStrings(input.testCommands),
      model: input.model ?? null,
      thinking: input.thinking ?? null,
      sessionId: null,
      attempt: 1,
      createdAt,
      updatedAt: createdAt,
      result: null,
      error: null,
      cancelRequested: false,
    };
    await this.store.create(job);
    void this.#run(job, null);
    return publicJob(job);
  }

  async review(input) {
    const availability = await executableVersion(this.binary);
    if (!availability.available) {
      throw new Error(`Kimi Code CLI is unavailable: ${availability.detail}`);
    }

    const id = newJobId();
    const cwd = path.resolve(input.cwd);
    let baseCommit = null;
    try {
      baseCommit = (await repositoryInfo(cwd)).head;
    } catch {
      // Review can still inspect a non-Git directory.
    }
    const createdAt = nowIso();
    const job = {
      version: 1,
      id,
      kind: "review",
      permissionMode: "review",
      status: "queued",
      phase: "queued",
      task: String(input.task).trim(),
      cwd,
      worktree: null,
      branch: null,
      baseCommit,
      acceptanceCriteria: uniqueStrings(input.acceptanceCriteria),
      allowedPaths: [],
      testCommands: uniqueStrings(input.testCommands),
      model: input.model ?? null,
      thinking: input.thinking ?? null,
      sessionId: null,
      attempt: 1,
      createdAt,
      updatedAt: createdAt,
      result: null,
      error: null,
      cancelRequested: false,
    };
    await this.store.create(job);
    void this.#run(job, null);
    return publicJob(job);
  }

  async continue(jobId, feedback) {
    const job = await this.requireJob(jobId);
    if (!TERMINAL_STATUSES.has(job.status)) {
      throw new Error(`Job ${jobId} is ${job.status}; wait for it to finish before continuing.`);
    }
    if (!job.sessionId) throw new Error(`Job ${jobId} has no resumable Kimi session.`);
    job.status = "queued";
    job.phase = "queued";
    job.error = null;
    job.cancelRequested = false;
    job.attempt = Number(job.attempt ?? 1) + 1;
    await this.store.save(job);
    void this.#run(job, String(feedback).trim());
    return publicJob(job);
  }

  async cancel(jobId) {
    const job = await this.requireJob(jobId);
    if (TERMINAL_STATUSES.has(job.status)) return publicJob(job);
    const worker = this.active.get(jobId);
    const current = worker?.job ?? job;
    current.cancelRequested = true;
    current.status = "cancelling";
    current.phase = "cancelling";
    await this.store.save(current);
    if (worker) {
      await worker.cancel();
    }
    return publicJob(current);
  }

  async status(jobId = null) {
    if (jobId) return publicJob(await this.requireJob(jobId));
    const jobs = await this.store.list();
    return jobs.slice(0, 50).map(publicJob);
  }

  async result(jobId, { full = false } = {}) {
    const job = await this.requireJob(jobId);
    const value = publicJob(job);
    value.artifacts = {
      job: this.store.jobPath(jobId),
      events: this.store.eventsPath(jobId),
      assistant: this.store.assistantPath(jobId),
      handoff: this.store.handoffPath(jobId),
    };
    if (full) value.assistantOutput = await this.store.readAssistant(jobId);
    return value;
  }

  async requireJob(jobId) {
    if (!JOB_ID_PATTERN.test(String(jobId))) throw new Error(`Invalid Kimi job id: ${jobId}`);
    const job = await this.store.get(jobId);
    if (!job) throw new Error(`Unknown Kimi job: ${jobId}`);
    return job;
  }

  async #run(job, feedback) {
    const worker = new AcpWorker({
      binary: this.binary,
      job,
      store: this.store,
      onProgress: async (phase) => {
        if (job.phase === phase) return;
        job.phase = phase;
        await this.store.save(job);
      },
    });
    this.active.set(job.id, worker);
    try {
      job.status = "running";
      job.phase = "starting-kimi";
      await this.store.save(job);
      if (job.cancelRequested) {
        job.status = "cancelled";
        job.phase = "cancelled";
        await this.store.save(job);
        return;
      }
      await worker.connect();
      if (job.cancelRequested) {
        await worker.cancel();
        job.status = "cancelled";
        job.phase = "cancelled";
        await this.store.save(job);
        return;
      }

      const session = await worker.startSession({
        resumeSessionId: feedback ? job.sessionId : null,
        model: job.model,
        thinking: job.thinking,
      });
      job.sessionId = session.sessionId;
      job.phase = "working";
      await this.store.save(job);

      const turn = await worker.prompt(buildTaskPrompt(job, feedback));
      await this.store.writeAssistant(job.id, turn.output);
      const handoff = parseHandoff(turn.output);
      await this.store.writeHandoff(job.id, handoff);

      let gitResult = null;
      if (job.kind === "write") {
        job.phase = "checkpointing";
        await this.store.save(job);
        gitResult = await finalizeWorktree({
          worktree: job.worktree,
          baseCommit: job.baseCommit,
          task: job.task,
        });
      }

      job.result = {
        stopReason: turn.stopReason,
        handoff,
        git: gitResult,
      };
      if (job.cancelRequested || turn.stopReason === "cancelled") {
        job.status = "cancelled";
        job.phase = "cancelled";
      } else if (handoff.status === "blocked") {
        job.status = "blocked";
        job.phase = "blocked";
      } else {
        job.status = "completed";
        job.phase = "completed";
      }
      await this.store.save(job);
    } catch (error) {
      job.status = job.cancelRequested ? "cancelled" : "failed";
      job.phase = job.cancelRequested ? "cancelled" : "failed";
      job.error = friendlyAcpError(error);
      await this.store.appendEvent(job.id, {
        at: nowIso(),
        type: "error",
        message: job.error,
      });
      await this.store.save(job);
    } finally {
      this.active.delete(job.id);
      await worker?.close().catch(() => {});
    }
  }
}
