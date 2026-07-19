#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "@agentclientprotocol/sdk";

if (process.argv[2] === "--version") {
  console.log("fake-kimi 0.1.0");
  process.exit(0);
}

if (process.argv[2] !== "acp") {
  console.error("usage: fake-kimi.mjs acp");
  process.exit(2);
}

class FakeKimiAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        sessionCapabilities: { resume: {} },
      },
      authMethods: [],
    };
  }

  async authenticate() {
    return {};
  }

  async newSession(params) {
    const sessionId = `fake-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.sessions.set(sessionId, { cwd: params.cwd, mode: "code", pending: null });
    return { sessionId, configOptions: [] };
  }

  async resumeSession(params) {
    this.sessions.set(params.sessionId, { cwd: params.cwd, mode: "code", pending: null });
    return { configOptions: [] };
  }

  async setSessionConfigOption(params) {
    const session = this.sessions.get(params.sessionId);
    if (session && params.configId === "mode") session.mode = params.value;
    return { configOptions: [] };
  }

  async prompt(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    const prompt = params.prompt
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const controller = new AbortController();
    session.pending = controller;

    if (prompt.includes("[slow]")) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 20_000);
        controller.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      session.pending = null;
      return { stopReason: controller.signal.aborted ? "cancelled" : "end_turn" };
    }

    const reviewOnly = session.mode === "plan" || prompt.includes("This is a read-only review");
    if (!reviewOnly) {
      await fs.writeFile(
        path.join(session.cwd, "worker.txt"),
        `fake Kimi completed attempt at ${new Date().toISOString()}\n`,
        "utf8",
      );
    }

    const handoff = {
      status: "completed",
      summary: reviewOnly ? "Fake review completed." : "Fake implementation completed.",
      changed_files: reviewOnly ? [] : ["worker.txt"],
      decisions: ["Used the fake ACP worker."],
      tests: [{ command: "fake-check", status: "passed", detail: "fixture" }],
      known_risks: [],
      open_questions: [],
    };
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: JSON.stringify(handoff) },
      },
    });
    session.pending = null;
    return { stopReason: "end_turn" };
  }

  async cancel(params) {
    this.sessions.get(params.sessionId)?.pending?.abort();
  }
}

const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
const stream = ndJsonStream(output, input);
new AgentSideConnection((connection) => new FakeKimiAgent(connection), stream);
