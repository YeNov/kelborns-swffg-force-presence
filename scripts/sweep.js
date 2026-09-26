/**
 * The end-of-session sweep — state machine only.
 *
 * Pure: no Foundry, no socketlib, no I/O. The caller owns the transport and the writes
 * and drives this machine around them, so every rule that protects a character's
 * alignment is testable in Node.
 *
 * Three invariants, each of which was a real defect in an earlier draft:
 *
 * 1. LOCKING AND COMPLETION ARE SEPARATE. A row stops accepting player answers the
 *    moment it leaves `prompted`. That is not the same as being done. A GM takeover
 *    supplies no choice, and a deadline supplies no choice; both only hand the row over.
 *    Marking a row resolved at takeover would let an unresolved character be skipped and
 *    the sweep close over the top of them.
 *
 * 2. `resolved` MEANS PERSISTED. Only `applied()` -- called by the caller after its
 *    write succeeds -- resolves a row. A rejected write lands in `failed`, which is
 *    retryable and which holds the sweep open.
 *
 * 3. TALLIES ARE FROZEN PER ROW. A row records the Conflict and Tranquility it was
 *    computed from. `revalidate()` re-reads them before the write: if either moved, the
 *    player's answer is obsolete and is discarded, because a Conflict award landing while
 *    the prompt was open can reverse the direction entirely. Validating the scale alone
 *    would accept a lightward answer for a Conflict-dominant session.
 *
 *    Intention-validation and the exactly-once lock are BOTH required. Neither
 *    substitutes for the other: the lock stops a duplicate, revalidation stops a stale
 *    one.
 */

import { ROW_STATES } from "./constants.js";
import { normalize, resolveSession } from "./rules.js";

/**
 * @typedef {object} SweepCharacter
 * @property {string} actorId
 * @property {number} dark
 * @property {number} light
 * @property {number} conflict
 * @property {number} tranquility
 * @property {string} ownerUserId
 * @property {boolean} ownerOnline
 */

/**
 * Open a sweep over a set of characters.
 *
 * @param {{sweepId: string, characters: SweepCharacter[]}} init
 */
export function createSweep({ sweepId, characters = [] }) {
  const rows = new Map();

  for (const character of characters) {
    const { dark, light } = normalize(character);
    rows.set(character.actorId, {
      actorId: character.actorId,
      state: ROW_STATES.PENDING,
      scale: { dark, light },
      snapshot: {
        conflict: Number(character.conflict) || 0,
        tranquility: Number(character.tranquility) || 0,
      },
      direction: "none",
      options: [],
      forced: false,
      move: null,
      error: null,
      ownerUserId: character.ownerUserId ?? null,
      ownerOnline: Boolean(character.ownerOnline),
      promptedUserId: null,
      deadlineFired: false,
    });
  }

  /**
   * Route a row from its frozen tallies and current scale. Used at start and again after
   * any revalidation reset, so the two paths cannot drift apart.
   *
   * A row with nothing to move still reaches `applying`: the tallies must be zeroed
   * either way, which is a write.
   *
   * Once a deadline has fired for a row it never returns to the player, even if
   * revalidation resets it.
   */
  function route(row) {
    const outcome = resolveSession({ ...row.scale, ...row.snapshot });
    row.direction = outcome.direction;
    row.options = outcome.options;
    row.forced = outcome.forced;
    row.move = null;
    row.promptedUserId = null;

    if (outcome.options.length === 0) {
      row.state = ROW_STATES.APPLYING; // nothing to move; the tallies still get cleared
      return;
    }
    if (outcome.forced) {
      row.move = outcome.options[0]; // no one is asked a question with one answer
      row.state = ROW_STATES.APPLYING;
      return;
    }
    if (!row.ownerOnline || row.deadlineFired) {
      row.state = ROW_STATES.GM_OWNED;
      return;
    }
    row.state = ROW_STATES.PROMPTED;
    row.promptedUserId = row.ownerUserId;
  }

  return {
    sweepId,

    /** Route every row. Call once, after construction. */
    start() {
      for (const row of rows.values()) route(row);
      return this;
    },

    /** @returns {object|null} the row, for inspection and rendering */
    row(actorId) {
      return rows.get(actorId) ?? null;
    },

    /** Every row, in insertion order. */
    all() {
      return [...rows.values()];
    },

    /**
     * A player's answer. Accepted ONLY while the row is prompted under this sweep and
     * the move is one of the options offered. Everything else is dropped, which is what
     * makes resolution exactly-once: a late answer after a takeover, a deadline, or an
     * earlier answer finds the row no longer `prompted`.
     *
     * @returns {{accepted: boolean, reason?: string}}
     */
    answer(actorId, { sweepId: answeredSweepId, move } = {}) {
      const row = rows.get(actorId);
      if (!row) return { accepted: false, reason: "unknown-actor" };
      if (answeredSweepId !== sweepId) return { accepted: false, reason: "stale-sweep" };
      if (row.state !== ROW_STATES.PROMPTED) return { accepted: false, reason: "not-prompted" };
      if (!row.options.includes(move)) return { accepted: false, reason: "illegal-move" };

      row.move = move;
      row.state = ROW_STATES.APPLYING;
      row.promptedUserId = null;
      return { accepted: true };
    },

    /**
     * The GM claims a waiting row. Closes the player's input immediately; the caller
     * should best-effort cancel their dialog. The row is NOT done -- it now waits on the
     * GM's own choice.
     *
     * @returns {boolean} whether the row was claimable
     */
    takeover(actorId) {
      const row = rows.get(actorId);
      if (!row || row.state !== ROW_STATES.PROMPTED) return false;
      row.state = ROW_STATES.GM_OWNED;
      row.move = null;
      row.promptedUserId = null;
      return true;
    },

    /**
     * The module's own response deadline. socketlib has NO response timer -- it rejects
     * on disconnect, but a connected player who never answers would leave the promise
     * pending forever -- so this is the only thing that ends that wait.
     *
     * Resolves nothing: it has no choice to apply.
     */
    deadline(actorId) {
      const row = rows.get(actorId);
      if (!row) return false;
      row.deadlineFired = true;
      if (row.state !== ROW_STATES.PROMPTED) return false;
      row.state = ROW_STATES.GM_OWNED;
      row.move = null;
      row.promptedUserId = null;
      return true;
    },

    /**
     * The GM's choice for a row they own.
     * @returns {{accepted: boolean, reason?: string}}
     */
    gmChoose(actorId, move) {
      const row = rows.get(actorId);
      if (!row) return { accepted: false, reason: "unknown-actor" };
      if (row.state !== ROW_STATES.GM_OWNED) return { accepted: false, reason: "not-gm-owned" };
      if (!row.options.includes(move)) return { accepted: false, reason: "illegal-move" };

      row.move = move;
      row.state = ROW_STATES.APPLYING;
      return { accepted: true };
    },

    /**
     * Re-read the actor immediately before writing. Any change to the tallies or the
     * scale invalidates the chosen move: the tallies because they decide the DIRECTION,
     * the scale because the owner can edit it directly and may have removed the point the
     * move was going to take.
     *
     * On a reset the row re-freezes the new tallies and is re-routed, so it may be
     * re-prompted, handed to the GM (if a deadline has already fired), or applied
     * outright if the recomputed outcome is forced.
     *
     * The snapshot is never the value written: zeroing clears whatever the actor holds at
     * write time, so a mid-sweep award is counted in the session it was awarded for
     * rather than lost.
     *
     * @returns {{reset: boolean, reason?: string}}
     */
    revalidate(actorId, { dark, light, conflict, tranquility } = {}) {
      const row = rows.get(actorId);
      if (!row) return { reset: false, reason: "unknown-actor" };

      const nextScale = normalize({ dark, light });
      const nextConflict = Number(conflict) || 0;
      const nextTranquility = Number(tranquility) || 0;

      const talliesChanged =
        nextConflict !== row.snapshot.conflict || nextTranquility !== row.snapshot.tranquility;
      const scaleChanged = nextScale.dark !== row.scale.dark || nextScale.light !== row.scale.light;
      if (!talliesChanged && !scaleChanged) return { reset: false };

      row.scale = { dark: nextScale.dark, light: nextScale.light };
      row.snapshot = { conflict: nextConflict, tranquility: nextTranquility };
      route(row);
      return { reset: true, reason: talliesChanged ? "tallies-changed" : "scale-changed" };
    },

    /** The caller's write persisted. The ONLY route to `resolved`. */
    applied(actorId) {
      const row = rows.get(actorId);
      if (!row || row.state !== ROW_STATES.APPLYING) return false;
      row.state = ROW_STATES.RESOLVED;
      row.error = null;
      return true;
    },

    /** The caller's write failed. Retryable, and holds the sweep open. */
    failed(actorId, error) {
      const row = rows.get(actorId);
      if (!row || row.state !== ROW_STATES.APPLYING) return false;
      row.state = ROW_STATES.FAILED;
      row.error = String(error?.message ?? error ?? "unknown error");
      return true;
    },

    /** Retry a failed write, keeping the choice already made. */
    retry(actorId) {
      const row = rows.get(actorId);
      if (!row || row.state !== ROW_STATES.FAILED) return false;
      row.state = ROW_STATES.APPLYING;
      row.error = null;
      return true;
    },

    /** Actor ids that have not persisted yet -- reported, never skipped. */
    unresolved() {
      return [...rows.values()]
        .filter((row) => row.state !== ROW_STATES.RESOLVED)
        .map((row) => row.actorId);
    },

    /** A sweep may close only when every row has persisted. */
    canClose() {
      return this.unresolved().length === 0;
    },
  };
}
