/**
 * Module entry point.
 *
 * Layers, outermost last:
 *
 *   rules.js / sweep.js    pure -- no Foundry, no I/O, covered by `node --test`
 *   actors.js resolve.js   document reads and writes
 *   transport.js           socketlib, plus the response deadline socketlib lacks
 *   sheet-panel.js         renderActorSheetV2 injection
 *   gm-window.js           the GM's Application, and the sweep orchestration
 *   main.js                registration only
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import * as rules from "./rules.js";
import { createSweep } from "./sweep.js";
import { registerSheetPanel } from "./sheet-panel.js";
import { registerTransport } from "./transport.js";
import { registerGmWindow, openForcePresenceWindow } from "./gm-window.js";

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
  registerGmWindow();
  registerTransport();

  const self = game.modules.get(MODULE_ID);
  if (self) self.api = { rules, createSweep, openWindow: openForcePresenceWindow };
});

Hooks.once("ready", () => {
  if (game.system.id !== "starwarsffg") {
    console.warn(`${MODULE_ID} | inactive: this module is for the starwarsffg system.`);
    return;
  }

  // A sweep lives on the GM client that started it. If that client reloaded or crashed
  // mid-sweep the lock survives in world settings with nothing driving it, so say so
  // rather than letting the next sweep be refused with no explanation.
  if (game.user.isGM) {
    const open = game.settings.get(MODULE_ID, SETTINGS.OPEN_SWEEP);
    if (open) {
      ui.notifications.warn(
        game.i18n.format("KFP.Sweep.AlreadyOpen", {
          gm: game.users.get(open.gmUserId)?.name ?? "?",
        }),
      );
    }
  }
});
