/**
 * Every script must parse as an ES module.
 *
 * WHY THIS EXISTS. `node --check scripts/foo.js` is NOT a sufficient syntax gate for
 * this project, and quietly was not for most of its history. A `.js` file is checked in
 * a mode that accepted `scripts/gm-window.js` while it was missing the closing brace of
 * a top-level function: `node --check` exited 0, the module was broken, and Foundry
 * reported `Uncaught SyntaxError: Unexpected end of input` on load. Every feature in the
 * module silently stopped working, which looked like a regression in whatever had been
 * touched last rather than a parse failure.
 *
 * The same file copied to `.mjs` and checked fails correctly, so the extension -- not
 * the content -- decides the parse goal. These tests check every script the way Foundry
 * will actually load it.
 *
 * Importing the modules instead is not an option: they reference Foundry globals at
 * load time, so a successful parse would still throw. Parse only.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(root, "scripts");
const scripts = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".js"));

describe("scripts parse as ES modules", () => {
  test("there are scripts to check", () => {
    assert.ok(scripts.length > 0, "no scripts found — the test would pass vacuously");
  });

  for (const file of scripts) {
    test(file, () => {
      const tmp = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "kfp-syntax-")),
        `${path.basename(file, ".js")}.mjs`,
      );
      try {
        fs.copyFileSync(path.join(scriptsDir, file), tmp);
        // Throws with the parse error as stderr when the module does not parse.
        execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
      } catch (err) {
        const detail = (err.stderr?.toString() || err.message).split("\n").slice(0, 6).join("\n");
        assert.fail(`${file} does not parse as an ES module:\n${detail}`);
      } finally {
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      }
    });
  }
});

describe("braces balance", () => {
  // A cheap, independent second opinion. It cannot prove a file is valid, but an
  // imbalance is always a bug and points straight at the file -- which is more useful
  // than a parse error reporting the last line of the file.
  for (const file of scripts) {
    test(file, () => {
      const source = fs.readFileSync(path.join(scriptsDir, file), "utf8");
      let depth = 0;
      for (const ch of source) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
      assert.equal(depth, 0, `${file} has ${depth > 0 ? depth + " unclosed" : -depth + " extra"} brace(s)`);
    });
  }
});
