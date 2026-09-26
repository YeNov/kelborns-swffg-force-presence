/**
 * Which actors these rules apply to.
 *
 * The Force-user test is the system's OWN predicate, reused verbatim rather than
 * inventing a per-actor toggle: the `enableForcePool` sheet option not explicitly off,
 * AND an actual Force pool rating or Force power items. It is the same rule the Codex
 * sheet uses to decide whether to show its Morality box, so a character who sees one
 * sees the other.
 *
 * `enableForcePool` is checked with `!== false` on purpose: the option defaults to true
 * but is only written to the flag once the sheet options are saved, so a freshly created
 * or wizard-built actor has it undefined.
 */

import { MODULE_ID } from "./constants.js";

export function isForceUser(actor) {
  if (actor?.flags?.starwarsffg?.config?.enableForcePool === false) return false;
  const pool = Number(actor?.system?.stats?.forcePool?.max) || 0;
  if (pool > 0) return true;
  return actor?.items?.some?.((i) => i.type === "forcepower") ?? false;
}

/**
 * Does the module already hold state for this actor? Such an actor always counts, even
 * if they somehow stopped reading as a Force user, so state is never orphaned invisibly.
 */
export function hasState(actor) {
  const flags = actor?.flags?.[MODULE_ID];
  return !!flags && Object.keys(flags).length > 0;
}

export function tracksForcePresence(actor) {
  return actor?.type === "character" && (isForceUser(actor) || hasState(actor));
}

/**
 * Every character these rules apply to, sorted by name.
 *
 * Deliberately not limited to actors with a player assigned: an absent player's
 * character still accrues Conflict and still has to be resolved, and the GM owns that
 * row. Filtering by assigned user would quietly drop them from the sweep.
 */
export function forcePresenceActors() {
  return game.actors
    .filter((actor) => tracksForcePresence(actor))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The connected non-GM owner of an actor, if any -- who the sweep prompts. */
export function ownerUser(actor) {
  const owners = game.users.filter(
    (user) => !user.isGM && actor.testUserPermission(user, "OWNER"),
  );
  return owners.find((user) => user.active) ?? owners[0] ?? null;
}
