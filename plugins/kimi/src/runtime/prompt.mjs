import { shortText, uniqueStrings } from "./util.mjs";

function bullets(values, fallback) {
  const items = uniqueStrings(values);
  if (!items.length) return `- ${fallback}`;
  return items.map((item) => `- ${item}`).join("\n");
}

export function buildTaskPrompt(job, feedback = null) {
  const reviewOnly = job.kind === "review";
  const modeRules = reviewOnly
    ? [
        "This is a read-only review. Do not edit files, create files, commit, or run mutating commands.",
        "Inspect the requested target and report concrete findings ordered by severity.",
      ]
    : [
        "Implement the task in the current isolated Git worktree.",
        "Do not switch branches, create another worktree, merge, push, or publish anything.",
        "Do not commit; the supervising bridge will create a checkpoint after you finish.",
        "Keep changes inside the allowed paths when they are provided.",
      ];

  return [
    "You are a delegated Kimi Code worker. Codex is the supervising agent and will independently inspect your result.",
    "",
    "Task:",
    job.task,
    feedback ? `\nSupervisor feedback for this continuation:\n${feedback}` : "",
    "",
    `Working directory: ${job.worktree ?? job.cwd}`,
    `Base commit: ${job.baseCommit ?? "not provided"}`,
    "",
    "Acceptance criteria:",
    bullets(job.acceptanceCriteria, "Complete the task conservatively and preserve existing behavior."),
    "",
    "Allowed paths:",
    bullets(job.allowedPaths, "No explicit path allowlist; make the smallest necessary change."),
    "",
    "Suggested verification:",
    bullets(job.testCommands, "Run the smallest relevant checks you can discover."),
    "",
    "Operating rules:",
    ...modeRules.map((rule) => `- ${rule}`),
    "- Do not ask interactive questions. If information is missing, make a conservative assumption and record it.",
    "- Keep exploration and progress in your own session; the supervisor only needs the final handoff.",
    "",
    "Finish with exactly one JSON object and no Markdown fence, using this shape:",
    JSON.stringify(
      {
        status: "completed | blocked",
        summary: "short result summary",
        changed_files: ["relative/path"],
        decisions: ["important implementation decision"],
        tests: [{ command: "command", status: "passed | failed | not_run", detail: "short detail" }],
        known_risks: ["remaining risk"],
        open_questions: ["unresolved question"],
      },
      null,
      2,
    ),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function candidates(text) {
  const trimmed = String(text ?? "").trim();
  const values = [trimmed];
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const fence of fences.reverse()) values.push(fence[1].trim());
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) values.push(trimmed.slice(first, last + 1));
  return uniqueStrings(values);
}

export function parseHandoff(text) {
  for (const value of candidates(text)) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          status: parsed.status === "blocked" ? "blocked" : "completed",
          summary: shortText(parsed.summary ?? "Kimi completed the delegated turn.", 2000),
          changed_files: uniqueStrings(parsed.changed_files),
          decisions: uniqueStrings(parsed.decisions),
          tests: Array.isArray(parsed.tests) ? parsed.tests.slice(0, 50) : [],
          known_risks: uniqueStrings(parsed.known_risks),
          open_questions: uniqueStrings(parsed.open_questions),
        };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return {
    status: "completed",
    summary: shortText(text || "Kimi returned no final text.", 2000),
    changed_files: [],
    decisions: [],
    tests: [],
    known_risks: ["Kimi did not return the requested structured handoff."],
    open_questions: [],
  };
}
