import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskPrompt, parseHandoff } from "../plugins/kimi/src/runtime/prompt.mjs";

test("buildTaskPrompt carries only the task contract and handoff schema", () => {
  const prompt = buildTaskPrompt({
    kind: "write",
    task: "Add a cache",
    worktree: "/tmp/worktree",
    baseCommit: "abc123",
    acceptanceCriteria: ["Tests pass"],
    allowedPaths: ["src/cache.js"],
    testCommands: ["npm test"],
  });

  assert.match(prompt, /Add a cache/);
  assert.match(prompt, /src\/cache\.js/);
  assert.match(prompt, /npm test/);
  assert.match(prompt, /changed_files/);
  assert.doesNotMatch(prompt, /full transcript/i);
});

test("parseHandoff extracts the final structured result", () => {
  const result = parseHandoff(`progress\n\n\`\`\`json
{"status":"blocked","summary":"Need API key","changed_files":[],"decisions":[],"tests":[],"known_risks":["auth"],"open_questions":["Which key?"]}
\`\`\``);

  assert.equal(result.status, "blocked");
  assert.equal(result.summary, "Need API key");
  assert.deepEqual(result.known_risks, ["auth"]);
});

test("parseHandoff returns a compact fallback for unstructured output", () => {
  const result = parseHandoff("implemented the requested change");
  assert.equal(result.status, "completed");
  assert.match(result.known_risks[0], /structured handoff/);
});
