import { execFile as execFileCallback } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";

export const execFile = promisify(execFileCallback);

export function nowIso() {
  return new Date().toISOString();
}

export function newJobId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `kimi-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;
}

export function shortText(value, limit = 100) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

export function uniqueStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function executableVersion(command) {
  try {
    const { stdout, stderr } = await execFile(command, ["--version"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    const detail = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
    return { available: true, detail: detail || `${command} is available` };
  } catch (error) {
    return { available: false, detail: errorMessage(error) };
  }
}
