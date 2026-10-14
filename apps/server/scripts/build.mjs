import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

// Workspace packages ship TypeScript source, so they are bundled; real npm dependencies stay external
// (they are installed from the lockfile in the deployment image).
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@lujshqip/"));

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
  logLevel: "info",
});
process.exit(0);
