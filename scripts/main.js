/**
 * Module entry point.
 *
 * SCAFFOLD STATE: the pure rules core and the sweep state machine are implemented and
 * tested (`node --test`, 59 assertions). The Foundry-facing adapters are NOT yet built:
 *
 *   - scripts/sheet-panel.js   renderActorSheetV2 injection, both sheets   TODO
 *   - scripts/gm-window.js     standalone Application + scene control      TODO
 *   - scripts/transport.js     socketlib handshake + the response deadline TODO
 *
 * Until those land this registers the module's settings and exposes the pure API for
 * inspection from the console. It deliberately does not touch a sheet or an actor, so
 * installing it at this stage changes nothing in a world.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import * as rules from "./rules.js";
import { createSweep } from "./sweep.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTINGS.PUBLIC_CARDS, {
    name: game.i18n.localize("KFP.Settings.PublicCards.Name"),
    hint: game.i18n.localize("KFP.Settings.PublicCards.Hint"),
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  // The open sweep, so a second GM cannot start an overlapping one and a crashed GM's
  // sweep can be force-closed. Shape: {sweepId, gmUserId, startedAt} or null.
  game.settings.register(MODULE_ID, SETTINGS.OPEN_SWEEP, {
    scope: "world",
    config: false,
    default: null,
    type: Object,
  });

  // Console handle for inspection while the adapters are unbuilt.
  game.modules.get(MODULE_ID).api = { rules, createSweep };
});

Hooks.once("ready", () => {
  if (game.system.id !== "starwarsffg") {
    console.warn(`${MODULE_ID} | inactive: this module is for the starwarsffg system.`);
    return;
  }
  console.log(`${MODULE_ID} | rules core loaded. Sheet panel and GM window not yet wired.`);
});
