import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const pluginRoot = path.join(root, "plugins", "kimi");

async function readJson(relativePath) {
  const filename = path.join(root, relativePath);
  return JSON.parse(await fs.readFile(filename, "utf8"));
}

async function requirePath(relativePath) {
  await fs.access(path.join(root, relativePath));
}

const manifest = await readJson("plugins/kimi/.codex-plugin/plugin.json");
const marketplace = await readJson(".agents/plugins/marketplace.json");
const mcp = await readJson("plugins/kimi/.mcp.json");

if (manifest.name !== "kimi") throw new Error("Plugin manifest name must be `kimi`.");
if (!manifest.version) throw new Error("Plugin manifest requires a version.");
if (!manifest.skills || !manifest.mcpServers) {
  throw new Error("Plugin manifest must declare skills and mcpServers.");
}
if (!marketplace.plugins?.some((plugin) => plugin.name === manifest.name)) {
  throw new Error("Marketplace does not expose the kimi plugin.");
}

for (const relativePath of [
  "plugins/kimi/.codex-plugin/plugin.json",
  "plugins/kimi/.mcp.json",
  "plugins/kimi/dist/server.mjs",
  "plugins/kimi/skills/kimi-companion/SKILL.md",
]) {
  await requirePath(relativePath);
}

const server = mcp.mcpServers?.["kimi-companion"];
if (server?.command !== "node" || !server.args?.includes("./dist/server.mjs")) {
  throw new Error("MCP server must launch the bundled dist/server.mjs entry point.");
}

const commandFiles = await fs.readdir(path.join(pluginRoot, "commands"));
if (!commandFiles.includes("delegate.md") || !commandFiles.includes("result.md")) {
  throw new Error("Required Kimi commands are missing.");
}

console.log(`Validated ${manifest.name}@${manifest.version}.`);
