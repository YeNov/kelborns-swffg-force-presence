/**
 * Module-wide constants. Imports nothing, touches no Foundry globals, so the pure core
 * and its tests can use it under `node --test`.
 */

export const MODULE_ID = "kelborns-swffg-force-presence";

/** Balance Points on the Force Presence scale. Fixed by the rules. */
export const TOTAL_POINTS = 10;

/**
 * The four legal end-of-session moves, named by what they do so a socket payload is
 * self-describing and cannot be misread.
 *
 * The asymmetry is the rule, not a bug: Conflict makes a point Dark from ANYWHERE
 * (`light-to-dark` skips Neutral entirely), while Tranquility moves a point one step
 * lightward. See the plan's "Courtney contradiction" section.
 */
export const MOVES = Object.freeze({
  NEUTRAL_TO_DARK: "neutral-to-dark",
  LIGHT_TO_DARK: "light-to-dark",
  DARK_TO_NEUTRAL: "dark-to-neutral",
  NEUTRAL_TO_LIGHT: "neutral-to-light",
});

/** Balance Point counts at which the rules' effects begin. */
export const THRESHOLDS = Object.freeze({
  DARK_SIDE: 7,
  PARAGON: 7,
  DESTINY: 9,
  CONSUMED: 10,
});

/** Actor flag keys under `flags.<MODULE_ID>`. */
export const FLAGS = Object.freeze({
  DARK: "dark",
  LIGHT: "light",
  TRANQUILITY: "tranquility",
  STARTING_CHOICE_TAKEN: "startingChoiceTaken",
  INITIALIZED: "initialized",
});

/** World setting keys. */
export const SETTINGS = Object.freeze({
  PUBLIC_CARDS: "publicCards",
  OPEN_SWEEP: "openSweep",
});

/** Row states in the end-of-session sweep. See scripts/sweep.js. */
export const ROW_STATES = Object.freeze({
  PENDING: "pending",
  PROMPTED: "prompted",
  GM_OWNED: "gm-owned",
  APPLYING: "applying",
  RESOLVED: "resolved",
  FAILED: "failed",
});
