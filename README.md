# Kelborn's SWFFG Force Presence

Implements the **Tranquility and Force Presence** optional rules from the reSpecialized
project's *Optional Morality Rules* (credited there to **Nori**) for the
[Star Wars FFG](https://github.com/YeNov/StarWarsFFG) system in Foundry VTT.

Replaces the Force and Destiny **Morality score** with a ten-point **Balance scale** and
adds **Tranquility** as the counterweight to Conflict.

Requires [socketlib](https://github.com/manuelVo/foundryvtt-socketlib).

## The rules

Each character has ten Balance Points, each Dark (●), Neutral (◑) or Light (○). There is
no Morality score and no end-of-session d10.

**At creation.** Instead of choosing a Moral Strength and Weakness (FaD CRB p. 48), start
with ten Neutral points and take one of:

- +10 starting XP
- +2,500 starting credits
- +5 starting XP and +1,000 starting credits
- flip one Balance Point to Light or Dark

The first three are already in the system's PC Wizard as **+10 XP**, **+2,500 credits**
and **+5 XP and 1,000 credits**. Use those, and **ignore the two ±21 Morality options** —
they belong to the base rules this module replaces. The fourth choice is a one-time
control in the module's own panel.

**At the end of each session.** Compare accumulated Conflict and Tranquility:

| | Effect |
|---|---|
| More Conflict | One point **becomes Dark**, from Neutral or from Light |
| More Tranquility | One point moves **one step lightward**: Dark → Neutral, or Neutral → Light |
| Equal | No change |

Both tallies then reset to zero.

**Thresholds.** With ten points, a character can never be both.

- **≥7 Dark** — Dark Side Threshold: strain threshold −2, wound threshold +2, generate
  Force points using dark side results. At **≥9 Dark**, flip one Destiny Point from Light
  to Dark at the start of each session, after all rolls.
- **10 Dark** — consumed by the dark side: seek redemption or become a GM NPC. Redemption
  needs **≥7 Light**.
- **≥7 Light** — Light Side Paragon: strain threshold +2; a dark side Force user is
  redeemed and generates using light side results. At **≥9 Light**, add one bonus Light
  Side point to the Destiny Pool at the start of each session, after all rolls.

## A tracker, not an enforcer

The module keeps the books and **reports** mechanical consequences without applying them.
The threshold adjustments, the Destiny Point clauses, the 10-Dark NPC rule, the redemption
gate and the pip-generation change are all shown to you; none of them are automated.

Two reasons. Pip generation cannot be automated at all — the system tallies Force-die
light and dark results but has no notion of which a character may spend. And the
threshold adjustments would drift: the system stores `wounds.max` and `strain.max` and
recomputes them from the *effect-applied* value when Brawn or Willpower changes, so an
additive Active Effect gets absorbed into the baseline and then applied again. Reporting
is honest; automating it would quietly give a dark side character +4 wounds after their
next Brawn rank.

## Where the rules and the source disagree

**The source contradicts itself, and this module follows the rule text.**

The rule text says a Conflict-dominant session moves a point "from Neutral to Dark, **or
Light to Dark**" — straight to Dark, skipping Neutral. The worked example's prose says the
opposite: "from Light Side to Neutral or Neutral to Dark Side."

The example's own printed scales settle it. Courtney starts with **ten Light**, earns 7
Conflict against 2 Tranquility, and ends with **one Dark and nine Light**. She held no
Neutral points, so under the prose she should have finished with one Neutral and nine
Light. She does not.

So falling is one move from anywhere, while climbing back is one step at a time — which is
what the source's own note is justifying when it says the asymmetry represents "how
difficult it is to achieve redemption from the Dark Side."

`tests/rules.test.js` pins all three printed characters. If you intend to change this,
change those assertions first and read the comment at the top of `scripts/rules.js`.

## Using it

**The panel** appears on a Force user's character sheet — the classic sheet's
*Obligation / Duty / Morality* tab, or beside the Codex sheet's bio-stats. It shows the
scale, Conflict and Tranquility, any threshold the character has crossed, and the
one-time starting choice. The owner can edit all of it, the same freedom they already
have over the Morality box.

**The GM window** is the crossed-circle button in the Token scene controls. It lists
every character tracking Force Presence with their scale, tallies and thresholds, and
previews what the end of session would do to each one.

**End of session** is the sweep. The GM starts it; each player is asked to choose for
their own character, and the GM can claim any row at any moment — or wait, since a
player who does not answer within three minutes falls to the GM automatically. A row is
only finished once its write has actually saved, and the sweep will not close while any
row is unresolved or failed. Both tallies zero as each character resolves.

Some rows never ask anyone: equal Conflict and Tranquility moves nothing, and a
Conflict-dominant character with no Neutral points has only one legal move, so it is
taken without a prompt.

Only the active GM can run a sweep, and only one can be open at a time. If a GM's client
crashes mid-sweep, **Force close** releases the lock — characters already resolved stay
resolved.

## Settings

**Public resolution cards** (default off). End-of-session results are whispered to the GM
and the character's owner, because the base rules let a player keep their alignment secret
from the rest of the table. Turn it on for a table that shares alignment openly.

## Things to know

**The system's Morality box becomes read-only.** The score has no meaning under these
rules. Conflict is *not* replaced — the module reuses the system's own Conflict field, so
the existing box keeps working and a GM can award Conflict from either place.

**The Group Manager's Morality tab still works, and should be ignored.** It is a base-game
tool. The module writes no Morality score, but it does not erase one either, so a
character converted from a score of 85 keeps that 85 and stays in that tab's list — as does
any character still carrying old Emotional Strength/Weakness items. Suppressing this would
mean deleting a record of the character's history under the old rules, which the module
will not do. The module's own window is the source of truth.

**Converting an existing campaign.** The GM window's *Convert from Morality* seeds scales
from existing scores. It is deliberate, never automatic, and it:

- skips any character whose scale is already real, so re-running it is safe;
- skips any character who was not actually using Morality — a score of 0 with no Morality
  entries means "not tracked", not "maximally dark". Only the PC Wizard writes a starting
  score, so manually created and imported characters sit at 0 and are left at ten Neutral.

The seed is one-way and lossy: a single 0–100 score cannot encode a three-state scale, so
you get a one-sided scale with the rest Neutral. Adjust by hand afterwards if the table
wants something more nuanced.

**The Codex sheet's Force chip** takes its colour from the scale while this module is
active (≥7 Dark red, ≥7 Light blue, otherwise neutral). This overrides an alignment you
set by hand on that sheet — under these rules the scale *is* the character's alignment.

## Uninstalling

Enabling the module writes nothing, so an untouched world is unaffected. Once used, it
leaves:

| | Reversible |
|---|---|
| Its own flags on actors | Yes — delete them |
| Conflict values zeroed by past end-of-session sweeps | **No** — the earlier values are gone |
| Its own world settings | Yes |

There is no backup or restore. Zeroing Conflict at end of session is the rule working as
intended, and a module that shadow-copied every field it touched would be more dangerous
than the residue.

## Development

```bash
node --test
```

No dependencies: `node:test` and `node:assert` ship with Node 18+.

`scripts/rules.js` and `scripts/sweep.js` are pure — no Foundry globals, no I/O — which is
what makes them testable. Keep them that way and put Foundry access in the adapters.

Design doc: [`docs/superpowers/plans/2026-09-26-force-presence.md`](docs/superpowers/plans/2026-09-26-force-presence.md).

## Credits

The *Tranquility and Force Presence* rules are by **Nori** for the reSpecialized project.
This module only implements them.

## License

MIT.
