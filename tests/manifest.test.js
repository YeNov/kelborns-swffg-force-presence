/**
 * The manifest has to agree with the code.
 *
 * WHY THIS EXISTS. The module used socketlib throughout `scripts/transport.js` while
 * `module.json` never declared `"socket": true`. Foundry therefore opened no socket for
 * it, `socketlib.registerModule()` returned undefined, and the end-of-session sweep
 * silently fell back to "every row is the GM's" -- reported only as a console line at
 * the moment a sweep was started.
 *
 * Nothing in the code could have revealed this: the JavaScript was correct and the
 * manifest was valid JSON. Only the RELATIONSHIP between them was wrong, which is what
 * these tests check.
 *
 * Note that a manifest change needs a world reload, not just a browser reload --
 * Foundry parses package manifests server-side when it scans packages.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));

const readAllScripts = () =>
  fs
    .readdirSync(path.join(root, "scripts"))
    .map((f) => fs.readFileSync(path.join(root, "scripts", f), "utf8"))
    .join("\n");

describe("module.json", () => {
  test("declares the fields Foundry needs", () => {
    assert.equal(manifest.id, "kelborns-swffg-force-presence");
    assert.ok(manifest.title, "a title");
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "a semver version");
    assert.ok(manifest.compatibility?.minimum, "a minimum Foundry version");
  });

  test("every file it points at exists", () => {
    const declared = [
      ...(manifest.esmodules ?? []),
      ...(manifest.styles ?? []),
      ...(manifest.languages ?? []).map((l) => l.path),
    ];
    assert.ok(declared.length > 0, "the manifest declares no files at all");
    const missing = declared.filter((rel) => !fs.existsSync(path.join(root, rel)));
    assert.deepEqual(missing, [], `declared but absent: ${missing.join(", ")}`);
  });

  test('declares "socket": true, because the code uses sockets', () => {
    const usesSockets = /\bsocketlib\b|game\.socket/.test(readAllScripts());
    if (!usesSockets) return; // nothing to require
    assert.equal(
      manifest.socket,
      true,
      'the code uses sockets, so the manifest must declare "socket": true — without it ' +
        "Foundry opens no socket and socketlib.registerModule() returns undefined",
    );
  });

  test("declares socketlib as a required relationship, because the code imports it", () => {
    const usesSocketlib = /\bsocketlib\b/.test(readAllScripts());
    if (!usesSocketlib) return;
    const required = (manifest.relationships?.requires ?? []).map((r) => r.id);
    assert.ok(
      required.includes("socketlib"),
      `the code uses socketlib but requires = [${required.join(", ")}]`,
    );
  });

  test("pins the system it depends on", () => {
    const systems = (manifest.relationships?.systems ?? []).map((s) => s.id);
    assert.ok(systems.includes("starwarsffg"), "should declare the starwarsffg system");
  });

  test("templates referenced by scripts exist", () => {
    const scripts = readAllScripts();
    const referenced = [...scripts.matchAll(/modules\/\$\{MODULE_ID\}\/(templates\/[\w./-]+)/g)].map(
      (m) => m[1],
    );
    const missing = referenced.filter((rel) => !fs.existsSync(path.join(root, rel)));
    assert.deepEqual(missing, [], `templates referenced but absent: ${missing.join(", ")}`);
  });
});
