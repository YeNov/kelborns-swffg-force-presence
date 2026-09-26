/**
 * Force Presence rules — pure core tests.
 *
 * Run: node --test
 * No dependencies: node:test and node:assert ship with Node 18+.
 *
 * Assertions 1-7 of the plan (docs/superpowers/plans/2026-09-26-force-presence.md).
 * The three printed-example characters are the load-bearing ones: the source's rule text
 * and its worked example CONTRADICT each other, and these tests pin the reading we chose.
 * Read the plan's "Courtney contradiction" section before changing any of them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MOVES, TOTAL_POINTS, THRESHOLDS } from "../scripts/constants.js";
import {
  normalize,
  resolveSession,
  applyFlip,
  thresholds,
  alignmentClass,
  seedFromMorality,
  classifyForConversion,
  renderScale,
} from "../scripts/rules.js";

/* ------------------------------------------------------------------ *
 * 1. The printed example (source pp. 2) — start, tallies, end
 * ------------------------------------------------------------------ */

describe("the printed end-of-session example", () => {
  test("Alice: more Tranquility, chooses Neutral to Light", () => {
    const start = { dark: 1, light: 4 }; // 1 Dark / 5 Neutral / 4 Light
    const outcome = resolveSession({ ...start, conflict: 3, tranquility: 5 });

    assert.equal(outcome.direction, "light");
    assert.equal(outcome.forced, false, "she holds both a Dark and a Neutral point");
    assert.deepEqual(outcome.options, [MOVES.NEUTRAL_TO_LIGHT, MOVES.DARK_TO_NEUTRAL]);

    // She chose the latter of the two the book lists, i.e. Neutral -> Light.
    assert.deepEqual(applyFlip(start, MOVES.NEUTRAL_TO_LIGHT), { dark: 1, light: 5 });
  });

  test("Courtney: more Conflict with no Neutral points, a Light point goes STRAIGHT to Dark", () => {
    const start = { dark: 0, light: 10 }; // ten Light
    const outcome = resolveSession({ ...start, conflict: 7, tranquility: 2 });

    assert.equal(outcome.direction, "dark");
    assert.equal(outcome.forced, true, "no Neutral points remain, so the move is forced");
    assert.deepEqual(outcome.options, [MOVES.LIGHT_TO_DARK]);

    // THE CONTRADICTION. The example's prose says "Light Side to Neutral", which would
    // give {dark: 0, light: 9} with one Neutral. The printed scale shows a FILLED dark
    // point, matching the rule text's "Light to Dark". We follow the rule text.
    assert.deepEqual(applyFlip(start, MOVES.LIGHT_TO_DARK), { dark: 1, light: 9 });
  });

  test("David: equal Conflict and Tranquility, nothing moves", () => {
    const start = { dark: 4, light: 2 }; // 4 Dark / 4 Neutral / 2 Light
    const outcome = resolveSession({ ...start, conflict: 3, tranquility: 3 });

    assert.equal(outcome.direction, "none");
    assert.deepEqual(outcome.options, []);
    assert.equal(outcome.forced, false);
  });
});

/* ------------------------------------------------------------------ *
 * resolveSession, beyond the example
 * ------------------------------------------------------------------ */

describe("resolveSession", () => {
  test("Conflict direction prefers Neutral, because it dominates", () => {
    // Both moves add one Dark point; only neutral-to-dark preserves a Light point.
    // So the preferred option is always listed first and there is no reason to pick the other.
    const outcome = resolveSession({ dark: 1, light: 4, conflict: 5, tranquility: 1 });
    assert.deepEqual(outcome.options, [MOVES.NEUTRAL_TO_DARK, MOVES.LIGHT_TO_DARK]);
    assert.equal(outcome.options[0], MOVES.NEUTRAL_TO_DARK);
  });

  test("Conflict direction at ten Dark has no move available", () => {
    const outcome = resolveSession({ dark: 10, light: 0, conflict: 9, tranquility: 0 });
    assert.equal(outcome.direction, "dark");
    assert.deepEqual(outcome.options, []);
    assert.equal(outcome.forced, false, "nothing to force; the caller reports 'consumed'");
  });

  test("Tranquility direction at ten Light has no move available", () => {
    const outcome = resolveSession({ dark: 0, light: 10, conflict: 0, tranquility: 9 });
    assert.equal(outcome.direction, "light");
    assert.deepEqual(outcome.options, []);
  });

  test("Tranquility direction with only Dark points can only redeem one step", () => {
    const outcome = resolveSession({ dark: 10, light: 0, conflict: 1, tranquility: 4 });
    assert.deepEqual(outcome.options, [MOVES.DARK_TO_NEUTRAL]);
    assert.equal(outcome.forced, true);
  });
});

/* ------------------------------------------------------------------ *
 * applyFlip legality and invariants (assertion 7)
 * ------------------------------------------------------------------ */

describe("applyFlip", () => {
  test("each move shifts exactly one point by its own definition", () => {
    assert.deepEqual(applyFlip({ dark: 2, light: 2 }, MOVES.NEUTRAL_TO_DARK), { dark: 3, light: 2 });
    assert.deepEqual(applyFlip({ dark: 2, light: 2 }, MOVES.LIGHT_TO_DARK), { dark: 3, light: 1 });
    assert.deepEqual(applyFlip({ dark: 2, light: 2 }, MOVES.DARK_TO_NEUTRAL), { dark: 1, light: 2 });
    assert.deepEqual(applyFlip({ dark: 2, light: 2 }, MOVES.NEUTRAL_TO_LIGHT), { dark: 2, light: 3 });
  });

  test("an illegal move throws rather than silently clamping", () => {
    assert.throws(() => applyFlip({ dark: 0, light: 0 }, MOVES.DARK_TO_NEUTRAL), RangeError);
    assert.throws(() => applyFlip({ dark: 0, light: 0 }, MOVES.LIGHT_TO_DARK), RangeError);
    // No Neutral points left: 4 Dark + 6 Light = 10.
    assert.throws(() => applyFlip({ dark: 4, light: 6 }, MOVES.NEUTRAL_TO_DARK), RangeError);
    assert.throws(() => applyFlip({ dark: 4, light: 6 }, MOVES.NEUTRAL_TO_LIGHT), RangeError);
    assert.throws(() => applyFlip({ dark: 1, light: 1 }, "sideways"), RangeError);
  });

  test("invariants hold across every legal move from every reachable state", () => {
    for (let dark = 0; dark <= TOTAL_POINTS; dark += 1) {
      for (let light = 0; light + dark <= TOTAL_POINTS; light += 1) {
        for (const move of Object.values(MOVES)) {
          let next;
          try {
            next = applyFlip({ dark, light }, move);
          } catch (err) {
            assert.ok(err instanceof RangeError, `unexpected error for ${move}`);
            continue;
          }
          assert.ok(next.dark >= 0 && next.light >= 0, `negative count from ${move}`);
          assert.ok(next.dark + next.light <= TOTAL_POINTS, `overflow from ${move}`);
          assert.ok(Number.isInteger(next.dark) && Number.isInteger(next.light));
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * normalize
 * ------------------------------------------------------------------ */

describe("normalize", () => {
  test("absent flags mean ten Neutral", () => {
    assert.deepEqual(normalize(undefined), { dark: 0, light: 0, neutral: 10 });
    assert.deepEqual(normalize({}), { dark: 0, light: 0, neutral: 10 });
  });

  test("garbage, negatives and overflow are clamped, never NaN", () => {
    assert.deepEqual(normalize({ dark: -3, light: "x" }), { dark: 0, light: 0, neutral: 10 });
    assert.deepEqual(normalize({ dark: 99, light: 99 }), { dark: 10, light: 0, neutral: 0 });
    assert.deepEqual(normalize({ dark: 7, light: 7 }), { dark: 7, light: 3, neutral: 0 });
    assert.deepEqual(normalize({ dark: 2.7, light: 1.2 }), { dark: 2, light: 1, neutral: 7 });
  });
});

/* ------------------------------------------------------------------ *
 * 2, 3. Thresholds
 * ------------------------------------------------------------------ */

describe("thresholds", () => {
  test("Dark Side Threshold boundary at 6 / 7", () => {
    assert.equal(thresholds({ dark: 6, light: 0 }).darkSide, false);
    assert.equal(thresholds({ dark: 7, light: 0 }).darkSide, true);
  });

  test("Light Side Paragon boundary at 6 / 7", () => {
    assert.equal(thresholds({ dark: 0, light: 6 }).paragon, false);
    assert.equal(thresholds({ dark: 0, light: 7 }).paragon, true);
  });

  test("Destiny clauses boundary at 8 / 9", () => {
    assert.equal(thresholds({ dark: 8, light: 0 }).destinyFlip, false);
    assert.equal(thresholds({ dark: 9, light: 0 }).destinyFlip, true);
    assert.equal(thresholds({ dark: 0, light: 8 }).destinyBonus, false);
    assert.equal(thresholds({ dark: 0, light: 9 }).destinyBonus, true);
  });

  test("ten Dark is consumed by the dark side; redemption needs seven Light", () => {
    assert.equal(thresholds({ dark: 9, light: 0 }).consumed, false);
    assert.equal(thresholds({ dark: 10, light: 0 }).consumed, true);
    assert.equal(thresholds({ dark: 0, light: 6 }).redeemed, false);
    assert.equal(thresholds({ dark: 0, light: 7 }).redeemed, true);
  });

  test("the two thresholds can never both hold — 7 + 7 exceeds ten points", () => {
    for (let dark = 0; dark <= TOTAL_POINTS; dark += 1) {
      for (let light = 0; light + dark <= TOTAL_POINTS; light += 1) {
        const t = thresholds({ dark, light });
        assert.ok(!(t.darkSide && t.paragon), `both at ${dark} Dark / ${light} Light`);
      }
    }
  });

  test("reported threshold adjustments are display-only values, signed as the rules state", () => {
    assert.deepEqual(
      { strain: thresholds({ dark: 7, light: 0 }).strain, wounds: thresholds({ dark: 7, light: 0 }).wounds },
      { strain: -2, wounds: +2 },
    );
    assert.deepEqual(
      { strain: thresholds({ dark: 0, light: 7 }).strain, wounds: thresholds({ dark: 0, light: 7 }).wounds },
      { strain: +2, wounds: 0 },
    );
    assert.deepEqual(
      { strain: thresholds({ dark: 1, light: 1 }).strain, wounds: thresholds({ dark: 1, light: 1 }).wounds },
      { strain: 0, wounds: 0 },
    );
  });

  test("THRESHOLDS constants match the rules text", () => {
    assert.equal(THRESHOLDS.DARK_SIDE, 7);
    assert.equal(THRESHOLDS.PARAGON, 7);
    assert.equal(THRESHOLDS.DESTINY, 9);
    assert.equal(THRESHOLDS.CONSUMED, 10);
  });
});

/* ------------------------------------------------------------------ *
 * 4. alignmentClass — mixed states, where a linear morality mirror failed
 * ------------------------------------------------------------------ */

describe("alignmentClass", () => {
  test("mixed states resolve by threshold, not by a net score", () => {
    // A `50 + (light - dark) * 5` mirror gave 30 and 70 here, which the Codex sheet
    // reads as NEUTRAL. These four cases are why the mirror was dropped.
    assert.equal(alignmentClass({ dark: 7, light: 3 }), "evil");
    assert.equal(alignmentClass({ dark: 3, light: 7 }), "good");
    assert.equal(alignmentClass({ dark: 0, light: 5 }), "neutral", "5 Light is not Paragon");
    assert.equal(alignmentClass({ dark: 10, light: 0 }), "evil", "never reads as untracked");
  });

  test("below both thresholds is explicitly neutral, never null", () => {
    // Left unset, a stale `good` from a converted Morality 85 would survive losing a
    // Light point and contradict the panel on the same sheet.
    assert.equal(alignmentClass({ dark: 0, light: 0 }), "neutral");
    assert.equal(alignmentClass({ dark: 6, light: 4 }), "neutral");
    for (let dark = 0; dark <= TOTAL_POINTS; dark += 1) {
      for (let light = 0; light + dark <= TOTAL_POINTS; light += 1) {
        assert.ok(
          ["evil", "good", "neutral"].includes(alignmentClass({ dark, light })),
          `non-explicit class at ${dark} Dark / ${light} Light`,
        );
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 5, 6. Conversion from a base-game Morality score
 * ------------------------------------------------------------------ */

describe("seedFromMorality", () => {
  test("a genuine score seeds a one-sided scale", () => {
    assert.deepEqual(seedFromMorality(50), { dark: 0, light: 0 }, "ten Neutral");
    assert.deepEqual(seedFromMorality(85), { dark: 0, light: 7 });
    assert.deepEqual(seedFromMorality(15), { dark: 7, light: 0 });
    assert.deepEqual(seedFromMorality(100), { dark: 0, light: 10 });
  });

  test("rounding is half-away-from-zero at the 52 / 53 boundary", () => {
    assert.deepEqual(seedFromMorality(52), { dark: 0, light: 0 });
    assert.deepEqual(seedFromMorality(53), { dark: 0, light: 1 });
    assert.deepEqual(seedFromMorality(48), { dark: 0, light: 0 });
    assert.deepEqual(seedFromMorality(47), { dark: 1, light: 0 });
  });

  test("a score of zero is UNTRACKED and returns null, never ten Dark", () => {
    // The system's schema defaults morality.value to 0 and treats 0 as "not tracked".
    // Seeding it would convert an ordinary Force user into a maximally fallen one and
    // then mark the scale initialized, so it could never be corrected.
    assert.equal(seedFromMorality(0), null);
    assert.equal(seedFromMorality(-5), null);
    assert.equal(seedFromMorality(null), null);
    assert.equal(seedFromMorality(undefined), null);
    assert.equal(seedFromMorality(""), null);
    assert.equal(seedFromMorality(Number.NaN), null);
  });

  test("a scale never exceeds ten points however extreme the score", () => {
    for (const score of [1, 200, 999]) {
      const seeded = seedFromMorality(score);
      assert.ok(seeded.dark + seeded.light <= TOTAL_POINTS, `overflow at ${score}`);
    }
  });
});

describe("classifyForConversion", () => {
  test("an already-initialized scale is skipped, so a re-run cannot overwrite it", () => {
    const result = classifyForConversion({ initialized: true, score: 85, moralityEntryCount: 0 });
    assert.equal(result.action, "skip-initialized");
    assert.equal(result.scale, null);
  });

  test("an untracked actor is skipped, not seeded — this is the normal manual-creation case", () => {
    const result = classifyForConversion({ initialized: false, score: 0, moralityEntryCount: 0 });
    assert.equal(result.action, "skip-untracked");
    assert.equal(result.scale, null);
  });

  test("score 0 WITH Morality items counts as tracked, and seeds as fully Dark", () => {
    // Only the wizard writes defaultMorality (50). A character deliberately driven to 0
    // while carrying Emotional Strength/Weakness entries really is at the bottom.
    const result = classifyForConversion({ initialized: false, score: 0, moralityEntryCount: 2 });
    assert.equal(result.action, "seed");
    assert.deepEqual(result.scale, { dark: 10, light: 0 });
  });

  test("a genuine score seeds", () => {
    const result = classifyForConversion({ initialized: false, score: 85, moralityEntryCount: 1 });
    assert.equal(result.action, "seed");
    assert.deepEqual(result.scale, { dark: 0, light: 7 });
  });

  test("initialized wins over everything else", () => {
    const result = classifyForConversion({ initialized: true, score: 0, moralityEntryCount: 0 });
    assert.equal(result.action, "skip-initialized");
  });
});

/* ------------------------------------------------------------------ *
 * renderScale — presentation order
 * ------------------------------------------------------------------ */

describe("renderScale", () => {
  test("always ten points, sorted Dark then Neutral then Light", () => {
    assert.deepEqual(renderScale({ dark: 2, light: 3 }), [
      "dark", "dark",
      "neutral", "neutral", "neutral", "neutral", "neutral",
      "light", "light", "light",
    ]);
    assert.equal(renderScale({ dark: 0, light: 0 }).length, TOTAL_POINTS);
    assert.deepEqual(new Set(renderScale({ dark: 10, light: 0 })), new Set(["dark"]));
  });

  test("Courtney's printed end state renders as one Dark and nine Light", () => {
    const rendered = renderScale({ dark: 1, light: 9 });
    assert.equal(rendered[0], "dark");
    assert.equal(rendered.filter((p) => p === "light").length, 9);
    assert.equal(rendered.filter((p) => p === "neutral").length, 0);
  });
});
