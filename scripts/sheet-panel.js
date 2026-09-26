/**
 * The Force Presence panel on the character sheet.
 *
 * Injected on `renderActorSheetV2`, which the system re-fires deliberately for modules
 * (see its ffg-actor-sheet.js: FFG sheets extend DocumentSheetV2 directly, so the hook
 * would never fire on its own).
 *
 * Supports the classic sheet and the Codex sheet, which render from different templates.
 * Skipped: the Adversary sheets (NPC tools) and the deprecated `…V2` duplicates.
 *
 * Two things worth knowing before editing this file:
 *
 * 1. OUR INPUTS CARRY NO `name` ATTRIBUTE. The sheets submit on change, and a `name`
 *    matching a document path would put our fields into the sheet's own submit pipeline,
 *    where flags and unknown paths fight the schema. Every value here is written through
 *    the document API instead, and the resulting re-render redraws the panel.
 *
 * 2. THE ANCHOR IS A CASCADE, NOT A SELECTOR. The Conflict and Morality boxes are not
 *    always rendered: `trackVisibility` shows them only on
 *    `editMode || forceUser || morality items || morality !== 0 || conflict !== 0`, and
 *    the CLASSIC sheet passes no `forceUser` at all. So the module's own normal starting
 *    state -- a Force-rated character at ten Neutral with zero Conflict -- has neither
 *    box on the classic sheet outside Edit Mode. Falling back is not an edge case.
 */

import { MODULE_ID, FLAGS, MOVES, TOTAL_POINTS } from "./constants.js";
import { normalize, thresholds, alignmentClass, renderScale } from "./rules.js";
import { isForceUser, hasState } from "./actors.js";

const PANEL_CLASS = "kfp-panel";

/** Font Awesome 7 glyphs for the three Balance Point states. V14 ships FA7. */
const GLYPHS = Object.freeze({
  dark: "fa-solid fa-circle",
  neutral: "fa-solid fa-circle-half-stroke",
  light: "fa-regular fa-circle",
});

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/* ------------------------------------------------------------------ *
 * Reading the actor
 * ------------------------------------------------------------------ */

function readState(actor) {
  const scale = normalize({
    dark: actor.getFlag(MODULE_ID, FLAGS.DARK),
    light: actor.getFlag(MODULE_ID, FLAGS.LIGHT),
  });
  return {
    ...scale,
    conflict: Number(actor.system?.conflict?.value) || 0,
    tranquility: Number(actor.getFlag(MODULE_ID, FLAGS.TRANQUILITY)) || 0,
    startingChoiceTaken: !!actor.getFlag(MODULE_ID, FLAGS.STARTING_CHOICE_TAKEN),
  };
}

/* ------------------------------------------------------------------ *
 * Markup
 * ------------------------------------------------------------------ */

function scaleHtml(scale) {
  const points = renderScale(scale)
    .map((state) => `<i class="${GLYPHS[state]} kfp-point-${state}" data-kfp-state="${state}"></i>`)
    .join("");
  const label = `${scale.dark} / ${scale.neutral} / ${scale.light}`;
  return `<div class="kfp-scale" data-tooltip="${t("KFP.Scale.Dark")} ${scale.dark} · ${t("KFP.Scale.Neutral")} ${scale.neutral} · ${t("KFP.Scale.Light")} ${scale.light}">${points}<span class="kfp-scale-count">${label}</span></div>`;
}

function stepperHtml(kind, value, editable) {
  if (!editable) return `<span class="kfp-count">${value}</span>`;
  return (
    `<a class="kfp-step" data-kfp-step="${kind}" data-kfp-delta="-1" aria-label="−"><i class="fa-solid fa-minus"></i></a>` +
    `<span class="kfp-count">${value}</span>` +
    `<a class="kfp-step" data-kfp-step="${kind}" data-kfp-delta="1" aria-label="+"><i class="fa-solid fa-plus"></i></a>`
  );
}

function tallyHtml(state, editable) {
  const field = (key, labelKey, value) =>
    `<div class="kfp-tally">` +
      `<label>${t(labelKey)}</label>` +
      (editable
        ? `<input type="number" class="kfp-tally-input" data-kfp-tally="${key}" value="${value}" min="0" step="1" />`
        : `<span class="kfp-count">${value}</span>`) +
    `</div>`;
  return (
    `<div class="kfp-tallies">` +
      field("conflict", "KFP.Panel.Conflict", state.conflict) +
      field("tranquility", "KFP.Panel.Tranquility", state.tranquility) +
    `</div>`
  );
}

/**
 * The threshold notes. Display only -- this module reports the rules' mechanical effects
 * and never applies them. See the plan: the system stores wounds.max / strain.max and
 * recomputes them from the effect-applied value when Brawn or Willpower changes, so an
 * additive Active Effect would be absorbed into the baseline and then applied again.
 */
function notesHtml(scale) {
  const th = thresholds(scale);
  const notes = [];
  if (th.darkSide) notes.push(["dark", t("KFP.Threshold.DarkSide")]);
  if (th.destinyFlip) notes.push(["dark", t("KFP.Threshold.DestinyFlip")]);
  if (th.consumed) notes.push(["dark", t("KFP.Threshold.Consumed")]);
  if (th.paragon) notes.push(["light", t("KFP.Threshold.Paragon")]);
  if (th.destinyBonus) notes.push(["light", t("KFP.Threshold.DestinyBonus")]);
  if (!notes.length) return "";
  return (
    notes.map(([tone, text]) => `<div class="kfp-note kfp-note-${tone}">${text}</div>`).join("") +
    `<div class="kfp-note kfp-note-quiet">${t("KFP.Threshold.Reminder")}</div>`
  );
}

/**
 * The one-time starting choice: the fourth of the four options the rules give at
 * creation. The other three (+10 XP, +2,500 credits, +5 XP and +1,000 credits) already
 * exist in the system's PC Wizard as fad_10xp / fad_2k_credits / fad_5xp, so the module
 * does not duplicate them.
 *
 * Only offered while untaken, and recorded so it cannot be taken twice.
 */
function startingChoiceHtml(state, editable) {
  if (state.startingChoiceTaken || !editable) return "";
  const canFlip = state.neutral > 0;
  const option = (value, labelKey, enabled = true) =>
    `<option value="${value}"${enabled ? "" : " disabled"}>${t(labelKey)}</option>`;
  return (
    `<div class="kfp-starting">` +
      `<label>${t("KFP.Panel.StartingChoice.Label")}</label>` +
      `<select class="kfp-starting-select">` +
        `<option value="">—</option>` +
        option(MOVES.NEUTRAL_TO_LIGHT, "KFP.Panel.StartingChoice.Light", canFlip) +
        option(MOVES.NEUTRAL_TO_DARK, "KFP.Panel.StartingChoice.Dark", canFlip) +
        option("none", "KFP.Panel.StartingChoice.None") +
      `</select>` +
    `</div>`
  );
}

/**
 * The panel. On the Codex sheet it is built as a real `cdx-panel` with a `cdx-panel-head`
 * rather than styled to look like one: those classes draw entirely from the scheme's CSS
 * variables (`--cdx-paper2`, `--cdx-line`, `--cdx-clip`, `--cdx-brown`), so the card
 * follows whichever Codex theme the user picked without the module knowing any of them.
 */
function panelHtml(state, editable, isCodex) {
  const body =
    scaleHtml(state) +
    `<div class="kfp-steppers">` +
      `<span class="kfp-stepper"><label>${t("KFP.Scale.Dark")}</label>${stepperHtml("dark", state.dark, editable)}</span>` +
      `<span class="kfp-stepper"><label>${t("KFP.Scale.Light")}</label>${stepperHtml("light", state.light, editable)}</span>` +
    `</div>` +
    tallyHtml(state, editable) +
    startingChoiceHtml(state, editable) +
    notesHtml(state);

  if (isCodex) {
    return (
      `<div class="${PANEL_CLASS} kfp-codex cdx-panel">` +
        `<div class="cdx-panel-head">${t("KFP.Title")}</div>` +
        `<div class="kfp-body">${body}</div>` +
      `</div>`
    );
  }

  return (
    `<div class="${PANEL_CLASS}">` +
      `<div class="kfp-head">${t("KFP.Title")}</div>` +
      `<div class="kfp-body">${body}</div>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

/**
 * Where to put the panel. First match wins, and the last option always exists, so the
 * panel can never silently fail to render.
 *
 * @returns {{node: Element, how: "after"|"append"|"before"}|null}
 */
function findAnchor(element, isCodex) {
  if (isCodex) {
    // Below the Morality / Conflict row, not inside it. `.cdx-bio-stats` is a flex row
    // whose children are sized `flex: 1`, so anchoring to the Conflict panel would make
    // the scale a fourth column squeezed in beside three number boxes.
    const bioStats = element.querySelector(".cdx-bio-stats");
    if (bioStats) return { node: bioStats, how: "after" };

    // That row is gated by an {{#if}} and can be absent; this wrapper is not.
    const soft = element.querySelector(".cdx-float-soft-wrap");
    if (soft) return { node: soft, how: "before" };
  } else {
    const conflict = element.querySelector('input[name="data.conflict.value"]');
    const block = conflict?.closest(".resource");
    if (block) return { node: block, how: "after" };

    // Rendered unconditionally; only the boxes inside it are gated.
    const tab = element.querySelector('.tab[data-tab="obligation"]');
    if (tab) return { node: tab, how: "append" };
  }

  const root = element.querySelector(".sheet-body, .window-content") ?? element;
  if (root) {
    console.warn(`${MODULE_ID} | no preferred anchor on this sheet; appending to the sheet body.`);
    return { node: root, how: "append" };
  }
  return null;
}

function place(anchor, node) {
  if (anchor.how === "after") anchor.node.after(node);
  else if (anchor.how === "before") anchor.node.before(node);
  else anchor.node.append(node);
}

/**
 * The Morality score has no meaning under these rules, so its input is locked rather
 * than left editable for a GM to set a number that does nothing. The module never
 * writes `system.morality.value`.
 */
function lockMoralityInput(element) {
  const input = element.querySelector('input[name="data.morality.value"]');
  if (!input) return;
  input.readOnly = true;
  input.classList.add("kfp-locked");
  input.dataset.tooltip = t("KFP.Panel.MoralityUnused");
}

/**
 * Drive the Codex Force chip's colour from the scale, always explicitly.
 *
 * A derived Morality mirror was tried and rejected: it encodes only `light - dark`, so
 * 7 Dark / 3 Light mapped to 30, which that sheet reads as neutral, and ten Dark mapped
 * to 0, which it reads as untracked. Setting the class directly is threshold-exact.
 *
 * All three states are set, never left alone: a stale `good` from a converted score
 * would otherwise survive losing a Light point and contradict the panel beside it.
 */
function applyAlignmentClass(element, scale) {
  const chip = element.querySelector(".cdx-chip.derived.cdx-ratio.force");
  if (!chip) return;
  chip.classList.remove("cdx-align-neutral", "cdx-align-good", "cdx-align-evil");
  chip.classList.add(`cdx-align-${alignmentClass(scale)}`);
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

const clamp = (n, min, max) => Math.min(Math.max(Math.trunc(Number(n) || 0), min), max);

async function stepScale(actor, kind, delta) {
  const { dark, light } = normalize({
    dark: actor.getFlag(MODULE_ID, FLAGS.DARK),
    light: actor.getFlag(MODULE_ID, FLAGS.LIGHT),
  });
  const next = { dark, light };
  // Clamp against the OTHER count so the ten-point invariant holds whichever is stepped.
  if (kind === "dark") next.dark = clamp(dark + delta, 0, TOTAL_POINTS - light);
  else next.light = clamp(light + delta, 0, TOTAL_POINTS - dark);
  if (next.dark === dark && next.light === light) return;

  await actor.update({
    [`flags.${MODULE_ID}.${FLAGS.DARK}`]: next.dark,
    [`flags.${MODULE_ID}.${FLAGS.LIGHT}`]: next.light,
    [`flags.${MODULE_ID}.${FLAGS.INITIALIZED}`]: true,
  });
}

async function setTally(actor, which, value) {
  const n = clamp(value, 0, Number.MAX_SAFE_INTEGER);
  if (which === "conflict") {
    if (n === (Number(actor.system?.conflict?.value) || 0)) return;
    // Reuses the system's own Conflict field, so the sheet's existing box stays in sync.
    await actor.update({ "system.conflict.value": n });
    return;
  }
  if (n === (Number(actor.getFlag(MODULE_ID, FLAGS.TRANQUILITY)) || 0)) return;
  await actor.setFlag(MODULE_ID, FLAGS.TRANQUILITY, n);
}

async function takeStartingChoice(actor, choice) {
  const { dark, light } = normalize({
    dark: actor.getFlag(MODULE_ID, FLAGS.DARK),
    light: actor.getFlag(MODULE_ID, FLAGS.LIGHT),
  });
  const update = {
    [`flags.${MODULE_ID}.${FLAGS.STARTING_CHOICE_TAKEN}`]: true,
    [`flags.${MODULE_ID}.${FLAGS.INITIALIZED}`]: true,
  };
  if (choice === MOVES.NEUTRAL_TO_LIGHT) update[`flags.${MODULE_ID}.${FLAGS.LIGHT}`] = light + 1;
  else if (choice === MOVES.NEUTRAL_TO_DARK) update[`flags.${MODULE_ID}.${FLAGS.DARK}`] = dark + 1;
  else if (choice !== "none") return;
  await actor.update(update);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function activateListeners(panel, actor) {
  for (const step of panel.querySelectorAll("[data-kfp-step]")) {
    step.addEventListener("click", (event) => {
      event.preventDefault();
      stepScale(actor, step.dataset.kfpStep, Number(step.dataset.kfpDelta));
    });
  }

  for (const input of panel.querySelectorAll("[data-kfp-tally]")) {
    input.addEventListener("change", (event) => {
      event.stopPropagation(); // not ours to submit through the sheet's form
      setTally(actor, input.dataset.kfpTally, input.value);
    });
  }

  const select = panel.querySelector(".kfp-starting-select");
  select?.addEventListener("change", async (event) => {
    event.stopPropagation();
    const choice = select.value;
    if (!choice) return;
    const label = select.selectedOptions[0]?.textContent ?? choice;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("KFP.Panel.StartingChoice.Label") },
      content: `<p>${t("KFP.Panel.StartingChoice.Confirm", { choice: label })}</p>`,
    });
    if (!ok) {
      select.value = "";
      return;
    }
    await takeStartingChoice(actor, choice);
  });
}

/**
 * Should this sheet get a panel at all?
 * Character actors only, on the player-facing sheets, for Force users -- or for anyone
 * the module already holds state for, so state is never orphaned invisibly.
 */
function applies(app, actor) {
  if (actor?.type !== "character") return false;
  const cls = app?.constructor?.name ?? "";
  if (/Adversary/.test(cls)) return false; // NPC tool
  if (/V2$/.test(cls)) return false; // deprecated duplicate sheets
  if (game.system?.id !== "starwarsffg") return false;
  return isForceUser(actor) || hasState(actor);
}

export function registerSheetPanel() {
  Hooks.on("renderActorSheetV2", (app, element, _context, _options) => {
    try {
      const actor = app?.document ?? app?.actor;
      if (!element || !actor || !applies(app, actor)) return;

      const root = element instanceof HTMLElement ? element : element?.[0];
      if (!root) return;

      // The sheet re-renders on every actor update, so clear our own first.
      for (const stale of root.querySelectorAll(`.${PANEL_CLASS}`)) stale.remove();

      const isCodex = root.classList?.contains("cdx") || !!root.querySelector(".cdx-panel");
      const state = readState(actor);
      const editable = !!actor.isOwner && app.isEditable !== false;

      lockMoralityInput(root);
      if (isCodex) applyAlignmentClass(root, state);

      const anchor = findAnchor(root, isCodex);
      if (!anchor) {
        console.error(`${MODULE_ID} | could not place the Force Presence panel on this sheet.`);
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.innerHTML = panelHtml(state, editable, isCodex);
      const panel = wrapper.firstElementChild;
      if (!panel) return;

      place(anchor, panel);
      if (editable) activateListeners(panel, actor);
    } catch (err) {
      // A module must never break someone's character sheet.
      console.error(`${MODULE_ID} | sheet panel failed`, err);
    }
  });
}
