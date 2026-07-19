import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

import {
  ClientSideConnection,
  ndJsonStream,
} from "@agentclientprotocol/sdk";

import { errorMessage, nowIso } from "./util.mjs";

const MAX_CAPTURE_CHARS = 300_000;

class BridgeClient {
  constructor({ job, store, onProgress }) {
    this.job = job;
    this.store = store;
    this.onProgress = onProgress;
    this.output = "";
  }

  async sessionUpdate(notification) {
    await this.store.appendEvent(this.job.id, {
      at: nowIso(),
      type: "session/update",
      payload: notification,
    });

    const update = notification?.update;
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
      this.output += update.content.text ?? "";
      if (this.output.length > MAX_CAPTURE_CHARS) {
        this.output = this.output.slice(-MAX_CAPTURE_CHARS);
      }
      this.#reportProgress("responding");
    } else if (String(update?.sessionUpdate ?? "").startsWith("tool_call")) {
      this.#reportProgress("working");
    }
  }

  #reportProgress(phase) {
    void Promise.resolve(this.onProgress?.(phase)).catch(() => {});
  }

  async requestPermission(request) {
    await this.store.appendEvent(this.job.id, {
      at: nowIso(),
      type: "permission/request",
      payload: request,
    });

    const options = Array.isArray(request?.options) ? request.options : [];
    const isQuestion = options.some((option) => String(option.optionId).startsWith("q"));
    let selected;
    if (isQuestion || this.job.permissionMode === "review") {
      selected = options.find((option) => String(option.kind).startsWith("reject"));
    } else {
      selected = options.find((option) => String(option.kind).startsWith("allow"));
    }

    if (!selected) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: selected.optionId } };
  }

  async readTextFile() {
    throw new Error("ACP filesystem reverse-RPC was not advertised by kimi-companion.");
  }

  async writeTextFile() {
    throw new Error("ACP filesystem reverse-RPC was not advertised by kimi-companion.");
  }
}

export class AcpWorker {
  constructor({ binary, job, store, onProgress }) {
    this.binary = binary;
    this.job = job;
    this.store = store;
    this.onProgress = onProgress;
    this.child = null;
    this.connection = null;
    this.client = null;
    this.sessionId = null;
    this.stderr = "";
  }

  async connect() {
    this.child = spawn(this.binary, ["acp"], {
      cwd: this.job.worktree ?? this.job.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
      if (this.stderr.length > 200_000) this.stderr = this.stderr.slice(-200_000);
      void this.store.appendEvent(this.job.id, {
        at: nowIso(),
        type: "stderr",
        text: String(chunk),
      });
    });

    const spawned = new Promise((resolve, reject) => {
      this.child.once("spawn", resolve);
      this.child.once("error", reject);
    });
    await spawned;

    const stream = ndJsonStream(
      Writable.toWeb(this.child.stdin),
      Readable.toWeb(this.child.stdout),
    );
    this.client = new BridgeClient({ job: this.job, store: this.store, onProgress: this.onProgress });
    this.connection = new ClientSideConnection(() => this.client, stream);
    await this.connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
      },
    });
  }

  async startSession({ resumeSessionId = null, model = null, thinking = null }) {
    const params = {
      cwd: this.job.worktree ?? this.job.cwd,
      mcpServers: [],
    };
    const response = resumeSessionId
      ? await this.connection.resumeSession({ ...params, sessionId: resumeSessionId })
      : await this.connection.newSession(params);
    this.sessionId = resumeSessionId ?? response.sessionId;

    if (model) {
      await this.connection.setSessionConfigOption({
        sessionId: this.sessionId,
        configId: "model",
        value: model,
      });
    }
    if (thinking === "on" || thinking === "off") {
      await this.connection.setSessionConfigOption({
        sessionId: this.sessionId,
        configId: "thinking",
        value: thinking,
      });
    }
    if (this.job.kind === "review") {
      await this.connection.setSessionConfigOption({
        sessionId: this.sessionId,
        configId: "mode",
        value: "plan",
      });
    }
    return { ...response, sessionId: this.sessionId };
  }

  async prompt(text) {
    const response = await this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      stopReason: response.stopReason,
      output: this.client.output,
      stderr: this.stderr,
    };
  }

  async cancel() {
    if (this.connection && this.sessionId) {
      await this.connection.cancel({ sessionId: this.sessionId }).catch(() => {});
    }
    await this.close();
  }

  async close() {
    if (!this.child) return;
    const child = this.child;
    if (child.exitCode !== null || child.killed) return;
    child.stdin.end();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    if (!graceful && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

export function friendlyAcpError(error) {
  const message = errorMessage(error);
  if (error?.code === -32000 || /auth|required|login/i.test(message)) {
    return `Kimi Code is not authenticated. Run \`kimi login\` in a terminal, then retry. (${message})`;
  }
  return message;
}
