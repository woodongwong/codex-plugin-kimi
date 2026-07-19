#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { KimiJobManager } from "./runtime/manager.mjs";

function result(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function failure(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
  };
}

export async function createKimiMcpServer(options = {}) {
  const manager = options.manager ?? new KimiJobManager();
  await manager.initialize();
  const server = new McpServer({ name: "kimi-companion", version: "0.1.0" });

  server.registerTool(
    "kimi_setup",
    {
      title: "Check Kimi Code setup",
      description: "Check whether the local Kimi Code CLI is installed and show the bridge data directory.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try { return result(await manager.setup()); } catch (error) { return failure(error); }
    },
  );

  server.registerTool(
    "kimi_delegate",
    {
      title: "Delegate an implementation task to Kimi",
      description: "Start a background Kimi Code implementation in an isolated Git worktree. Returns immediately with a job id.",
      inputSchema: {
        cwd: z.string().min(1).describe("Absolute path inside the target Git repository."),
        task: z.string().min(1).describe("Self-contained implementation task."),
        acceptanceCriteria: z.array(z.string()).optional(),
        allowedPaths: z.array(z.string()).optional(),
        testCommands: z.array(z.string()).optional(),
        baseRef: z.string().optional().describe("Git ref to branch from; defaults to HEAD."),
        model: z.string().optional(),
        thinking: z.enum(["on", "off"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try { return result(await manager.delegate(input)); } catch (error) { return failure(error); }
    },
  );

  server.registerTool(
    "kimi_review",
    {
      title: "Ask Kimi for a read-only review",
      description: "Start a background Kimi review in the supplied working directory. Kimi is put in plan mode and mutation approvals are rejected.",
      inputSchema: {
        cwd: z.string().min(1),
        task: z.string().min(1),
        acceptanceCriteria: z.array(z.string()).optional(),
        testCommands: z.array(z.string()).optional(),
        model: z.string().optional(),
        thinking: z.enum(["on", "off"]).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try { return result(await manager.review(input)); } catch (error) { return failure(error); }
    },
  );

  server.registerTool(
    "kimi_continue",
    {
      title: "Continue a Kimi job",
      description: "Resume the Kimi ACP session for a finished job and send Codex review feedback.",
      inputSchema: {
        jobId: z.string().min(1),
        feedback: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ jobId, feedback }) => {
      try { return result(await manager.continue(jobId, feedback)); } catch (error) { return failure(error); }
    },
  );

  server.registerTool(
    "kimi_status",
    {
      title: "Check Kimi jobs",
      description: "Return one job or up to 50 recent Kimi background jobs without returning their full transcripts.",
      inputSchema: { jobId: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ jobId }) => {
      try { return result(await manager.status(jobId ?? null)); } catch (error) { return failure(error); }
    },
  );

  server.registerTool(
    "kimi_result",
    {
      title: "Get a Kimi job result",
      description: "Return the compact handoff, Git checkpoint and artifact paths. Set full=true only when the raw final Kimi output is necessary.",
      inputSchema: {
        jobId: z.string().min(1),
        full: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ jobId, full }) => {
      try { return result(await manager.result(jobId, { full })); } catch (error) { return failure(error); }
    },
  );

  server.registerTool(
    "kimi_cancel",
    {
      title: "Cancel a Kimi job",
      description: "Cancel the active ACP turn for a Kimi background job.",
      inputSchema: { jobId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ jobId }) => {
      try { return result(await manager.cancel(jobId)); } catch (error) { return failure(error); }
    },
  );

  return { server, manager };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server } = await createKimiMcpServer();
  await server.connect(new StdioServerTransport());
}
