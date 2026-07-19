import fs from "node:fs/promises";
import path from "node:path";

import { execFile, shortText, uniqueStrings } from "./util.mjs";

async function git(cwd, args, options = {}) {
  const { stdout, stderr } = await execFile("git", ["-C", cwd, ...args], {
    timeout: options.timeout ?? 60_000,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  return { stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? "").trim() };
}

export async function repositoryInfo(cwd) {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).stdout;
  const head = (await git(root, ["rev-parse", "HEAD"])).stdout;
  return { root, head };
}

export async function prepareWorktree({ cwd, baseRef = "HEAD", dataDir, jobId }) {
  const { root } = await repositoryInfo(cwd);
  const baseCommit = (await git(root, ["rev-parse", "--verify", `${baseRef}^{commit}`])).stdout;
  const branch = `kimi/${jobId}`;
  const worktree = path.join(path.resolve(dataDir), "worktrees", jobId);
  await fs.mkdir(path.dirname(worktree), { recursive: true });
  await git(root, ["worktree", "add", "-b", branch, worktree, baseCommit], { timeout: 120_000 });
  return { repoRoot: root, baseCommit, branch, worktree };
}

function statusPaths(statusText) {
  return uniqueStrings(
    statusText
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const value = line.slice(3).trim();
        const arrow = value.lastIndexOf(" -> ");
        return arrow >= 0 ? value.slice(arrow + 4) : value;
      }),
  );
}

export async function finalizeWorktree({ worktree, baseCommit, task }) {
  const warnings = [];
  let status = (await git(worktree, ["status", "--porcelain=v1"])).stdout;
  if (status) {
    await git(worktree, ["add", "-A"]);
    try {
      await git(worktree, ["commit", "-m", `kimi: ${shortText(task, 68)}`], { timeout: 120_000 });
    } catch (error) {
      warnings.push(
        `Changes were left in the isolated worktree because git commit failed: ${error.message}`,
      );
    }
  }

  const resultCommit = (await git(worktree, ["rev-parse", "HEAD"])).stdout;
  status = (await git(worktree, ["status", "--porcelain=v1"])).stdout;
  const committed = resultCommit !== baseCommit;
  const committedFiles = committed
    ? (await git(worktree, ["diff", "--name-only", `${baseCommit}..${resultCommit}`])).stdout.split(/\r?\n/)
    : [];
  const changedFiles = uniqueStrings([...committedFiles, ...statusPaths(status)]);
  const committedStat = committed
    ? (await git(worktree, ["diff", "--stat", `${baseCommit}..${resultCommit}`])).stdout
    : "";
  let uncommittedStat = "";
  if (status) {
    const staged = (await git(worktree, ["diff", "--stat", "--cached", "HEAD"])).stdout;
    const unstaged = (await git(worktree, ["diff", "--stat", "HEAD"])).stdout;
    uncommittedStat = [staged, unstaged].filter(Boolean).join("\n");
  }

  return {
    resultCommit,
    committed,
    dirty: Boolean(status),
    changedFiles,
    diffStat: [committedStat, uncommittedStat].filter(Boolean).join("\n"),
    warnings,
  };
}
