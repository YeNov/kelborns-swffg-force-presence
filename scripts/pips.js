/**
 * Balance Points drawn with the SYSTEM's own die-symbol font rather than generic icons.
 *
 * The system renders Force results as `<span class="dietype <theme> <kind>">` carrying a
 * single character from EotESymbol / GenesysSymbol, which it loads globally. Three of
 * those characters map exactly onto the three Balance Point states.
 *
 * Why this beats drawing circles ourselves: the three glyphs differ in SHAPE, not just
 * colour -- the system styles all three `color: black` and lets the font distinguish
 * them. A generic filled/outlined circle pair has to rely on colour, and a near-white
 * circle disappears against the Codex sheet's pale paper. It also means the pips match
 * the dice the table is already reading, and follow the world's dice-theme setting.
 *
 * The Codex schemes already carry contrast rules for `span.dietype` (a white text-stroke
 * on black glyphs under dark schemes), so those apply to these pips for free.
 */

/** state -> the system's die-symbol class and its character. */
const PIPS = Object.freeze({
  dark: { cls: "dark", char: "z" },
  neutral: { cls: "forcepoint", char: "Y" },
  light: { cls: "light", char: "Z" },
});

/**
 * The world's dice theme ("starwars" or "genesys"), which selects the symbol font.
 * Guarded: this is read during sheet render, and a world mid-migration or a setting not
 * yet registered must not break a character sheet over a decoration.
 */
export function diceTheme() {
  try {
    return game.settings.get("starwarsffg", "dicetheme") || "starwars";
  } catch {
    return "starwars";
  }
}

/**
 * One Balance Point as HTML.
 * @param {"dark"|"neutral"|"light"} state
 * @param {string} theme  from `diceTheme()`, hoisted by callers drawing ten of these
 * @param {object} [options]
 * @param {boolean} [options.solid]
 *   Draw the light pip with the FILLED disc character instead of the outline one.
 *   The light glyph is a hollow ring, so on a dark background `color: #fff` paints only
 *   its outline and leaves the interior dark -- CSS cannot fill a glyph the font draws
 *   hollow. Swapping the character is the only way to get a solid white pip. The class
 *   stays `light`, so the colour rules still apply and dark vs light remains a fill
 *   difference (black disc with a white outline, versus a white disc).
 */
export function pipHtml(state, theme = diceTheme(), { solid = false } = {}) {
  const pip = PIPS[state] ?? PIPS.neutral;
  const char = solid && state === "light" ? PIPS.dark.char : pip.char;
  return `<span class="dietype ${theme} ${pip.cls} kfp-point kfp-point-${state}">${char}</span>`;
}
