# Tranquility and Force Presence — SWFFG Add-on Module

Design doc for `kelborns-swffg-force-presence`. Implements the *Tranquility and Force
Presence* optional rules from the reSpecialized project's **Optional Morality Rules**
(credited in the source to contributor **Nori**), as an add-on to the `starwarsffg`
system.

Status: implemented 2026-09-26. Every component in this document is built: the pure
rules core (§1), the sheet panel (§2), the GM window with the conversion tool (§3), the
sweep with its socketlib transport (§4), the creation control (§5), the display-only
reporting (§6) and the single setting (§7).

Two things this document describes that the implementation names differently:
`moralityMirror`/`fromMorality` became `alignmentClass`/`seedFromMorality` when the
mirror was dropped, and the response deadline lives in `scripts/transport.js` as a
constant (`PROMPT_DEADLINE_MS`, three minutes) rather than a setting, since the GM can
claim any waiting row by hand at any time.

---

## Goal

Replace the Force and Destiny **Morality score** with a ten-point **Force Presence
scale**, and add **Tranquility** as the counterweight to Conflict, for tables running
the reSpecialized optional rules.

Under these rules a character has ten Balance Points, each in one of three states —
Dark (●), Neutral (◑), Light (○). There is no Morality score and no end-of-session d10.
Instead, Conflict and Tranquility accrue during play, and at end of session the larger
one moves a single Balance Point.

**Out of scope: the Unified Conflict Roll** (the other optional rule on the same pages,
credited to **Ebak**). It keeps the Morality score and the d10, just rolls one for the
table instead of one per player. Force Presence deletes both, so the two rules are
mutually exclusive, not stackable. A separate module if ever wanted.

### The rules, as implemented

**Gameplay changes.** In place of choosing a Moral Strength and Weakness (FaD CRB p. 48),
characters start with ten Neutral Balance Points, then choose one of:

- +10 starting XP
- +2,500 starting credits
- +5 starting XP and +1,000 starting credits
- flip one Balance Point from Neutral to Light or Dark

**End of session.** Compare accumulated Conflict and Tranquility:

| Outcome | Effect |
|---|---|
| Conflict > Tranquility | One point **becomes Dark** — from Neutral, or from Light |
| Tranquility > Conflict | One point moves **one step lightward** — Dark→Neutral, or Neutral→Light |
| Equal | No change |

**Thresholds.** With only ten points, the two thresholds are mutually exclusive
(7 + 7 > 10), so a character is never both.

- **Dark Side Threshold** (≥7 Dark): strain threshold −2, wound threshold +2,
  generate ◑ using ●. At ≥9 Dark, flip one Destiny Point Light→Dark at the start of
  each session, after all rolls are completed.
- **10 Dark**: consumed by the dark side — seek redemption or become a GM-controlled
  NPC. Redemption requires reaching ≥7 Light.
- **Light Side Paragon Threshold** (≥7 Light): strain threshold +2; a Dark Side Force
  user is considered redeemed and generates using ○. At ≥9 Light, add one bonus Light
  Side point to the Destiny Pool at the start of each session, after all rolls.

---

## The Courtney contradiction — read this before touching the flip rule

**The source contradicts itself, and we deliberately follow the rule text over the
example's prose.** This is the single most likely thing for a future reader to "fix"
wrongly.

The rule text says a Conflict-dominant session moves a point "from Neutral to Dark,
**or Light to Dark**" — Light to Dark in one move, skipping Neutral. The worked
example's *prose* says the opposite: "from Light Side to Neutral or Neutral to Dark
Side."

The example's own **printed scales** settle it:

| | Start | Session | End |
|---|---|---|---|
| Alice | 1 Dark / 5 Neutral / 4 Light | 3 Conflict, 5 Tranquility | 1 / 4 / 5 — a Neutral went Light |
| Courtney | 0 / 0 / 10 Light | 7 Conflict, 2 Tranquility | **1 Dark** / 0 / 9 Light |
| David | 4 / 4 / 2 | 3 Conflict, 3 Tranquility | 4 / 4 / 2 — unchanged |

Courtney is decisive. She held **no Neutral points**. Under the example's prose
("Light Side to Neutral") she should have ended 0 Dark / 1 Neutral / 9 Light. She ends
with a filled Dark point. The rendered result matches the rule text; the example's
sentence is simply wrong.

The asymmetry is also what the design note in the source is explicitly justifying —
"This is to represent how difficult it is to achieve redemption from the Dark Side."
Falling is one move from anywhere; climbing back is one step at a time, so a Light
point lost takes two sessions to recover.

`tests/rules.test.js` pins all three characters. Do not change the flip rule without
changing those assertions first, and read this section again when you do.

---

## Why an add-on works cleanly

The system exposes enough to do this without patching anything:

- **`renderActorSheetV2`** is re-fired deliberately for modules. From
  `modules/apps/ffg-actor-sheet.js:64`: FFG sheets extend `DocumentSheetV2` directly, so
  the hook would never fire on its own; the system re-emits it because "modules that
  inject actor-sheet header controls hook the standard `renderActorSheetV2` anchor."
- **`system.conflict.value` already exists** in the actor schema
  (`modules/data/models/actor/character.js:51`) and is already an editable box on both
  sheets. The rules say Conflict is earned "exactly the same way as from the base game",
  so it is the same field — no duplicate.
- **Both sheets share selectors.** The classic sheet and the Codex sheet render from
  different templates, but both contain `input[name="data.morality.value"]` and
  `input[name="data.conflict.value"]`. One selector pair covers both.
- **The Force-user test already exists.** `modules/actors/codex-sheets.js:1393` gates its
  Morality box on `enableForcePool !== false && (forcePool.max > 0 || force-power items)`.
  We reuse that predicate verbatim rather than inventing a per-actor toggle.
- **`getSceneControlButtons`** is a core Foundry hook — the GM window needs nothing from
  the system at all.

### What we deliberately do not touch

- **The PC Wizard.** `STARTING_BONUS` and `STARTING_BONUS_OPTIONS` are `Object.freeze`d
  (`modules/char-creator/starting-bonus.js:21,39`) and `RULESET_KEYS` is frozen too, so a
  module cannot extend the table. Patching would mean wrapping `getStartingBonusOptions`,
  `applyStartingBonus`, *and* the point where the wizard writes `bonus.morality` onto the
  new actor, across a 2,000-line wizard. Not worth it — see Components §5.
- **The Group Manager.** Its tab nav is built from a hardcoded `available` array in
  `_prepareContext` (`modules/groupmanager-ffg.js:150`), followed by:

  ```js
  if (available.length && !available.some(([id]) => id === this.tabGroups.triggers))
    this.tabGroups.triggers = available[0][0];
  ```

  That window "re-renders on every actor update" (its own comment, line 44), so a
  DOM-injected tab would eject the GM on every change. Making it robust needs either a
  `_prepareContext` wrapper or a system hook. We use a standalone window instead.
- **Actor stats.** See "Tracker, not enforcer" below.

### Governing principle: a tracker, not an enforcer

The module owns the bookkeeping and **reports** mechanical consequences without applying
them. Display-only: the ±2 threshold effects, the session-start Destiny effects, the
10-Dark NPC rule, the 7-Light redemption gate, and pip generation.

Two reasons, one per clause:

1. **Pip generation is unenforceable anyway.** The system tallies Force-die `light` and
   `dark` pips (`modules/dice/pool.js:25-26`) but has no notion of which pips a given
   character may spend. Base FaD's "a dark side Force user generates Force points with ●"
   is not modelled anywhere. There is nothing to hook.
2. **Threshold effects would drift.** Every threshold change in the system uses
   `AE_MODES.ADD`, and `_preUpdate` recomputes the stored threshold as
   `this.system.stats.wounds.max - originalBrawn + updatedBrawn`
   (`modules/actors/actor-ffg.js:105-116`) — where `wounds.max` is **effect-applied**. A
   character carrying a `+2 wounds` effect who buys a Brawn rank gets that +2 baked into
   the stored baseline, and the effect adds it again. `+4`, silently. Same for Willpower
   and strain.

   **This is a pre-existing system bug, already reachable through species effects, and
   this module does not fix it — it avoids it.** Worth fixing in the system separately;
   logged under Open questions.

Consequence: the module never writes to actor stats. Its entire write surface is its own
flags plus `system.conflict.value` — two fields, one of them already ours.

---

## Data model

Conflict reuses the system field. Everything else lives in module flags under
`flags.kelborns-swffg-force-presence`.

| Where | Key | Meaning |
|---|---|---|
| system | `system.conflict.value` | Conflict this session (existing field, existing box) |
| flag | `tranquility` | Tranquility this session |
| flag | `dark` | Balance Points in the Dark state, 0–10 |
| flag | `light` | Balance Points in the Light state, 0–10 |
| flag | `startingChoiceTaken` | One-shot guard for the creation flip |
| flag | `initialized` | Set once the scale is real; guards the conversion tool |

`system.morality.value` is **never written.** See "No morality mirror" below.

Invariants: `dark >= 0`, `light >= 0`, `dark + light <= 10`. Neutral is
`10 - dark - light` and is never stored.

**Counts, not identities.** The scale renders sorted (Dark left, Neutral middle, Light
right) in every printed example, so a point has no identity and position is purely
presentational. Storing ten states would buy nothing and invite drift.

**Absent flags mean ten Neutral.** Nothing is written until something actually changes,
so enabling the module is a no-op on an untouched world. It is **not** fully reversible
once used — see "Uninstalling" below.

### No morality mirror — presentation only

**Superseded design (rejected 2026-09-26, after review).** The original plan mirrored a
derived score into `system.morality.value` as `50 + (light - dark) * 5` to keep the Codex
Force-chip alignment colour working. That formula is broken in four ways, all verified
against `cdxEffectiveAlignment` (`modules/actors/codex-sheets.js:321-329`):

| Scale | Mirror | Codex verdict | Wanted |
|---|---|---|---|
| 7 Dark / 3 Light | 30 | neutral (range is [30,70]) | evil |
| 7 Light / 3 Dark | 70 | neutral | good |
| 5 Light / 5 Neutral | 75 | **good** | neutral — paragon needs 7 |
| 10 Dark | 0 | **untracked** (`if (m <= 0) return s`) | evil |

It encodes only `light - dark`, so it cannot represent the scale, and the claimed
round-trip inverse was impossible: `{0,0}` and `{5,5}` both yield 50.

**Instead: the module sets the chip's CSS class directly.** The colour is driven purely
by `cdx-align-neutral|good|evil` on the chip element (`styles/cdx.css:397-399`), so on
Codex sheet render the module swaps that class from the scale, with explicit rules:

- ≥7 Dark → `cdx-align-evil`
- ≥7 Light → `cdx-align-good`
- otherwise → `cdx-align-neutral`

**The below-threshold case is set explicitly, not left alone.** An earlier revision said
"leave the system's own class untouched", which breaks the agreement it promised:
convert a Morality-85 character to 7 Light, then lose one Light to a Conflict session.
The panel stops reporting Paragon, but the untouched class is still `good`, derived from
a score of 85 that no longer means anything. The chip would contradict the panel on the
same sheet.

So while the module is active the chip is **always** driven by the scale, all three
states. This deliberately overrides a manually-set `codexAlignment` baseline: under these
rules the scale *is* the character's alignment, and a stale hand-set colour is exactly
what we don't want showing. Stated in the README so a GM who set one by hand knows why it
stopped applying.

No data write, threshold-exact by construction, and it cannot disagree with the panel.

This reverses part of decision #3 while *delivering what that decision was for*. It also
means nothing writes `system.morality.value`, so the `codexAlignment` flag is never
flipped behind the GM's back by the `updateActor` hook at
`modules/actors/codex-sheets.js:337-346`, and uninstall residue shrinks to module flags.
It does **not** make the Group Manager's Morality tab inert — see Edge cases.

The Morality input is still forced **read-only** while the module is active, with a
"not used under Force Presence" tooltip — the score has no meaning under these rules, and
leaving it editable invites a GM to set a number that does nothing.

---

## Components

### 1. `scripts/rules.js` — pure core, no Foundry

Documents in, plain data out — the same discipline as the system's
`modules/helpers/obligation-tracks.js` ("Pure on purpose"). No Foundry globals, so it
runs under `node --test`.

```
normalize({dark, light})            -> clamped, invariant-safe {dark, light, neutral}
resolveSession({dark, light, conflict, tranquility})
                                    -> {direction, options[], forced}
applyFlip({dark, light}, choice)    -> {dark, light}
thresholds({dark, light})           -> {darkSide, paragon, consumed, canRedeem,
                                        destinyFlip, destinyBonus, strain, wounds}
alignmentClass({dark, light})       -> "evil" | "good" | "neutral"   (always explicit)
seedFromMorality(score)             -> {dark, light} | null        one-way, lossy
renderScale({dark, light})          -> ordered glyph states, Dark→Neutral→Light
```

`seedFromMorality` is a **one-way, lossy** seed for a mid-campaign switch, not an
inverse of anything. A base-game Morality score is a single number and cannot encode a
three-state scale, so the seed produces a one-sided scale and leaves the rest Neutral:

```
score untracked -> null            // caller must not convert; see below
d = round((50 - score) / 5)        // positive when score < 50
d > 0  ->  {dark: min(d, 10),  light: 0}
d < 0  ->  {dark: 0, light: min(-d, 10)}
d === 0 -> {dark: 0, light: 0}     // ten Neutral
```

Examples: 50 → ten Neutral; 85 → 7 Light; 15 → 7 Dark; 100 → 10 Light. Rounding is
half-away-from-zero, so 52 → ten Neutral and 53 → 1 Light.

#### Untracked is not zero

**A score of 0 must never be seeded — it would produce ten Dark.** The system's schema
defaults `morality.value` to `0` (`modules/data/models/actor/character.js:50`) and treats
0 as *not tracked*, stated outright at `modules/actors/codex-sheets.js:315`: "Morality of
0 / unset is treated as 'not tracked' … a Force user who doesn't use the Morality system
isn't painted evil." Both `trackVisibility` and `buildMoralityList` use the same reading.

Note the split: a **wizard-built** FaD character gets `defaultMorality`, which defaults to
50 (`modules/swffg-main.js:493`), so it converts correctly to ten Neutral. A
**manually-created or imported** Force user sits at 0 — and the naive seed would convert
that entirely normal character into a maximally fallen one, then mark the scale
`initialized` so it could never be re-run.

The conversion tool therefore classifies each actor first, using the system's own test:

| Actor state | Action |
|---|---|
| `initialized` flag set | **Skipped** — the scale is already real |
| `morality === 0` and no Morality items → *untracked* | **Skipped**, left at the lazy ten-Neutral default. Not an error. |
| Otherwise (a genuine score) | Seed via `seedFromMorality`, set `initialized` |

`seedFromMorality` returns `null` for an untracked reading so the guard cannot be
bypassed by calling the pure function directly. The GM window reports the three groups
separately, so a GM can see what was converted and what was left alone rather than
guessing.

**There is no round-trip guarantee and no inverse test.** The seed is lossy by
construction.

`resolveSession` returns the *available* moves, not a decision:

- **Conflict > Tranquility** — `options` is `["neutral","light"]` filtered to states the
  character actually holds. Note `neutral` **dominates**: both choices add one Dark
  point, but only `neutral` preserves Light, so there is never a reason to pick `light`
  unless no Neutral remains. `forced: true` in that case — exactly Courtney.
- **Tranquility > Conflict** — `options` is `["dark","neutral"]` filtered likewise. A
  genuine choice: Alice held a Dark point and still chose Neutral→Light.
- **Equal** — `direction: "none"`, empty options.

### 2. `scripts/sheet-panel.js` — the character sheet panel

On `renderActorSheetV2`, for `character` actors on the classic and Codex sheets (skip the
two deprecated `…V2` sheets and the Adversary sheets — NPC tools), when the Force-user
predicate holds or module flags already exist:

- Force `input[name="data.morality.value"]` read-only, with tooltip — **when present.**
- Insert the panel at the first anchor that exists (below).

Panel contents: the ten-glyph scale; Conflict and Tranquility inputs; threshold status
text; the one-time starting-choice control.

#### Anchors — the panel must never be able to vanish

The Conflict/Morality inputs are **not** always rendered, so they cannot be the only
anchor. `trackVisibility` (`modules/helpers/obligation-tracks.js:73-85`) shows the
Morality/Conflict pair only on `editMode || forceUser || morality items || morality !== 0
|| conflict !== 0` — and the **classic sheet passes no `forceUser`**
(`modules/actors/actor-sheet-ffg.js:385` calls `obligationTrackContext(this.actor)`,
defaulting it to `false`), unlike Codex which passes it
(`modules/actors/codex-sheets.js:1402`).

So the exact state this module creates — a Force-rated character at ten Neutral, zero
Conflict, no Morality items — has **no** Morality or Conflict box on the classic sheet
outside Edit Mode. That is the normal starting state, not an edge case.

Anchor cascade, first match wins:

| Sheet | Preferred | Fallback (always present) |
|---|---|---|
| Classic | the block containing `input[name="data.conflict.value"]` | append to `div.tab.obligation[data-tab="obligation"]` — rendered unconditionally at `templates/actors/ffg-character-sheet.html:323`; only the boxes inside are gated |
| Codex | the `.cdx-bstat` panel containing `input[name="data.conflict.value"]` | insert before `.cdx-float-soft-wrap`, which sits outside the `{{#if (or cdxOblig.show.*)}}` that gates `.cdx-bio-stats` |

If even the fallback is missing, log an error **and** fall back to appending to the
sheet's content root, so the tracker is always reachable. A console error is diagnostics,
not a remedy — the panel has to render somewhere.

Glyphs use Font Awesome 7, which V14 ships — no new font asset:

| State | Icon |
|---|---|
| Dark ● | `fa-solid fa-circle` |
| Neutral ◑ | `fa-solid fa-circle-half-stroke` |
| Light ○ | `fa-regular fa-circle` |

Owner-editable throughout, matching the freedom owners already have over the Morality and
Conflict boxes. Conflict binds to the same `system.conflict.value` the old box edits, so
the two stay in sync and a GM awarding Conflict mid-session can use either.

### 3. `scripts/gm-window.js` — the GM Application

Standalone `ApplicationV2`, opened from a GM-only `getSceneControlButtons` entry. Lists
every Force-user PC with scale, Conflict, Tranquility and threshold status. Carries:

- **End of Session** — the sweep (§4).
- **Convert from Morality** — opt-in, GM-only, seeds scales via `fromMorality`. Never
  automatic: auto-converting on enable would rewrite every Force user's alignment the
  moment someone ticks a checkbox.
- Read-only threshold and Destiny reminders (§6).

### 4. `scripts/sweep.js` — end-of-session resolution

Requires **socketlib** for promise-based `executeAsUser` — for request/response
correlation and disconnect rejection, which is the fiddliest code in
`modules/ffg-destiny-tracker.js:245-280`.

**socketlib provides no response timeout.** Verified: `grep -i timeout` over
`modules/socketlib/src/` returns nothing. It rejects when a recipient *disconnects*
(`src/socketlib.js:324`) and on remote exceptions, but a connected player who simply
leaves the prompt open leaves the promise pending forever. The module owns its own
deadline; the original plan's "a socketlib timeout falls through to the GM" was wrong.

#### Exactly-once resolution

Validating an intention against current state is **not** sufficient. If the GM claims a
waiting row and applies Neutral→Light, a late player answer naming the same source state
is still valid — Neutral points remain — and would apply a *second* flip. A single writer
prevents concurrent writes, not sequential duplicates.

State is therefore explicit and authoritative on the GM's client. Crucially, **"stop
accepting answers" and "this character is done" are two different things** — an earlier
revision conflated them by marking a row `resolved` at takeover, before any write. A
deadline does not supply the GM's choice, and `actor.update` can fail; either way the
character would be silently skipped and the sweep allowed to close.

- Each sweep gets a `sweepId`; each row is keyed `(sweepId, actorId)`.
- Row states: `pending → prompted → gm-owned → applying → resolved`, plus `failed`
  (retryable) and `cancelled`.
- **Late answers are rejected the moment a row leaves `prompted`** — the lock is
  independent of completion. An answer carries its `sweepId` and `actorId` and is
  accepted only while that row is `prompted` under the open sweep. Anything else is
  dropped with a console note.
- **GM takeover** moves `prompted → gm-owned`, which closes the input immediately and
  best-effort cancels the player's dialog so it doesn't linger. The row is *not* done:
  it now waits on the GM's choice.
- **The deadline** fires the same `prompted → gm-owned` transition. It does not resolve
  anything, because it has no choice to apply.
- **Applying** is `gm-owned | prompted → applying → resolved`, and the row becomes
  `resolved` **only after the write persists.** A rejected or failed update lands in
  `failed`, which the GM window shows with a Retry control.
- **A sweep cannot close while any row is not `resolved`.** `openSweep` is cleared only
  when every row has persisted; `failed` rows hold it open and are reported, not skipped.

#### Frozen tallies

Validating the scale alone is also insufficient. Conflict and Tranquility can change
*while a prompt is open* — the GM awards Conflict mid-sweep, reversing the comparison.
The player then answers "lightward", the scale check passes because a Neutral point still
exists, and the module applies the wrong direction and zeroes the updated counters.

So each row **snapshots Conflict and Tranquility when it is created**, and the snapshot is
what `resolveSession` ran against. At apply time the module re-reads both from the actor:

- Unchanged → apply the answer.
- Changed → the answer is obsolete. Discard it, recompute `resolveSession` from the new
  totals, and return the row to `pending` so it is re-prompted (or `gm-owned` if the
  deadline has already passed). The GM window says why the row reset.

The snapshot is never used as the value to write. Zeroing reads and clears whatever the
actor currently holds, so a mid-sweep award is not lost — it is counted, in the session it
was awarded for.

#### One sweep at a time

A world setting `openSweep` holds `{sweepId, gmUserId, startedAt}`, or null.

- Only `game.users.activeGM` may start a sweep — the same restriction the destiny
  handshake uses (`modules/ffg-destiny-tracker.js:247-251`).
- Starting a sweep while `openSweep` is non-null is refused, naming the owning GM.
- The GM window offers **Force close** for a sweep abandoned by a crashed or
  disconnected GM, which clears `openSweep` and leaves resolved rows resolved.

Flow, per PC, independently:

1. GM fires the sweep; `openSweep` is claimed. Each row snapshots Conflict and
   Tranquility and computes `resolveSession`.
2. `direction: "none"` or `forced: true` → apply immediately, no prompt.
3. Otherwise prompt the owning player. Row → `prompted`, shows "waiting for
   &lt;player&gt;…".
4. Offline players go straight to `gm-owned`. The GM may claim any `prompted` row at any
   time; the module's deadline does the same automatically. Either way the row still
   awaits a choice.
5. With a choice in hand, row → `applying`: re-read the tallies against the snapshot
   (reset the row if they moved), apply the flip, zero Conflict **and** Tranquility,
   refresh the Codex chip class, whisper a card. Row → `resolved` **only once the write
   persists**; otherwise → `failed`, retryable.
6. `openSweep` clears only when every row is `resolved`.

**Answers travel as intentions, never as computed totals.** A player answers *"move one
point lightward from Neutral"*, and the GM's client validates that state still exists on
the actor at apply time. This is the exact lesson `modules/helpers/destiny-queue.js:22-27`
was written to record: "A flip is an INTENTION, not a pair of totals. The client used to
compute the replacement totals from what it could see and send those; the GM turned them
back into a delta against its own reading, which is wrong the moment anything else has
moved in between." Players can edit their own scale directly, so this race is live.
Intention-validation and the exactly-once guard are both required; neither substitutes
for the other.

The GM's client is the single writer for sweep results.

### 5. Character creation

No wizard coupling. Three of the four starting choices already exist in the frozen table
(`modules/char-creator/starting-bonus.js:27-29`) and work as-is:

| Rules choice | Existing wizard key |
|---|---|
| +10 starting XP | `fad_10xp` → `{xp: 10}` |
| +2,500 starting credits | `fad_2k_credits` → `{credits: 2500}` |
| +5 XP and +1,000 credits | `fad_5xp` → `{xp: 5, credits: 1000}` |
| flip one Balance Point | *the panel's one-time control* |

Docs tell GMs to use those three and to **ignore** `fad_21_plus_morality` and
`fad_21_minus_morality`, which are the base-game rule these rules replace.

The panel's control offers: flip one to Light, flip one to Dark, or "took XP/credits
instead". Sets `startingChoiceTaken` so it cannot be taken twice.

### 6. Display-only reporting

Rendered in the panel and the GM window; never applied.

- **≥7 Dark** — "Dark Side Threshold: strain threshold −2, wound threshold +2, generate ◑ using ●"
- **≥9 Dark** — "At session start, flip one Destiny Point from Light to Dark, after all rolls"
- **10 Dark** — "Consumed by the dark side: seek redemption or become a GM NPC. Redemption requires 7 Light."
- **≥7 Light** — "Light Side Paragon: strain threshold +2. A Dark Side Force user is redeemed and generates using ○."
- **≥9 Light** — "At session start, add one bonus Light Side point to the Destiny Pool, after all rolls"

**Note for a future maintainer:** the Destiny clauses *could* be automated. The system's
dispatcher re-validates requests against the sender and its comment says "Keep older
clients/macros working through the same policy and queue"
(`modules/helpers/destiny-dispatcher.js:45`), so emitting
`{destinyRequest: {type: "destiny-flip", from: "light", to: "dark"}}` on the
`system.starwarsffg` channel is a supported path that goes through the system's own
serialized queue. It was considered and **declined** for consistency with the
tracker-not-enforcer principle. If it is ever added, the queue "refuses a flip out of an
empty pool" and that refusal must be surfaced, not swallowed — a 9+ Dark PC with no Light
points in the pool is a real case.

### 7. Settings

One world setting only: **public resolution cards** (boolean, default off). Cards whisper
to the GM and the affected owner by default, matching the system's stated position that
"the rules let a player keep their Morality secret from the rest of the table"
(`modules/groupmanager-ffg.js:145`).

The module being installed and enabled *is* the ruleset toggle. No separate on/off
setting.

---

## Edge cases & risks

| Case | Handling |
|---|---|
| Conflict > Tranquility, no Neutral points | Forced Light→Dark. Courtney. No prompt. |
| Conflict > Tranquility, already 10 Dark | No move available; report "consumed by the dark side". |
| Tranquility > Conflict, already 10 Light | No move available; no change. |
| Player edits scale mid-sweep | Answers are intentions, validated at apply time; a stale option is dropped and the row returns to the GM. |
| Player goes offline mid-sweep | socketlib rejects on disconnect → GM claims the row. |
| Player never answers but stays connected | The module's own deadline fires the GM-takeover path. socketlib has **no** timeout of its own. |
| Late answer after GM takeover | Rejected: the row has left `prompted`, so the answer is dropped. The lock is independent of whether the row has finished. |
| Tallies change while a prompt is open | The row's snapshot no longer matches, so the answer is discarded, `resolveSession` recomputes, and the row is re-prompted. A mid-sweep Conflict award can reverse the direction. |
| Actor write fails mid-apply | Row → `failed`, retryable, and it holds `openSweep` open. Never silently skipped. |
| Deadline fires | Row → `gm-owned`, not `resolved` — a deadline supplies no choice. |
| Two GMs both open the window | Only the active GM may start a sweep; a second attempt is refused naming the owner. **Force close** exists for an abandoned sweep. |
| No active GM | Sweep cannot run; surfaced, not silently dropped. |
| Actor has module flags but is no longer a Force user | Panel still shows — flags present is sufficient, so state is never orphaned invisibly. |
| Conversion run twice | Refused on any actor with `initialized` set. The seed is one-way and lossy; it is never re-derived from a mirrored score. |
| Conversion on an untracked Force user | **Skipped.** `morality === 0` with no Morality items means "not tracked", not "maximally dark"; seeding it would produce ten Dark and lock it in. A manually-created or imported character is the normal case here, since only the wizard writes `defaultMorality` (50). |
| Character keeps a stale Morality score or old Emotional Strength/Weakness items | Both persist — the module writes neither. The system's Morality tab will still list them; ignore it. See below. |
| Fresh Force character, classic sheet, not in Edit Mode | No Morality/Conflict box exists — the panel uses the unconditional `div.tab.obligation` fallback. See Components §2. |
| Group Manager Morality tab | **Remains usable, and must be ignored.** See the note below the table — the earlier "genuinely empty" claim was wrong. |
| System updates the sheet templates | Anchors are a cascade ending at the sheet content root, so the panel cannot vanish; a missing preferred anchor logs an error for diagnostics. |

### The Group Manager's Morality tab is not inert

Two earlier claims were wrong and are withdrawn. Dropping the morality mirror does **not**
empty that tab.

`buildMoralityList` skips a character only when it has no Morality items **and**
`morality === 0` (`modules/helpers/obligation-tracks.js:191`). Not writing the score does
not clear a score that is already there. So a character converted from Morality 85 keeps
85, stays in the list, and remains eligible for the d100 triggering roll — and any
character carrying old Emotional Strength/Weakness items stays listed regardless of their
score. The tab is empty only for characters that were already at 0 with no entries.

Suppressing this properly would mean zeroing `system.morality.value` and deleting the old
Emotional Strength/Weakness items on conversion. **We do not**, on purpose: both are
destructive, irreversible, and they are a record of the character's history under the old
rules. Writing the score would also re-arm the `codexAlignment` hook we just got out from
under.

So: **documented, not suppressed.** The README and the wiki page state that under Force
Presence the Group Manager's Morality tab is a base-game tool with no meaning, that it may
still list converted characters, and that the module's own window is the source of truth.
The rules replace Moral Strength and Weakness at creation, so for a character built under
these rules from the start there is nothing to trigger anyway.

---

## Testing

`node --test` against `tests/rules.test.js`. **Zero dependencies** — Node 18+ ships
`node:test` and `node:assert`, and the world runs Node 24. No mocha, no chai, no
`package.json` dependencies, no CI workflow.

Required assertions:

1. **The three printed-example characters**, start → end, exactly as tabulated above.
   Courtney's 10 Light + 7 Conflict → 1 Dark / 9 Light is the load-bearing one.
2. Threshold boundaries at 6/7 and 8/9 Dark and Light; 10 Dark consumed; redemption gate
   at 7 Light.
3. Dark and Paragon thresholds are never both true.
4. `alignmentClass` over **mixed** states, which is where the rejected linear mirror
   failed: `{7,3}` → `"evil"`, `{3,7}` → `"good"`, `{0,5}` → `"neutral"` (5 Light is not
   paragon), `{10,0}` → `"evil"` (never "untracked"). Never returns null — the
   below-threshold case must be explicit, or a stale `good` survives losing a Light point.
5. `seedFromMorality` at 50 / 85 / 15 / 100, plus the rounding boundary at 52 vs 53.
   **`seedFromMorality(0)` returns null**, never ten Dark. **No round-trip assertion** —
   the seed is lossy by construction and has no inverse.
6. Conversion classification: `initialized` → skip; `morality === 0` with no items →
   skip; genuine score → seed. The untracked case is the one that would ruin a character.
7. Invariants hold under every `applyFlip` from every reachable state.

Sweep protocol tests (pure, over a fake transport — the state machine is worth pinning
even though the transport is not):

8. A late answer for a row that has left `prompted` is dropped and applies no second flip.
9. An answer bearing a stale `sweepId` is dropped.
10. GM takeover moves `prompted → gm-owned`, **not** `resolved`, and the row still needs a
    choice.
11. A deadline firing resolves nothing.
12. A failed write leaves the row `failed` and `openSweep` open; the sweep cannot close.
13. Tallies changed while prompted → the answer is discarded and `resolveSession`
    recomputes, including the case where added Conflict reverses the direction.

Manual, in Foundry:

- Panel on both sheet themes, and on a **fresh** Force character on the classic sheet
  outside Edit Mode — the case with no Morality or Conflict box at all.
- Read-only Morality input.
- Codex chip at 7 Dark and 7 Light, then **drop to 6 Light and confirm it returns to
  neutral** rather than keeping a stale `good` from a converted score.
- Conversion against a mixed roster in one run: an untracked Force user at Morality 0
  (must be skipped, *not* seeded to ten Dark), a wizard character at 50, a converted
  character at 85, and one already `initialized`. Then run it again and confirm nothing
  moves.
- Sweep with a second client connected; with it closed; with it connected but never
  answering; GM takeover followed by a late answer from that client.
- **Award Conflict from the GM window while a prompt is open**, then answer it — the row
  must reset and re-prompt, not apply the obsolete direction.
- Starting choice one-shot.

---

## Uninstalling

**The earlier "leaves no residue" claim was wrong and is withdrawn.** It held only for a
world where the module was never used. Once used, it leaves:

| Residue | Reversible? |
|---|---|
| `flags.kelborns-swffg-force-presence.*` on actors | Yes — delete the flags |
| `system.conflict.value` zeroed by past sweeps | **No** — the pre-sweep values are gone |
| The `openSweep` world setting | Yes — it is the module's own setting |

Dropping the morality mirror removed the two worst items: `system.morality.value` is
never overwritten, and the `codexAlignment` flag is never flipped by the system's
`updateActor` hook (`modules/actors/codex-sheets.js:337-346`) on our behalf.

No backup or restore is implemented. Zeroing Conflict at end of session is the rule
working as intended, not damage to undo, and a module that shadow-copied every actor
field it touched would be more dangerous than the residue. The README states this
plainly instead of promising reversibility.

---

## Decisions (resolved 2026-09-26)

| # | Decision | Chosen |
|---|---|---|
| 1 | Packaging | Separate Foundry module, not in-system |
| 2 | Rule scope | Force Presence only; Unified Conflict Roll out |
| 3 | Data ownership | Reuse `conflict`, flags for the rest. **Morality mirror dropped after review** — it could not represent the scale and broke the very alignment colour it existed for; the Codex chip class is set directly instead, which delivers the same intent. |
| 4 | Flip rule | Asymmetric — rule text + printed scales, not the example's prose |
| 5 | Resolution flow | GM triggers, players choose via socket |
| 6 | Non-responders | GM picks up stragglers |
| 7 | Threshold effects | Display-only |
| 8 | Destiny effects | Display-only |
| 9 | Sheet UI | Separate panel, existing boxes left in place |
| 10 | Mirrored Morality box | Read-only while active |
| 11 | Panel placement | After the Conflict box, shared selectors, both sheets |
| 12 | Initial state | Lazy ten-Neutral default + opt-in conversion tool |
| 13 | Character creation | No wizard coupling; one-time control in the panel |
| 14 | GM UI | Standalone window (reversed from a Group Manager tab, #15) |
| 15 | Tab injection | Declined — re-render ejects an injected tab |
| 16 | Permissions | Mirror the system: owner edits everything on their own sheet |
| 17 | Identity | `kelborns-swffg-force-presence`, repo `YeNov/…` |
| 18 | Verification | Pure core + `node --test`, no deps, no CI |
| 19 | Card visibility | Whisper to GM + owner; one setting for public |
| 20 | Docs | README + this doc + a wiki page; no CHANGELOG yet |
| 21 | Wiki page scope | One page, inline: Force Presence, Dice Stacks, Enhancements |
| 22 | Socket transport | Require socketlib |

---

## Open questions

- **`_preUpdate` threshold drift** (`modules/actors/actor-ffg.js:105-116`) is a live
  system bug independent of this module: the new stored `wounds.max` / `strain.max` is
  computed from the effect-applied value, so any additive threshold effect is absorbed
  into the baseline when Brawn or Willpower changes, then applied again. Reachable today
  through species `(inherent)` effects. Display-only sidesteps it here; it does not fix
  it. Worth a system-side fix.
- **CLAUDE.md path errors** in the system repo: it cites
  `python tools/annotate-tutorial-shots.py` and `tools/build-tutorial-preview.py` as
  living in `tools/`. They are at the **wiki** repo root; `tools/` holds only
  `check-imports.mjs` and `set-release-manifest.mjs`.
- **Upstream erratum.** The Courtney contradiction is worth reporting to the
  reSpecialized project so the rule text and the example agree. Not blocking.
- **Unified Conflict Roll.** If ever wanted, note the system has *no* end-of-session
  Conflict roll at all today — `_rollMorality` (`modules/groupmanager-ffg.js:301`) is the
  d100 *triggering* Morality roll from FaD p. 323, a different thing.

---

## Files (all new)

```
kelborns-swffg-force-presence/
  module.json                       id, title "Kelborn's SWFFG Force Presence",
                                    author YeNov,
                                    Foundry min 13 / verified 14,
                                    requires socketlib, systems: starwarsffg >= 2.1.5,
                                    languages: en only, flags.hotReload
  README.md                         rules summary, settings, workflow,
                                    and the Courtney contradiction
  scripts/
    constants.js                    module id, flag keys, thresholds
    rules.js                        pure core — no Foundry
    sheet-panel.js                  renderActorSheetV2 injection, both sheets
    gm-window.js                    standalone Application + scene control
    sweep.js                        socketlib handshake, single-writer apply
    main.js                         wiring
  styles/main.css                   scale glyphs, panel layout
  lang/en.json
  tests/rules.test.js               node --test
  docs/superpowers/plans/2026-09-26-force-presence.md   this doc
```

Wiki (separate repo, `YeNov/StarWarsFFG.wiki`): new `Extra-Modules.md` covering Force
Presence, SWFFG Dice Stacks and FFG Star Wars Enhancements inline, with links and short
descriptions; linked from `Home.md` and Tutorial.md's "More" section.
