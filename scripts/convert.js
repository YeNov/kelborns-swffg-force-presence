/**
 * Seeding Balance scales from existing base-game Morality scores, for a campaign
 * switching to these rules mid-stream.
 *
 * GM-only, and NEVER automatic. Converting on module activation would rewrite every
 * Force user's alignment the moment someone ticked a checkbox.
 *
 * The dangerous case this guards is an UNTRACKED actor. The system defaults
 * `morality.value` to 0 and reads 0-with-no-Morality-entries as "not tracked", and only
 * the PC Wizard writes a starting score (`defaultMorality`, 50). So a manually created
 * or imported Force user sits at 0 -- and a naive seed would convert an entirely
 * ordinary character into a maximally fallen one and mark the scale initialized, beyond
 * correction. `classifyForConversion` refuses; this module reports what it refused.
 */

import { MODULE_ID, FLAGS } from "./constants.js";
import { classifyForConversion } from "./rules.js";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Morality entries are `obligation` items whose `system.type` names the track. */
function moralityEntryCount(actor) {
  return actor.items.filter((i) => i.type === "obligation" && i.system?.type === "morality").length;
}

/**
 * Classify a set of actors without writing anything. Exposed so the GM window can show
 * the outcome before committing.
 *
 * @param {Actor[]} actors
 * @returns {{seed: Array<{actor: Actor, scale: object}>, skippedInitialized: Actor[], skippedUntracked: Actor[]}}
 */
export function planConversion(actors) {
  const seed = [];
  const skippedInitialized = [];
  const skippedUntracked = [];

  for (const actor of actors) {
    const { action, scale } = classifyForConversion({
      initialized: !!actor.getFlag(MODULE_ID, FLAGS.INITIALIZED),
      score: actor.system?.morality?.value,
      moralityEntryCount: moralityEntryCount(actor),
    });
    if (action === "seed") seed.push({ actor, scale });
    else if (action === "skip-initialized") skippedInitialized.push(actor);
    else skippedUntracked.push(actor);
  }

  return { seed, skippedInitialized, skippedUntracked };
}

/**
 * Run the conversion after confirmation, and report all three groups separately so the
 * GM can see what was converted and what was deliberately left alone rather than
 * guessing from a single count.
 *
 * @param {Actor[]} actors
 * @returns {Promise<boolean>} whether anything was written
 */
export async function runConversion(actors) {
  const plan = planConversion(actors);

  if (!plan.seed.length) {
    ui.notifications.info(
      t("KFP.Convert.NothingToDo", {
        initialized: plan.skippedInitialized.length,
        untracked: plan.skippedUntracked.length,
      }),
    );
    return false;
  }

  const rows = plan.seed
    .map(({ actor, scale }) => `<li>${actor.name}: ${scale.dark} ${t("KFP.Scale.Dark")} / ${scale.light} ${t("KFP.Scale.Light")}</li>`)
    .join("");
  const skipped = [];
  if (plan.skippedInitialized.length) {
    skipped.push(`<p>${t("KFP.Convert.SkippedInitialized", { count: plan.skippedInitialized.length })}</p>`);
  }
  if (plan.skippedUntracked.length) {
    skipped.push(`<p>${t("KFP.Convert.SkippedUntracked", { count: plan.skippedUntracked.length })}</p>`);
  }

  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("KFP.Convert.Title") },
    content:
      `<p>${t("KFP.Convert.Lead")}</p><ul>${rows}</ul>` +
      skipped.join("") +
      `<p class="kfp-card-quiet">${t("KFP.Convert.Lossy")}</p>`,
    rejectClose: false,
  });
  if (!ok) return false;

  for (const { actor, scale } of plan.seed) {
    try {
      await actor.update({
        [`flags.${MODULE_ID}.${FLAGS.DARK}`]: scale.dark,
        [`flags.${MODULE_ID}.${FLAGS.LIGHT}`]: scale.light,
        [`flags.${MODULE_ID}.${FLAGS.INITIALIZED}`]: true,
      });
    } catch (err) {
      console.error(`${MODULE_ID} | conversion failed for ${actor.name}`, err);
      ui.notifications.error(t("KFP.Convert.Failed", { name: actor.name }));
    }
  }

  ui.notifications.info(t("KFP.Convert.Seeded", { count: plan.seed.length }));
  return true;
}
