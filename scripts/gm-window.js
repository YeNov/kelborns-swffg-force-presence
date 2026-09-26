/**
 * The GM's Force Presence window: the table's scales at a glance, the end-of-session
 * sweep, and the conversion tool.
 *
 * A standalone Application rather than a tab in the system's Group Manager. That was
 * tried on paper and abandoned: the Group Manager builds its tab nav from a hardcoded
 * `available` array and then resets `tabGroups.triggers` to the first entry whenever the
 * active tab is not in it -- and it re-renders on every actor update. An injected tab
 * would eject the GM from itself the instant anything changed. Its own window also gives
 * the sweep's per-row state somewhere honest to live.
 *
 * This class owns the live sweep. The state machine in scripts/sweep.js owns the rules;
 * everything here is transport, persistence and presentation around it.
 */

import { MODULE_ID, SETTINGS, ROW_STATES } from "./constants.js";
import { normalize, thresholds, renderScale, resolveSession } from "./rules.js";
import { createSweep } from "./sweep.js";
import { forcePresenceActors, ownerUser } from "./actors.js";
import { askPlayer, cancelPlayerPrompt, isTransportReady, PROMPT_DEADLINE_MS } from "./transport.js";
import { pipHtml, diceTheme } from "./pips.js";
import { applyResolution, postResolutionCard, postSweepSummary, readLive } from "./resolve.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

export class ForcePresenceWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "kfp-gm-window",
    classes: ["kfp-window"],
    tag: "div",
    window: { title: "KFP.Window.Title", icon: "fa-solid fa-circle-half-stroke", resizable: true },
    position: { width: 660, height: 560 },
    actions: {
      startSweep: ForcePresenceWindow.#onStartSweep,
      forceClose: ForcePresenceWindow.#onForceClose,
      convert: ForcePresenceWindow.#onConvert,
      takeover: ForcePresenceWindow.#onTakeover,
      choose: ForcePresenceWindow.#onChoose,
      retry: ForcePresenceWindow.#onRetry,
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: `modules/${MODULE_ID}/templates/gm-window.hbs`,
    },
  };

  /** The live sweep, or null when none is running on this client. */
  #sweep = null;

  /* ---------------------------------------------------------------- *
   * Context
   * ---------------------------------------------------------------- */

  async _prepareContext() {
    const open = game.settings.get(MODULE_ID, SETTINGS.OPEN_SWEEP);
    const openByOther = open && open.gmUserId !== game.user.id ? open : null;
    const openHere = open && this.#sweep && open.sweepId === this.#sweep.sweepId;

    return {
      isActiveGM: game.users.activeGM?.id === game.user.id,
      transportReady: isTransportReady(),
      hasSweep: !!openHere,
      openByOther: openByOther ? { gm: game.users.get(openByOther.gmUserId)?.name ?? "?" } : null,
      staleSweep: !!open && !openHere,
      rows: openHere ? this.#sweepRows() : this.#idleRows(),
      deadlineSeconds: Math.round(PROMPT_DEADLINE_MS / 1000),
    };
  }

  /** Rows outside a sweep: just where everyone stands. */
  #idleRows() {
    return forcePresenceActors().map((actor) => {
      const live = readLive(actor);
      return {
        actorId: actor.id,
        name: actor.name,
        ...this.#display(live),
        conflict: live.conflict,
        tranquility: live.tranquility,
        state: "idle",
        stateLabel: "",
        options: [],
        canTakeover: false,
        canRetry: false,
        error: null,
        preview: this.#preview(live),
      };
    });
  }

  /** Rows during a sweep, straight off the state machine. */
  #sweepRows() {
    return this.#sweep.all().map((row) => {
      const actor = game.actors.get(row.actorId);
      const prompted = row.state === ROW_STATES.PROMPTED;
      return {
        actorId: row.actorId,
        name: actor?.name ?? row.actorId,
        ...this.#display(row.scale),
        conflict: row.snapshot.conflict,
        tranquility: row.snapshot.tranquility,
        state: row.state,
        stateLabel: this.#stateLabel(row),
        options: row.state === ROW_STATES.GM_OWNED
          ? row.options.map((move) => ({ move, label: t(`KFP.Move.${move}`) }))
          : [],
        canTakeover: prompted,
        canRetry: row.state === ROW_STATES.FAILED,
        error: row.error,
        preview: "",
      };
    });
  }

  #display(scale) {
    const s = normalize(scale);
    const th = thresholds(s);
    const notes = [];
    if (th.consumed) notes.push(t("KFP.Window.Consumed"));
    else if (th.darkSide) notes.push(t("KFP.Window.DarkSide"));
    if (th.paragon) notes.push(t("KFP.Window.Paragon"));
    if (th.destinyFlip) notes.push(t("KFP.Window.DestinyFlip"));
    if (th.destinyBonus) notes.push(t("KFP.Window.DestinyBonus"));
    const theme = diceTheme();
    return {
      // Raw HTML: the template prints these with {{{ }}} so the system's symbol font
      // renders, matching the pips on the character sheets.
      points: renderScale(s).map((state) => pipHtml(state, theme, { solid: true })),
      counts: `${s.dark}/${s.neutral}/${s.light}`,
      thresholdText: notes.join(" · "),
    };
  }

  /** Outside a sweep, show what the end of session WOULD do, so nothing is a surprise. */
  #preview(live) {
    const outcome = resolveSession(live);
    if (outcome.direction === "none") return t("KFP.Window.PreviewNone");
    if (!outcome.options.length) return t("KFP.Window.PreviewNoMove");
    if (outcome.forced) return t("KFP.Window.PreviewForced", { move: t(`KFP.Move.${outcome.options[0]}`) });
    return t("KFP.Window.PreviewChoice");
  }

  #stateLabel(row) {
    switch (row.state) {
      case ROW_STATES.PROMPTED: {
        const actor = game.actors.get(row.actorId);
        const user = actor ? ownerUser(actor) : null;
        return t("KFP.Sweep.Waiting", { player: user?.name ?? "?" });
      }
      case ROW_STATES.GM_OWNED:
        return t("KFP.Sweep.YoursToChoose");
      case ROW_STATES.APPLYING:
        return t("KFP.Sweep.Applying");
      case ROW_STATES.RESOLVED:
        return t("KFP.Sweep.Resolved");
      case ROW_STATES.FAILED:
        return t("KFP.Sweep.Failed", { error: row.error ?? "" });
      default:
        return "";
    }
  }

  /* ---------------------------------------------------------------- *
   * The sweep
   * ---------------------------------------------------------------- */

  /**
   * Only the active GM may start a sweep -- the same restriction the system's destiny
   * handshake uses -- and only one may be open at a time, recorded in a world setting so
   * a second GM's window can see it.
   */
  async startSweep() {
    if (game.users.activeGM?.id !== game.user.id) {
      ui.notifications.warn(t("KFP.Sweep.NotActiveGM"));
      return;
    }
    const open = game.settings.get(MODULE_ID, SETTINGS.OPEN_SWEEP);
    if (open) {
      ui.notifications.warn(
        t("KFP.Sweep.AlreadyOpen", { gm: game.users.get(open.gmUserId)?.name ?? "?" }),
      );
      return;
    }

    const actors = forcePresenceActors();
    if (!actors.length) {
      ui.notifications.info(t("KFP.Sweep.NoCharacters"));
      return;
    }

    const characters = actors.map((actor) => {
      const live = readLive(actor);
      const user = ownerUser(actor);
      return {
        actorId: actor.id,
        ...live,
        ownerUserId: user?.id ?? null,
        // No connected owner means the row is the GM's from the start. It still has to
        // be resolved -- an absent player's character is not skipped.
        ownerOnline: !!user?.active,
      };
    });

    const sweepId = foundry.utils.randomID();
    await game.settings.set(MODULE_ID, SETTINGS.OPEN_SWEEP, {
      sweepId,
      gmUserId: game.user.id,
      startedAt: Date.now(),
    });

    this.#sweep = createSweep({ sweepId, characters }).start();
    this.render();

    // Rows run independently: one player thinking does not hold up anyone else.
    await Promise.all(this.#sweep.all().map((row) => this.#runRow(row.actorId)));
    await this.#maybeClose();
  }

  /**
   * Drive one row until it is resolved, failed, or waiting on the GM.
   *
   * The loop re-reads the row's state every pass rather than trusting what it did last,
   * because the GM can take a row over mid-await and revalidation can send it backwards.
   */
  async #runRow(actorId) {
    for (let guard = 0; guard < 24; guard += 1) {
      const row = this.#sweep?.row(actorId);
      if (!row) return;

      switch (row.state) {
        case ROW_STATES.APPLYING:
          await this.#applyRow(actorId);
          break;

        case ROW_STATES.PROMPTED: {
          const actor = game.actors.get(actorId);
          const user = actor ? ownerUser(actor) : null;
          if (!user) {
            this.#sweep.deadline(actorId);
            this.render();
            return;
          }
          const move = await askPlayer(user.id, {
            sweepId: this.#sweep.sweepId,
            actorId,
            actorName: actor.name,
            direction: row.direction,
            options: row.options,
            conflict: row.snapshot.conflict,
            tranquility: row.snapshot.tranquility,
          });

          if (move) {
            // Rejected if the GM claimed the row while we waited -- which is the point.
            const result = this.#sweep.answer(actorId, { sweepId: this.#sweep.sweepId, move });
            if (!result.accepted) return;
          } else {
            // A timeout supplies no choice: hand it to the GM, do not resolve it.
            cancelPlayerPrompt(user.id, this.#sweep.sweepId, actorId);
            this.#sweep.deadline(actorId);
            this.render();
            return;
          }
          break;
        }

        // Waiting on a human, or finished. Either way this driver is done.
        case ROW_STATES.GM_OWNED:
        case ROW_STATES.RESOLVED:
        case ROW_STATES.FAILED:
        default:
          this.render();
          return;
      }
    }
    console.warn(`${MODULE_ID} | row ${actorId} exceeded its transition budget`);
  }

  /**
   * Revalidate, then write. The row becomes `resolved` only once the write persists; a
   * failure lands in `failed`, which holds the sweep open rather than skipping anyone.
   */
  async #applyRow(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) {
      this.#sweep.failed(actorId, new Error(t("KFP.Sweep.ActorMissing")));
      this.render();
      return;
    }

    // Conflict or Tranquility may have moved while a prompt was open -- a mid-sweep
    // award can reverse the direction outright -- and the owner may have edited their
    // own scale. Either invalidates the chosen move.
    const reval = this.#sweep.revalidate(actorId, readLive(actor));
    if (reval.reset) {
      ui.notifications.info(t("KFP.Sweep.Reset"));
      this.render();
      return;
    }

    const row = this.#sweep.row(actorId);
    try {
      const outcome = await applyResolution(actor, row.move);
      this.#sweep.applied(actorId);
      await postResolutionCard(actor, outcome);
    } catch (err) {
      console.error(`${MODULE_ID} | applying ${actor.name} failed`, err);
      this.#sweep.failed(actorId, err);
    }
    this.render();
  }

  /** Close the sweep only when every row has persisted. */
  async #maybeClose() {
    if (!this.#sweep) return;
    const unresolved = this.#sweep.unresolved();
    if (unresolved.length) {
      this.render();
      return;
    }
    const failed = this.#sweep
      .all()
      .filter((row) => row.state === ROW_STATES.FAILED)
      .map((row) => game.actors.get(row.actorId)?.name ?? row.actorId);
    const resolved = this.#sweep.all().length - failed.length;

    await game.settings.set(MODULE_ID, SETTINGS.OPEN_SWEEP, null);
    await postSweepSummary({ resolved, failed });
    this.#sweep = null;
    this.render();
  }

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */

  static async #onStartSweep() {
    await this.startSweep();
  }

  /**
   * Release a sweep whose owning GM crashed or disconnected. Resolved rows stay
   * resolved -- this clears the lock, it does not undo anything.
   */
  static async #onForceClose() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("KFP.Sweep.ForceClose") },
      content: `<p>${t("KFP.Sweep.ForceCloseConfirm")}</p>`,
      rejectClose: false,
    });
    if (!ok) return;
    await game.settings.set(MODULE_ID, SETTINGS.OPEN_SWEEP, null);
    this.#sweep = null;
    this.render();
  }

  static async #onConvert() {
    const { runConversion } = await import("./convert.js");
    await runConversion(forcePresenceActors());
    this.render();
  }

  static async #onTakeover(_event, target) {
    const actorId = target.dataset.actorId;
    if (!this.#sweep?.takeover(actorId)) return;
    const actor = game.actors.get(actorId);
    const user = actor ? ownerUser(actor) : null;
    if (user) cancelPlayerPrompt(user.id, this.#sweep.sweepId, actorId);
    this.render();
  }

  static async #onChoose(_event, target) {
    const { actorId, move } = target.dataset;
    if (!this.#sweep?.gmChoose(actorId, move).accepted) return;
    this.render();
    await this.#runRow(actorId);
    await this.#maybeClose();
  }

  static async #onRetry(_event, target) {
    const actorId = target.dataset.actorId;
    if (!this.#sweep?.retry(actorId)) return;
    this.render();
    await this.#runRow(actorId);
    await this.#maybeClose();
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

let instance = null;

/**
 * Open the window, and never fail silently.
 *
 * A scene-control button that does nothing when clicked is the least debuggable failure
 * in Foundry: the click dispatches, the callback throws, and the exception dies inside
 * core's handler with no UI. Surface it instead.
 */
export function openForcePresenceWindow() {
  try {
    instance ??= new ForcePresenceWindow();
    instance.render({ force: true });
    return instance;
  } catch (err) {
    instance = null; // a half-constructed application must not be reused
    console.error(`${MODULE_ID} | could not open the Force Presence window`, err);
    ui.notifications.error(`Force Presence: ${err.message}`);
    return null;
  }
}

/**
 * A scene control, rather than an entry in the system's destiny-tracker context menu:
 * that menu is a local const passed into the tracker and cannot be extended without
 * patching. `getSceneControlButtons` is core Foundry and costs the system nothing.
 *
 * THE SCENE CONTROL IS CANVAS-GATED, and deliberately remains the only entry point.
 * Foundry opens every tool click with `if ( !canvas.ready ) return;`
 * (scene-controls.mjs #onChangeTool), so with no scene loaded the button renders, shows
 * its tooltip, and the click is discarded before the tool is ever consulted. Nothing
 * about this window needs a canvas, so that is a Foundry constraint rather than a real
 * one -- but a silent no-op is indistinguishable from a broken module, so the click is
 * intercepted and explained instead of vanishing.
 */
export function registerGmWindow() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const tools = controls.tokens?.tools;
    if (!tools) return;
    tools[MODULE_ID] = {
      name: MODULE_ID,
      // Documented as required, and used to sort the tool into the palette.
      order: 100,
      title: t("KFP.Window.Title"),
      icon: "fa-solid fa-circle-half-stroke",
      button: true,
      onChange: (event) => {
        event?.preventDefault?.();
        openForcePresenceWindow();
      },
    };
  });

  // The toast CANNOT come from the tool's own onChange. Core returns at
  // `if ( !canvas.ready ) return;` before it ever dispatches to the tool, so with no
  // scene the callback is never reached -- which is exactly why the button looked dead.
  // Intercept the click on the button element instead, in the capture phase, so it runs
  // before core's delegated handler discards it.
  Hooks.on("renderSceneControls", (_app, element) => {
    if (!game.user.isGM) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    const button = root?.querySelector(`button[data-tool="${MODULE_ID}"]`);
    if (!button || button.dataset.kfpBound === "1") return;
    button.dataset.kfpBound = "1";

    button.addEventListener(
      "click",
      (event) => {
        if (canvas?.ready) return; // core will dispatch to onChange as normal
        event.preventDefault();
        event.stopPropagation();
        ui.notifications.error("KFP.Window.NoCanvas", { localize: true, permanent: true });
      },
      { capture: true },
    );
  });
}
