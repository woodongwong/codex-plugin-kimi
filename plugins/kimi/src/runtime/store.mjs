import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { nowIso } from "./util.mjs";

export class JobStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.jobsDir = path.join(this.root, "jobs");
    this.writeQueues = new Map();
  }

  async initialize() {
    await fs.mkdir(this.jobsDir, { recursive: true });
  }

  jobDir(jobId) {
    return path.join(this.jobsDir, jobId);
  }

  jobPath(jobId) {
    return path.join(this.jobDir(jobId), "job.json");
  }

  eventsPath(jobId) {
    return path.join(this.jobDir(jobId), "events.jsonl");
  }

  assistantPath(jobId) {
    return path.join(this.jobDir(jobId), "assistant.txt");
  }

  handoffPath(jobId) {
    return path.join(this.jobDir(jobId), "handoff.json");
  }

  async create(job) {
    await fs.mkdir(this.jobDir(job.id), { recursive: true });
    await this.save(job);
    return job;
  }

  async save(job) {
    return this.#enqueue(job.id, async () => {
      await fs.mkdir(this.jobDir(job.id), { recursive: true });
      const next = { ...job, updatedAt: nowIso() };
      const target = this.jobPath(job.id);
      const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await fs.rename(temporary, target);
      Object.assign(job, next);
      return job;
    });
  }

  async get(jobId) {
    try {
      return JSON.parse(await fs.readFile(this.jobPath(jobId), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async list() {
    await this.initialize();
    const entries = await fs.readdir(this.jobsDir, { withFileTypes: true });
    const jobs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const job = await this.get(entry.name);
      if (job) jobs.push(job);
    }
    return jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async appendEvent(jobId, value) {
    return this.#enqueue(jobId, async () => {
      await fs.mkdir(this.jobDir(jobId), { recursive: true });
      await fs.appendFile(this.eventsPath(jobId), `${JSON.stringify(value)}\n`, "utf8");
    });
  }

  async writeAssistant(jobId, text) {
    await fs.writeFile(this.assistantPath(jobId), String(text ?? ""), "utf8");
  }

  async writeHandoff(jobId, handoff) {
    await fs.writeFile(this.handoffPath(jobId), `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
  }

  async readAssistant(jobId, limit = 50_000) {
    try {
      const text = await fs.readFile(this.assistantPath(jobId), "utf8");
      if (text.length <= limit) return text;
      return `${text.slice(0, limit)}\n...[truncated]`;
    } catch (error) {
      if (error?.code === "ENOENT") return "";
      throw error;
    }
  }

  async #enqueue(jobId, operation) {
    const previous = this.writeQueues.get(jobId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.writeQueues.set(jobId, current);
    try {
      return await current;
    } finally {
      if (this.writeQueues.get(jobId) === current) this.writeQueues.delete(jobId);
    }
  }
}
