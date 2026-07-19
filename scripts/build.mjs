import { build } from "esbuild";
import fs from "node:fs/promises";

const outfile = "plugins/kimi/dist/server.mjs";

await build({
  entryPoints: ["plugins/kimi/src/server.mjs"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "external",
  sourcemap: false,
});

const bundled = await fs.readFile(outfile, "utf8");
await fs.writeFile(outfile, bundled.replace(/[ \t]+$/gm, ""), "utf8");
