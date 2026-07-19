import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createKimiMcpServer } from "../plugins/kimi/src/server.mjs";
import { KimiJobManager } from "../plugins/kimi/src/runtime/manager.mjs";

test("MCP server advertises the Kimi tools and serves structured setup results", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-companion-mcp-"));
  const manager = new KimiJobManager({
    binary: path.resolve("tests/fixtures/fake-kimi.mjs"),
    dataDir,
  });
  const { server } = await createKimiMcpServer({ manager });
  const client = new Client({ name: "kimi-companion-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  t.after(async () => {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "kimi_cancel",
      "kimi_continue",
      "kimi_delegate",
      "kimi_result",
      "kimi_review",
      "kimi_setup",
      "kimi_status",
    ],
  );

  const setup = await client.callTool({ name: "kimi_setup", arguments: {} });
  assert.equal(setup.isError, undefined);
  assert.equal(setup.structuredContent.ready, true);
  assert.match(setup.structuredContent.kimi.detail, /fake-kimi/);
});
