/**
 * Applying a resolved sweep row to an actor, and reporting it.
 *
 * The write is deliberately ONE `actor.update` carrying the whole outcome -- the new
 * scale, both tallies zeroed, and the initialized marker. A character must never be left
 * with a flipped Balance Point and un-zeroed Conflict, or with zeroed tallies and an
 * unmoved scale, which is what two sequential updates risk if the second fails.
 *
 * Nothing here decides anything: the move arrives already chosen and already validated
 * by the sweep state machine. This module only persists it and says what happened.
 */

import { MODULE_ID, FLAGS, SETTINGS } from "./constants.js";
import { normalize, applyFlip, thresholds, renderScale } from "./rules.js";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const GLYPH_CHARS = Object.freeze({ dark: "●", neutral: "◑", light: "○" });

/** The scale as the source prints it: sorted, Dark to Light. */
function scaleText(scale) {
  return renderScale(scale)
    .map((state) => GLYPH_CHARS[state])
    .join("");
}

/** The actor's live state, as the sweep needs it for revalidation. */
export function readLive(actor) {
  const { dark, light } = normalize({
    dark: actor.getFlag(MODULE_ID, FLAGS.DARK),
    light: actor.getFlag(MODULE_ID, FLAGS.LIGHT),
  });
  return {
    dark,
    light,
    conflict: Number(actor.system?.conflict?.value) || 0,
    tranquility: Number(actor.getFlag(MODULE_ID, FLAGS.TRANQUILITY)) || 0,
  };
}

/**
 * Persist one row's outcome.
 *
 * @param {Actor} actor
 * @param {string|null} move  a MOVES value, or null when the tallies were equal (or
 *                            nothing could move) and only the zeroing applies
 * @returns {Promise<{before: object, after: object, move: string|null}>}
 * @throws whatever `actor.update` throws -- the caller records the row as failed
 */
export async function applyResolution(actor, move) {
  const before = readLive(actor);
  const after = move ? applyFlip(before, move) : { dark: before.dark, light: before.light };

  await actor.update({
    [`flags.${MODULE_ID}.${FLAGS.DARK}`]: after.dark,
    [`flags.${MODULE_ID}.${FLAGS.LIGHT}`]: after.light,
    [`flags.${MODULE_ID}.${FLAGS.TRANQUILITY}`]: 0,
    [`flags.${MODULE_ID}.${FLAGS.INITIALIZED}`]: true,
    "system.conflict.value": 0,
  });

  return { before, after, move: move ?? null };
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

/**
 * Who sees a card. Private by default, because the base rules let a player keep their
 * alignment secret from the rest of the table -- the same position the system takes when
 * it hides the Group Manager's Morality tab from non-GMs.
 *
 * @returns {string[]|undefined} whisper recipients, or undefined for a public card
 */
function recipients(actor) {
  if (game.settings.get(MODULE_ID, SETTINGS.PUBLIC_CARDS)) return undefined;
  const ids = new Set(game.users.filter((u) => u.isGM).map((u) => u.id));
  for (const user of game.users) {
    if (!user.isGM && actor.testUserPermission(user, "OWNER")) ids.add(user.id);
  }
  return [...ids];
}

/** One character's outcome. */
export async function postResolutionCard(actor, { before, after, move }) {
  const th = thresholds(after);
  const lines = [];

  lines.push(
    move
      ? `<p>${t("KFP.Card.Moved", { move: t(`KFP.Move.${move}`) })}</p>`
      : `<p>${t("KFP.Sweep.NoChange")}</p>`,
  );
  lines.push(
    `<p class="kfp-card-scale"><span>${scaleText(before)}</span> &rarr; <span>${scaleText(after)}</span></p>`,
  );

  const notes = [];
  if (th.darkSide) notes.push(t("KFP.Threshold.DarkSide"));
  if (th.destinyFlip) notes.push(t("KFP.Threshold.DestinyFlip"));
  if (th.consumed) notes.push(t("KFP.Threshold.Consumed"));
  if (th.paragon) notes.push(t("KFP.Threshold.Paragon"));
  if (th.destinyBonus) notes.push(t("KFP.Threshold.DestinyBonus"));
  if (notes.length) {
    lines.push(`<ul class="kfp-card-notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul>`);
    lines.push(`<p class="kfp-card-quiet">${t("KFP.Threshold.Reminder")}</p>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: t("KFP.Card.Flavor", { name: actor.name }),
    content: `<div class="kfp-card">${lines.join("")}</div>`,
    whisper: recipients(actor),
  });
}

/** The sweep's closing summary, for the GM only. */
export async function postSweepSummary({ resolved, failed }) {
  const body = failed.length
    ? `<p>${t("KFP.Card.SummaryFailed", { count: resolved, failed: failed.join(", ") })}</p>`
    : `<p>${t("KFP.Card.Summary", { count: resolved })}</p>`;
  await ChatMessage.create({
    content: `<div class="kfp-card">${body}</div>`,
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
  });
}
