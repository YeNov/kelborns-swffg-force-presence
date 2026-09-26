/**
 * Tranquility and Force Presence — the rules themselves.
 *
 * Pure on purpose: plain data in, plain data out. No Foundry globals, no document
 * access, no imports beyond this module's own constants. Every consumer calls these
 * rather than reimplementing a threshold or a flip, and `node --test` exercises them
 * directly.
 *
 * The end-of-session rule is ASYMMETRIC, and the source contradicts itself about it:
 *
 *   Conflict > Tranquility  ->  one point BECOMES Dark, from Neutral or from Light
 *   Tranquility > Conflict  ->  one point moves ONE STEP lightward
 *
 * The rule text says "Neutral to Dark, or Light to Dark". The worked example's prose
 * says "Light Side to Neutral or Neutral to Dark Side" -- but the example's own printed
 * scales show Courtney, holding ten Light and no Neutral, ending with a FILLED Dark
 * point. Two parts of the source agree; only that one sentence dissents. We follow the
 * rule text and the scales. `tests/rules.test.js` pins all three printed characters.
 * Change those assertions before changing this file.
 */

import { MOVES, TOTAL_POINTS, THRESHOLDS } from "./constants.js";

/** A whole count in [0, max]; anything unreadable becomes 0 rather than NaN. */
function count(value, max = TOTAL_POINTS) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

/**
 * A scale as the rest of the module may rely on it: whole counts, non-negative, never
 * more than ten points between them, with Neutral derived rather than stored.
 *
 * Absent flags mean ten Neutral, which is what a character starts with, so an actor the
 * module has never touched reads correctly without anything having been written.
 *
 * @param {{dark?: *, light?: *}} [scale]
 * @returns {{dark: number, light: number, neutral: number}}
 */
export function normalize(scale) {
  const dark = count(scale?.dark);
  const light = count(scale?.light, TOTAL_POINTS - dark);
  return { dark, light, neutral: TOTAL_POINTS - dark - light };
}

/**
 * The end-of-session outcome: which direction the session pushed, and which moves are
 * actually available. Returns the *choices*, never a decision -- the player makes it.
 *
 * In the Conflict direction `neutral-to-dark` is listed first because it DOMINATES:
 * both moves add one Dark point, but only that one preserves a Light point, so there is
 * never a reason to pick `light-to-dark` unless no Neutral remains. When that is the
 * case the outcome is `forced` and no one is asked -- exactly Courtney's situation.
 *
 * In the Tranquility direction `neutral-to-light` is listed first because it is the
 * choice the printed example makes, and so is the sensible default to pre-select. It
 * does not dominate: a character close to the Dark Side Threshold may well prefer
 * `dark-to-neutral`, which is why this direction is a genuine question.
 *
 * `options` can be empty with a non-`none` direction: ten Dark under a Conflict-dominant
 * session has nothing left to darken. The caller reports that state rather than moving.
 *
 * @param {{dark?: *, light?: *, conflict?: *, tranquility?: *}} state
 * @returns {{direction: "dark"|"light"|"none", options: string[], forced: boolean}}
 */
export function resolveSession(state) {
  const { dark, light, neutral } = normalize(state);
  const conflict = Number(state?.conflict) || 0;
  const tranquility = Number(state?.tranquility) || 0;

  let direction = "none";
  let candidates = [];
  if (conflict > tranquility) {
    direction = "dark";
    candidates = [
      [MOVES.NEUTRAL_TO_DARK, neutral > 0],
      [MOVES.LIGHT_TO_DARK, light > 0],
    ];
  } else if (tranquility > conflict) {
    direction = "light";
    candidates = [
      [MOVES.NEUTRAL_TO_LIGHT, neutral > 0],
      [MOVES.DARK_TO_NEUTRAL, dark > 0],
    ];
  }

  const options = candidates.filter(([, available]) => available).map(([move]) => move);
  return { direction, options, forced: options.length === 1 };
}

/**
 * Apply one move to a scale.
 *
 * Throws on an illegal or unknown move rather than clamping. A silent clamp here would
 * be a character's alignment quietly not moving, which is worse than a loud failure --
 * and the sweep revalidates a player's answer through this same legality rule after the
 * scale may have been edited underneath it.
 *
 * @param {{dark?: *, light?: *}} scale
 * @param {string} move  one of MOVES
 * @returns {{dark: number, light: number}}
 * @throws {RangeError} the move is unknown, or the scale has no point to move
 */
export function applyFlip(scale, move) {
  const { dark, light, neutral } = normalize(scale);
  switch (move) {
    case MOVES.NEUTRAL_TO_DARK:
      if (neutral <= 0) throw new RangeError(`${move}: no Neutral point to move`);
      return { dark: dark + 1, light };
    case MOVES.LIGHT_TO_DARK:
      if (light <= 0) throw new RangeError(`${move}: no Light point to move`);
      return { dark: dark + 1, light: light - 1 };
    case MOVES.DARK_TO_NEUTRAL:
      if (dark <= 0) throw new RangeError(`${move}: no Dark point to move`);
      return { dark: dark - 1, light };
    case MOVES.NEUTRAL_TO_LIGHT:
      if (neutral <= 0) throw new RangeError(`${move}: no Neutral point to move`);
      return { dark, light: light + 1 };
    default:
      throw new RangeError(`unknown move: ${String(move)}`);
  }
}

/**
 * Every threshold the rules define, as reported state.
 *
 * `strain` and `wounds` are the adjustments the rules call for, but this module NEVER
 * applies them -- it is a tracker, not an enforcer. They are here to be displayed. The
 * system stores `wounds.max` / `strain.max` and recomputes them from the effect-applied
 * value when Brawn or Willpower changes, so an additive Active Effect would be absorbed
 * into the baseline and then applied again. See the plan.
 *
 * `darkSide` and `paragon` can never both hold: seven plus seven exceeds ten points.
 *
 * @param {{dark?: *, light?: *}} scale
 */
export function thresholds(scale) {
  const { dark, light } = normalize(scale);
  const darkSide = dark >= THRESHOLDS.DARK_SIDE;
  const paragon = light >= THRESHOLDS.PARAGON;
  return {
    darkSide,
    paragon,
    consumed: dark >= THRESHOLDS.CONSUMED,
    redeemed: light >= THRESHOLDS.PARAGON,
    destinyFlip: dark >= THRESHOLDS.DESTINY,
    destinyBonus: light >= THRESHOLDS.DESTINY,
    strain: darkSide ? -2 : paragon ? 2 : 0,
    wounds: darkSide ? 2 : 0,
  };
}

/**
 * The Codex sheet's Force-chip alignment class, driven by the scale.
 *
 * ALWAYS returns one of the three classes, never null. Leaving the below-threshold case
 * alone was an earlier design, and it broke: convert a Morality 85 character to seven
 * Light, lose one Light, and the untouched class stays `good` while the panel has
 * stopped reporting Paragon -- the same sheet contradicting itself.
 *
 * This deliberately overrides a manually-set `codexAlignment` baseline. Under these
 * rules the scale IS the character's alignment, so a stale hand-set colour is exactly
 * what should stop applying.
 *
 * @param {{dark?: *, light?: *}} scale
 * @returns {"evil"|"good"|"neutral"}
 */
export function alignmentClass(scale) {
  const { darkSide, paragon } = thresholds(scale);
  if (darkSide) return "evil";
  if (paragon) return "good";
  return "neutral";
}

/** Round half away from zero. `Math.round` breaks ties toward +Infinity, which would
 *  make the 47/48 and 52/53 boundaries asymmetric. */
function roundHalfAway(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/**
 * Seed a scale from a base-game Morality score, for a campaign switching mid-stream.
 *
 * ONE-WAY AND LOSSY. A Morality score is a single number and cannot encode a three-state
 * scale, so the result is one-sided with the rest Neutral. There is no inverse and no
 * round trip: {0 Dark, 0 Light} and {5 Dark, 5 Light} would both have mapped to the same
 * score under any linear scheme.
 *
 * Returns `null` for an UNTRACKED reading. The system defaults `morality.value` to 0 and
 * treats 0 as "not tracked" -- so seeding it would turn an ordinary Force user into a
 * maximally fallen one and then mark the scale initialized, beyond correction. Only the
 * PC Wizard writes a starting score (`defaultMorality`, 50 by default); a manually
 * created or imported character sits at 0. Use `classifyForConversion`, which applies
 * the system's own tracked/untracked test before ever reaching this function.
 *
 * @param {*} score
 * @returns {{dark: number, light: number}|null}
 */
export function seedFromMorality(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;

  const delta = roundHalfAway((50 - n) / 5);
  if (delta > 0) return { dark: Math.min(delta, TOTAL_POINTS), light: 0 };
  if (delta < 0) return { dark: 0, light: Math.min(-delta, TOTAL_POINTS) };
  return { dark: 0, light: 0 };
}

/**
 * Whether an actor is actually using the base-game Morality system, by the same reading
 * the system itself takes: a score of 0 with no Morality entries is "not tracked".
 *
 * @param {{score?: *, moralityEntryCount?: *}} reading
 */
export function isMoralityTracked(reading) {
  const score = Number(reading?.score) || 0;
  const entries = Number(reading?.moralityEntryCount) || 0;
  return score !== 0 || entries > 0;
}

/**
 * What the conversion tool should do with one actor. Three outcomes, reported separately
 * to the GM so they can see what was converted and what was left alone.
 *
 * `initialized` wins over everything: a scale that is already real is never overwritten,
 * however the conversion is re-run.
 *
 * A tracked actor sitting at exactly 0 -- driven there deliberately, and carrying
 * Emotional Strength/Weakness entries to prove the system was in use -- really is at the
 * bottom of the scale, so it seeds to ten Dark. An UNtracked actor at 0 is skipped.
 *
 * @param {{initialized?: boolean, score?: *, moralityEntryCount?: *}} reading
 * @returns {{action: "skip-initialized"|"skip-untracked"|"seed", scale: {dark: number, light: number}|null}}
 */
export function classifyForConversion(reading) {
  if (reading?.initialized) return { action: "skip-initialized", scale: null };
  if (!isMoralityTracked(reading)) return { action: "skip-untracked", scale: null };
  const scale = seedFromMorality(reading?.score) ?? { dark: TOTAL_POINTS, light: 0 };
  return { action: "seed", scale };
}

/**
 * The scale as ten ordered states for display, sorted Dark -> Neutral -> Light.
 *
 * A Balance Point has no identity -- the printed scales are always sorted, so position
 * is presentation only. This is why the module stores two counts rather than ten states.
 *
 * @param {{dark?: *, light?: *}} scale
 * @returns {Array<"dark"|"neutral"|"light">}
 */
export function renderScale(scale) {
  const { dark, light, neutral } = normalize(scale);
  return [
    ...Array(dark).fill("dark"),
    ...Array(neutral).fill("neutral"),
    ...Array(light).fill("light"),
  ];
}
