/**
 * Module entry point.
 *
 * SCAFFOLD STATE: the pure rules core, the sweep state machine and the character sheet
 * panel are built. Still TODO:
 *
 *   - scripts/gm-window.js     standalone Application + scene control      TODO
 *   - scripts/transport.js     socketlib handshake + the response deadline TODO
 *
 * So the end-of-session sweep cannot be run from the UI yet, though its logic is
 * implemented and tested.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import * as rules from "./rules.js";
import { createSweep } from "./sweep.js";
import { registerSheetPanel } from "./sheet-panel.js";

Hooks.once("init", () => {
  // Pass the i18n KEYS, not localized strings. Foundry localizes a setting's name and
  // hint when the settings form renders (its SettingsConfig does
  // `label ||= _loc(setting.name)`), by which point every language file is loaded.
  // Localizing here instead bakes in whatever was available at init -- and if the
  // module's own lang file has not loaded yet, that is the raw key, permanently, for
  // the rest of the session. It also breaks the lang hot-reload this module declares.
  game.settings.register(MODULE_ID, SETTINGS.PUBLIC_CARDS, {
    name: "KFP.Settings.PublicCards.Name",
    hint: "KFP.Settings.PublicCards.Hint",
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

  registerSheetPanel();

  // Console handle for inspection while the remaining adapters are unbuilt.
  const self = game.modules.get(MODULE_ID);
  if (self) self.api = { rules, createSweep };
});

Hooks.once("ready", () => {
  if (game.system.id !== "starwarsffg") {
    console.warn(`${MODULE_ID} | inactive: this module is for the starwarsffg system.`);
    return;
  }
  console.log(`${MODULE_ID} | sheet panel active. GM window and sweep transport not yet wired.`);
});
