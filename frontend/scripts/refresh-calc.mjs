// Refreshes @smogon/calc to the latest damage-calc `master`.
//
// The npm release (@smogon/calc) lags `master`: it's the same monorepo build,
// just published less often, so new ability mechanics (e.g. Fire Mane's ×1.5 on
// Fire moves) and dex data (new megas) land on master long before npm. Those
// mechanics live in COMPILED code, not in our runtime dex refresh — so the only
// way to pick them up is to rebuild the calc from source.
//
// This script clones master, compiles the `calc` subpackage, overlays the fresh
// `dist/` onto node_modules/@smogon/calc, then captures the whole delta vs the
// pinned npm 0.11.0 as a single patch-package patch. The committed patch reapplies
// on every install (via the `postinstall` script), so deploys need no build step.
//
// Run periodically (e.g. alongside the backend dex refresh) or whenever the calc
// looks stale:
//   cd frontend && npm run refresh-calc
//
import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND    = path.resolve(__dirname, "..");
const TARGET_DIST = path.join(FRONTEND, "node_modules", "@smogon", "calc", "dist");
const REPO        = "https://github.com/smogon/damage-calc";

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}${cwd ? `   (in ${cwd})` : ""}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

if (!fs.existsSync(TARGET_DIST)) {
  console.error(`[refresh-calc] ${TARGET_DIST} not found — run \`npm install\` first.`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smogon-calc-"));
try {
  run(`git clone --depth 1 ${REPO} "${tmp}"`);
  const calcDir = path.join(tmp, "calc");

  // --ignore-scripts skips the package's own `prepare` (compile + bundle); we only
  // need `compile` (tsc), which is enough for the `main` entry (dist/index.js).
  run("npm install --ignore-scripts", calcDir);
  run("npm run compile", calcDir);

  const builtDist = path.join(calcDir, "dist");
  if (!fs.existsSync(path.join(builtDist, "index.js")))
    throw new Error("compile produced no dist/index.js");

  // Overlay the fresh build (keeps npm-only files like production.min.js intact).
  console.log(`\n[refresh-calc] Overlaying built dist → ${TARGET_DIST}`);
  fs.cpSync(builtDist, TARGET_DIST, { recursive: true, force: true });

  // Regenerate patches/@smogon+calc+0.11.0.patch from the delta vs clean npm.
  // Exclude source maps and type defs — neither affects the runtime bundle, and
  // maps would bloat the patch with megabytes of base64. Run via execFileSync (no
  // shell) so the regex isn't mangled by cmd.exe quoting on Windows.
  const patchBin = path.join(FRONTEND, "node_modules", "patch-package", "index.js");
  const excludeRe = "(\\.map$|\\.d\\.ts$|[\\\\/]test[\\\\/])"; // maps, type defs, test dir (either separator)
  console.log(`\n$ node patch-package @smogon/calc --exclude ${excludeRe}`);
  execFileSync(process.execPath, [patchBin, "@smogon/calc", "--exclude", excludeRe],
    { cwd: FRONTEND, stdio: "inherit" });

  console.log("\n[refresh-calc] Done. Review the patch, then restart Vite with --force " +
              "(or delete node_modules/.vite) to clear the pre-bundle cache.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
