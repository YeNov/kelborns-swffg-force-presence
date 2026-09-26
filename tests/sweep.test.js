/**
 * End-of-session sweep — state machine tests.
 *
 * Run: node --test
 *
 * Assertions 8-13 of the plan. The transport (socketlib) is NOT tested here; the state
 * machine is pure and owns every rule that actually protects a character's alignment:
 *
 *   - "stop accepting answers" and "this character is done" are SEPARATE transitions
 *   - a row becomes `resolved` only after the write persists
 *   - Conflict and Tranquility are frozen per row, so a mid-sweep award cannot be
 *     resolved with an obsolete answer
 *
 * Every one of these guards exists because its absence was a real defect in an earlier
 * draft. Do not relax one without reading the plan's sweep section.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MOVES } from "../scripts/constants.js";
import { createSweep } from "../scripts/sweep.js";

/** Alice: 1 Dark / 5 Neutral / 4 Light, more Tranquility -> a real two-way choice. */
const ALICE = {
  actorId: "alice",
  dark: 1,
  light: 4,
  conflict: 3,
  tranquility: 5,
  ownerUserId: "u-alice",
  ownerOnline: true,
};

/** Courtney: ten Light, more Conflict -> forced, no prompt needed. */
const COURTNEY = {
  actorId: "courtney",
  dark: 0,
  light: 10,
  conflict: 7,
  tranquility: 2,
  ownerUserId: "u-courtney",
  ownerOnline: true,
};

/** David: equal tallies -> nothing to move, but the tallies still need zeroing. */
const DAVID = {
  actorId: "david",
  dark: 4,
  light: 2,
  conflict: 3,
  tranquility: 3,
  ownerUserId: "u-david",
  ownerOnline: true,
};

const open = (characters) => {
  const sweep = createSweep({ sweepId: "s-1", characters });
  sweep.start();
  return sweep;
};

/* ------------------------------------------------------------------ *
 * Routing at start
 * ------------------------------------------------------------------ */

describe("sweep routing", () => {
  test("a real choice prompts the owning player", () => {
    const sweep = open([ALICE]);
    const row = sweep.row("alice");
    assert.equal(row.state, "prompted");
    assert.equal(row.promptedUserId, "u-alice");
    assert.deepEqual(row.options, [MOVES.NEUTRAL_TO_LIGHT, MOVES.DARK_TO_NEUTRAL]);
  });

  test("a forced move needs no prompt and goes straight to applying", () => {
    const sweep = open([COURTNEY]);
    const row = sweep.row("courtney");
    assert.equal(row.state, "applying");
    assert.equal(row.move, MOVES.LIGHT_TO_DARK);
  });

  test("equal tallies still need a write, to zero them", () => {
    const sweep = open([DAVID]);
    const row = sweep.row("david");
    assert.equal(row.state, "applying");
    assert.equal(row.move, null, "no flip, but the tallies are still cleared");
  });

  test("an offline owner is the GM's row immediately, and still awaits a choice", () => {
    const sweep = open([{ ...ALICE, ownerOnline: false }]);
    const row = sweep.row("alice");
    assert.equal(row.state, "gm-owned");
    assert.equal(row.move, null);
  });

  test("each row freezes the tallies it was computed from", () => {
    const sweep = open([ALICE]);
    assert.deepEqual(sweep.row("alice").snapshot, { conflict: 3, tranquility: 5 });
  });
});

/* ------------------------------------------------------------------ *
 * 8, 9. Answer acceptance
 * ------------------------------------------------------------------ */

describe("answers", () => {
  test("a valid answer from the prompted player is accepted and moves to applying", () => {
    const sweep = open([ALICE]);
    const result = sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });

    assert.equal(result.accepted, true);
    assert.equal(sweep.row("alice").state, "applying");
    assert.equal(sweep.row("alice").move, MOVES.NEUTRAL_TO_LIGHT);
  });

  test("an answer bearing a stale sweepId is dropped", () => {
    const sweep = open([ALICE]);
    const result = sweep.answer("alice", { sweepId: "s-0", move: MOVES.NEUTRAL_TO_LIGHT });

    assert.equal(result.accepted, false);
    assert.equal(result.reason, "stale-sweep");
    assert.equal(sweep.row("alice").state, "prompted", "the row is untouched");
  });

  test("an answer naming a move that is not on offer is dropped", () => {
    const sweep = open([ALICE]);
    const result = sweep.answer("alice", { sweepId: "s-1", move: MOVES.LIGHT_TO_DARK });

    assert.equal(result.accepted, false);
    assert.equal(result.reason, "illegal-move");
    assert.equal(sweep.row("alice").state, "prompted");
  });

  test("an answer for an unknown actor is dropped", () => {
    const sweep = open([ALICE]);
    assert.equal(sweep.answer("nobody", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT }).accepted, false);
  });

  test("a SECOND answer after the first is dropped — no double flip", () => {
    const sweep = open([ALICE]);
    sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });

    const second = sweep.answer("alice", { sweepId: "s-1", move: MOVES.DARK_TO_NEUTRAL });
    assert.equal(second.accepted, false);
    assert.equal(second.reason, "not-prompted");
    assert.equal(sweep.row("alice").move, MOVES.NEUTRAL_TO_LIGHT, "the first answer stands");
  });
});

/* ------------------------------------------------------------------ *
 * 10, 11. Takeover and deadline: locks, but resolve nothing
 * ------------------------------------------------------------------ */

describe("GM takeover and the deadline", () => {
  test("takeover moves prompted -> gm-owned, NOT resolved", () => {
    const sweep = open([ALICE]);
    sweep.takeover("alice");

    const row = sweep.row("alice");
    assert.equal(row.state, "gm-owned");
    assert.notEqual(row.state, "resolved");
    assert.equal(row.move, null, "a takeover supplies no choice");
    assert.equal(sweep.canClose(), false, "the character is not done");
  });

  test("a late answer after takeover is dropped, and applies no second flip", () => {
    const sweep = open([ALICE]);
    sweep.takeover("alice");

    const late = sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });
    assert.equal(late.accepted, false);
    assert.equal(late.reason, "not-prompted");
    assert.equal(sweep.row("alice").move, null);
  });

  test("the deadline resolves nothing — it only hands the row to the GM", () => {
    const sweep = open([ALICE]);
    sweep.deadline("alice");

    assert.equal(sweep.row("alice").state, "gm-owned");
    assert.equal(sweep.row("alice").move, null);
    assert.equal(sweep.canClose(), false);
  });

  test("a late answer after the deadline is dropped", () => {
    const sweep = open([ALICE]);
    sweep.deadline("alice");
    assert.equal(sweep.answer("alice", { sweepId: "s-1", move: MOVES.DARK_TO_NEUTRAL }).accepted, false);
  });

  test("the GM's own choice moves gm-owned -> applying", () => {
    const sweep = open([ALICE]);
    sweep.takeover("alice");

    const result = sweep.gmChoose("alice", MOVES.DARK_TO_NEUTRAL);
    assert.equal(result.accepted, true);
    assert.equal(sweep.row("alice").state, "applying");
    assert.equal(sweep.row("alice").move, MOVES.DARK_TO_NEUTRAL);
  });

  test("the GM cannot choose a move that is not on offer", () => {
    const sweep = open([ALICE]);
    sweep.takeover("alice");
    assert.equal(sweep.gmChoose("alice", MOVES.LIGHT_TO_DARK).accepted, false);
  });

  test("takeover of a row that is already applying is refused", () => {
    const sweep = open([COURTNEY]);
    assert.equal(sweep.takeover("courtney"), false);
    assert.equal(sweep.row("courtney").state, "applying");
  });
});

/* ------------------------------------------------------------------ *
 * 12. Persistence gates completion
 * ------------------------------------------------------------------ */

describe("persistence", () => {
  test("a row is resolved only once the write persists", () => {
    const sweep = open([COURTNEY]);
    assert.equal(sweep.canClose(), false);

    sweep.applied("courtney");
    assert.equal(sweep.row("courtney").state, "resolved");
    assert.equal(sweep.canClose(), true);
  });

  test("a failed write leaves the row failed and holds the sweep open", () => {
    const sweep = open([COURTNEY]);
    sweep.failed("courtney", new Error("actor update rejected"));

    const row = sweep.row("courtney");
    assert.equal(row.state, "failed");
    assert.match(row.error, /actor update rejected/);
    assert.equal(sweep.canClose(), false, "a failed row must never be skipped");
  });

  test("a failed row is retryable, keeping its chosen move", () => {
    const sweep = open([ALICE]);
    sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });
    sweep.failed("alice", new Error("boom"));

    assert.equal(sweep.retry("alice"), true);
    assert.equal(sweep.row("alice").state, "applying");
    assert.equal(sweep.row("alice").move, MOVES.NEUTRAL_TO_LIGHT);
    assert.equal(sweep.row("alice").error, null);
  });

  test("the sweep closes only when every row has persisted", () => {
    const sweep = open([ALICE, COURTNEY, DAVID]);
    assert.equal(sweep.canClose(), false);

    sweep.applied("courtney");
    sweep.applied("david");
    assert.equal(sweep.canClose(), false, "Alice is still prompted");

    sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });
    assert.equal(sweep.canClose(), false, "answered is not persisted");

    sweep.applied("alice");
    assert.equal(sweep.canClose(), true);
  });

  test("pending rows are reported so nothing is silently skipped", () => {
    const sweep = open([ALICE, COURTNEY]);
    sweep.applied("courtney");
    assert.deepEqual(sweep.unresolved(), ["alice"]);
    sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });
    sweep.applied("alice");
    assert.deepEqual(sweep.unresolved(), []);
  });
});

/* ------------------------------------------------------------------ *
 * 13. Frozen tallies — revalidation before the write
 * ------------------------------------------------------------------ */

describe("revalidation against the frozen tallies", () => {
  test("unchanged tallies revalidate clean", () => {
    const sweep = open([ALICE]);
    sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });

    const result = sweep.revalidate("alice", { dark: 1, light: 4, conflict: 3, tranquility: 5 });
    assert.equal(result.reset, false);
    assert.equal(sweep.row("alice").state, "applying");
  });

  test("a mid-sweep Conflict award REVERSES the direction and discards the answer", () => {
    const sweep = open([ALICE]);
    sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });

    // The GM awards 4 Conflict while the prompt was open: 7 Conflict vs 5 Tranquility.
    // Without this guard the module would apply a LIGHTWARD flip for a Conflict-dominant
    // session, and clear the updated counters on the way out.
    const result = sweep.revalidate("alice", { dark: 1, light: 4, conflict: 7, tranquility: 5 });

    assert.equal(result.reset, true);
    assert.equal(result.reason, "tallies-changed");

    const row = sweep.row("alice");
    assert.equal(row.move, null, "the obsolete answer is discarded");
    assert.equal(row.direction, "dark", "recomputed from the new totals");
    assert.deepEqual(row.snapshot, { conflict: 7, tranquility: 5 }, "re-frozen");
    assert.equal(row.state, "prompted", "re-prompted rather than applied");
  });

  test("a reset row after the deadline goes to the GM, not back to the player", () => {
    const sweep = open([ALICE]);
    sweep.deadline("alice");
    sweep.gmChoose("alice", MOVES.NEUTRAL_TO_LIGHT);

    const result = sweep.revalidate("alice", { dark: 1, light: 4, conflict: 9, tranquility: 5 });
    assert.equal(result.reset, true);
    assert.equal(sweep.row("alice").state, "gm-owned");
  });

  test("a scale changed underneath an answer invalidates it too", () => {
    const sweep = open([ALICE]);
    sweep.answer("alice", { sweepId: "s-1", move: MOVES.DARK_TO_NEUTRAL });

    // The owner edited their own scale to zero Dark; dark-to-neutral is now illegal.
    const result = sweep.revalidate("alice", { dark: 0, light: 4, conflict: 3, tranquility: 5 });

    assert.equal(result.reset, true);
    assert.equal(result.reason, "scale-changed");

    const row = sweep.row("alice");
    assert.notEqual(row.move, MOVES.DARK_TO_NEUTRAL, "the obsolete answer is discarded");
    // Recomputing leaves neutral-to-light as the ONLY legal move, so it is forced and
    // applied without a second prompt -- the same rule as routing at start.
    assert.deepEqual(row.options, [MOVES.NEUTRAL_TO_LIGHT]);
    assert.equal(row.move, MOVES.NEUTRAL_TO_LIGHT);
    assert.equal(row.state, "applying");
  });

  test("a row whose recomputed outcome is forced needs no second prompt", () => {
    const sweep = open([ALICE]);
    sweep.answer("alice", { sweepId: "s-1", move: MOVES.NEUTRAL_TO_LIGHT });

    // Scale edited to 6 Dark / 4 Light: no Neutral points, and Conflict now dominates,
    // so light-to-dark is the only move.
    const result = sweep.revalidate("alice", { dark: 6, light: 4, conflict: 9, tranquility: 1 });
    assert.equal(result.reset, true);
    assert.equal(sweep.row("alice").state, "applying");
    assert.equal(sweep.row("alice").move, MOVES.LIGHT_TO_DARK);
  });
});
