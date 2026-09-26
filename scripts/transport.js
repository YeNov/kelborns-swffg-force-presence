/**
 * The GM <-> player handshake for the end-of-session sweep, over socketlib.
 *
 * WHY THE DEADLINE LIVES HERE AND NOT IN SOCKETLIB: socketlib has no response timer.
 * `grep -i timeout` over its source returns nothing. It rejects when a recipient
 * *disconnects* and on remote exceptions, but a player who is connected and simply
 * leaves the prompt open leaves the promise pending forever. Without our own deadline a
 * single distracted player would hold a sweep open indefinitely.
 *
 * A timeout is NOT a resolution. It returns `null`, which the caller turns into
 * `sweep.deadline(actorId)` -- moving the row to the GM, who still has to choose. See
 * scripts/sweep.js.
 */

import { MODULE_ID } from "./constants.js";

/**
 * How long a player has before their row falls to the GM. A constant rather than a
 * setting: the GM can claim any waiting row at any moment from their window, so this is
 * only a backstop for someone who has walked away, not a pace the table has to agree on.
 */
export const PROMPT_DEADLINE_MS = 180_000;

let socket = null;

/** Prompts open on THIS client, keyed `sweepId:actorId`, so the GM can cancel them. */
const openPrompts = new Map();

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/* ------------------------------------------------------------------ *
 * Player side
 * ------------------------------------------------------------------ */

/**
 * Ask this client's user to choose their move. Runs on the OWNING player's machine,
 * invoked by the GM through socketlib.
 *
 * Returns the chosen move, or null if they dismissed it or the GM cancelled. Returning
 * null is safe: the GM's state machine treats it exactly like a timeout.
 *
 * @param {{sweepId: string, actorId: string, actorName: string, direction: string,
 *          options: string[], conflict: number, tranquility: number}} payload
 * @returns {Promise<string|null>}
 */
async function onAskChoice(payload) {
  const key = `${payload.sweepId}:${payload.actorId}`;
  if (openPrompts.has(key)) return null; // already asked on this client

  const buttons = payload.options.map((move, index) => ({
    action: move,
    label: t(`KFP.Move.${move}`),
    default: index === 0, // the plan's pre-selected default: neutral-to-light / -dark
  }));

  const summary = t("KFP.Prompt.Summary", {
    conflict: payload.conflict,
    tranquility: payload.tranquility,
  });
  const lead = t(
    payload.direction === "light" ? "KFP.Prompt.Lead.Light" : "KFP.Prompt.Lead.Dark",
    { name: payload.actorName },
  );

  try {
    const chosen = await new Promise((resolve) => {
      // `options.submit` receives the clicked button's `action` when the button has no
      // callback of its own (DialogV2#_onSubmit: `(await button?.callback?.(…)) ?? button?.action`).
      const dialog = new foundry.applications.api.DialogV2({
        window: { title: t("KFP.Sweep.Title") },
        content: `<p>${lead}</p><p class="kfp-prompt-summary">${summary}</p>`,
        buttons,
        rejectClose: false,
        submit: (result) => resolve(result),
      });

      // A dismissal must read as "no answer", not as an error. DialogV2 honours no close
      // callback, so wrap `close` instead of depending on an option that is not wired.
      // Resolving twice is harmless -- the first value wins -- so a button click
      // followed by the dialog closing still returns the choice.
      const close = dialog.close.bind(dialog);
      dialog.close = async (...args) => {
        resolve(null);
        return close(...args);
      };

      openPrompts.set(key, dialog);
      dialog.render({ force: true });
    });

    return payload.options.includes(chosen) ? chosen : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | prompt failed`, err);
    return null;
  } finally {
    openPrompts.delete(key);
  }
}

/** The GM claimed or timed out this row: close the prompt so it does not linger. */
function onCancelPrompt({ sweepId, actorId } = {}) {
  const key = `${sweepId}:${actorId}`;
  const dialog = openPrompts.get(key);
  if (!dialog) return;
  openPrompts.delete(key);
  try {
    dialog.close();
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ *
 * GM side
 * ------------------------------------------------------------------ */

/** Resolve `null` once `ms` has passed, whatever the wrapped promise is doing. */
function withDeadline(promise, ms) {
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Ask one player for their move, giving up after the deadline.
 *
 * Every failure mode collapses to `null`, because they are all the same thing to the
 * caller: nobody answered, so the row belongs to the GM. A disconnect rejects (socketlib
 * does handle that), an exception on their client rejects, a dismissal resolves null,
 * and a silent player hits the deadline.
 *
 * @returns {Promise<string|null>} the chosen move, or null
 */
export async function askPlayer(userId, payload, ms = PROMPT_DEADLINE_MS) {
  if (!socket) {
    console.warn(`${MODULE_ID} | socketlib unavailable; every row falls to the GM.`);
    return null;
  }
  const ask = socket.executeAsUser("askChoice", userId, payload).catch((err) => {
    console.warn(`${MODULE_ID} | prompt to ${userId} failed`, err);
    return null;
  });
  return withDeadline(ask, ms);
}

/** Best-effort: close a prompt we are no longer going to honour. */
export function cancelPlayerPrompt(userId, sweepId, actorId) {
  if (!socket) return;
  socket.executeAsUser("cancelPrompt", userId, { sweepId, actorId }).catch(() => {
    /* the client may already be gone; nothing to do */
  });
}

export function isTransportReady() {
  return !!socket;
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

/**
 * Attach to socketlib, whichever order the two modules happened to initialise in.
 *
 * socketlib fires `socketlib.ready` from inside ITS OWN `init` hook. This module calls
 * `registerTransport()` from inside `init` too, so if socketlib's handler ran first the
 * event has already fired and a `Hooks.once` registered now would never be called --
 * leaving `socket` null and every sweep row silently falling to the GM with
 * "socketlib unavailable". Hook ordering between two modules is not something either of
 * them controls, so do not depend on it: listen for the event AND try immediately, since
 * if it has already fired the global is already there.
 */
function attach() {
  if (socket) return true;
  if (typeof socketlib === "undefined") return false;
  try {
    socket = socketlib.registerModule(MODULE_ID);
    socket.register("askChoice", onAskChoice);
    socket.register("cancelPrompt", onCancelPrompt);
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | socketlib registration failed`, err);
    return false;
  }
}

export function registerTransport() {
  Hooks.once("socketlib.ready", attach); // socketlib initialised after us
  attach(); // ...or before us, in which case the event is already gone

  Hooks.once("ready", () => {
    if (attach()) return;
    // Not fatal: the sweep still works, every row just falls to the GM. Say so once,
    // clearly, rather than only at the point a sweep is started.
    console.warn(
      `${MODULE_ID} | socketlib is not available. The end-of-session sweep cannot ask ` +
        `players to choose; every row will fall to the GM.`,
    );
  });
}
