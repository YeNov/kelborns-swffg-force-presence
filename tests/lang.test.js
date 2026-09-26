/**
 * The language file has to survive Foundry's loader.
 *
 * WHY THIS EXISTS. `en.json` once declared both:
 *
 *   "KFP.Panel.StartingChoice":       "Starting choice"
 *   "KFP.Panel.StartingChoice.Light": "Flip one Balance Point to Light Side"
 *
 * Foundry stores translations NESTED: `#loadTranslationFile` runs `expandObject(json)`
 * on the flat file before merging it. A key that is both a leaf and a branch cannot be
 * expanded -- `StartingChoice` would have to be a string and an object at once -- so
 * `expandObject` throws, `#loadTranslationFile` catches it, and returns `{}`.
 *
 * The whole file is discarded. Not the offending key: ALL of it. Every label in the
 * module renders as its raw key, while the file itself is valid JSON, correctly served,
 * correctly declared in the manifest, and parses perfectly everywhere you would think to
 * check. It cost a long diagnosis, because every obvious test passes.
 *
 * These tests fail loudly on the one thing that is not obvious.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const langPath = path.join(root, "lang", "en.json");
const raw = fs.readFileSync(langPath, "utf8");

/**
 * Foundry's `expandObject`, reduced to the part that can fail: it walks each dotted key
 * and assigns, which throws when an intermediate node is already a string.
 * Mirrors `setProperty`'s "Cannot create property 'X' on string 'Y'".
 */
function expandObject(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let node = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (part in node && typeof node[part] !== "object") {
        throw new TypeError(
          `Cannot create property '${parts[i + 1]}' on string '${node[part]}' (key "${key}")`,
        );
      }
      node[part] ??= {};
      node = node[part];
    }
    const leaf = parts[parts.length - 1];
    if (typeof node[leaf] === "object" && node[leaf] !== null) {
      throw new TypeError(`Key "${key}" is a branch elsewhere in the file`);
    }
    node[leaf] = value;
  }
  return out;
}

describe("lang/en.json", () => {
  test("is valid JSON with no byte-order mark", () => {
    assert.notEqual(raw.charCodeAt(0), 0xfeff, "a BOM makes Foundry's resp.json() throw");
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  test("survives Foundry's expandObject — no key is both a leaf and a branch", () => {
    const flat = JSON.parse(raw);
    // Report every collision at once; fixing them one error at a time is miserable.
    const leaves = new Set(Object.keys(flat));
    const collisions = [];
    for (const key of Object.keys(flat)) {
      const parts = key.split(".");
      for (let i = 1; i < parts.length; i += 1) {
        const prefix = parts.slice(0, i).join(".");
        if (leaves.has(prefix)) collisions.push(`"${prefix}" is a leaf, but "${key}" needs it to be an object`);
      }
    }
    assert.deepEqual(collisions, [], `\n${collisions.join("\n")}\n`);
    assert.doesNotThrow(() => expandObject(flat));
  });

  test("every key the code asks for is defined", () => {
    const flat = JSON.parse(raw);
    const sources = [];
    for (const dir of ["scripts", "templates"]) {
      const dirPath = path.join(root, dir);
      if (!fs.existsSync(dirPath)) continue;
      for (const file of fs.readdirSync(dirPath)) {
        sources.push(fs.readFileSync(path.join(dirPath, file), "utf8"));
      }
    }
    const src = sources.join("\n");

    const used = new Set(
      [...src.matchAll(/["'`](KFP\.[A-Za-z0-9._-]+)["'`]/g)]
        .map((m) => m[1])
        // `KFP.Move.${move}` is built at runtime from the MOVES values.
        .filter((key) => !key.includes("${")),
    );

    const missing = [...used].filter((key) => !(key in flat));
    assert.deepEqual(missing, [], `keys used in code but not declared: ${missing.join(", ")}`);
  });

  test("every declared key is actually used", () => {
    const flat = JSON.parse(raw);
    const sources = [];
    for (const dir of ["scripts", "templates"]) {
      const dirPath = path.join(root, dir);
      if (!fs.existsSync(dirPath)) continue;
      for (const file of fs.readdirSync(dirPath)) {
        sources.push(fs.readFileSync(path.join(dirPath, file), "utf8"));
      }
    }
    const src = sources.join("\n");

    const unused = Object.keys(flat).filter((key) => {
      if (key.startsWith("KFP.Move.")) return false; // built at runtime
      if (key.startsWith("KFP.Settings.")) return false; // read by Foundry at render
      return !src.includes(key);
    });
    assert.deepEqual(unused, [], `declared but never used: ${unused.join(", ")}`);
  });
});
