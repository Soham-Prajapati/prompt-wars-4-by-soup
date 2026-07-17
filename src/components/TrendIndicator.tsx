import { type ReactElement } from "react";

import { type Trend } from "@/lib/crowd-model";

/**
 * Arrow glyph per trend.
 *
 * Decorative, and marked as such: the arrow is a second channel alongside the
 * word, never the channel. A user who cannot resolve the glyph — or the colour
 * behind it — still reads "Rising" in the same breath.
 */
const TREND_ARROWS: Readonly<Record<Trend, string>> = {
	rising: "↗",
	falling: "↘",
	steady: "→",
};

/** Operator-facing word for each direction of travel. */
const TREND_LABELS: Readonly<Record<Trend, string>> = {
	rising: "Rising",
	falling: "Falling",
	steady: "Steady",
};

/**
 * A direction of travel, stated three ways at once.
 *
 * Trend is the one reading on this console that a duty manager acts on *before*
 * anything is visibly wrong, so it is the last one that should depend on being
 * able to see a colour. Colour, arrow and word all carry it: the class tints it,
 * the arrow is `aria-hidden` decoration, and the label is real text that survives
 * a screen reader, a monochrome display and colour-blindness alike. The `detail`
 * sits in the same text node, so the announcement is one phrase — "Rising — 62%
 * to 79% in 15 min" — rather than a symbol a user has to reconcile with a number
 * somewhere else.
 *
 * @param trend Which way the measure is heading.
 * @param detail The figures behind the classification, in words a reader can act
 *   on. Read aloud immediately after the label, so it should complete the phrase.
 */
export function TrendIndicator({ trend, detail }: { readonly trend: Trend; readonly detail: string }): ReactElement {
	return (
		<span className={`trend trend--${trend}`}>
			<span className="trend__arrow" aria-hidden="true">
				{TREND_ARROWS[trend]}
			</span>
			<span className="trend__label">
				{TREND_LABELS[trend]} — {detail}
			</span>
		</span>
	);
}
