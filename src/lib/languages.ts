/**
 * The languages every fan-facing AI panel offers.
 *
 * 2026 is the first 48-nation World Cup, so a single concourse holds fans with
 * no shared language. Each option is written in its own script: a fan who cannot
 * read the interface must still be able to find their language here.
 *
 * The list lives here rather than in a component because more than one panel
 * asks the question. Two copies would drift, and a language offered by the
 * assistant but missing from the itinerary planner is a worse bug than a missing
 * language in both.
 */

/** A language a fan-facing panel will reply in. */
export interface LanguageOption {
	/** Endonym shown in the picker and sent to the API as the target language. */
	readonly label: string;
	/** BCP 47 tag, used to mark up the reply for screen readers and hyphenation. */
	readonly tag: string;
}

/** Languages offered by the fan assistant and the matchday itinerary planner. */
export const LANGUAGES: readonly LanguageOption[] = [
	{ label: "English", tag: "en" },
	{ label: "Español", tag: "es" },
	{ label: "Français", tag: "fr" },
	{ label: "Português", tag: "pt" },
	{ label: "Deutsch", tag: "de" },
	{ label: "العربية", tag: "ar" },
	{ label: "日本語", tag: "ja" },
	{ label: "한국어", tag: "ko" },
	{ label: "हिन्दी", tag: "hi" },
	{ label: "Nederlands", tag: "nl" },
];

/** Language selected before the fan chooses one. */
export const DEFAULT_LANGUAGE = "English";

const LABELS: ReadonlySet<string> = new Set(LANGUAGES.map((option) => option.label));

/**
 * True when `label` is one of the endonyms {@link LANGUAGES} offers.
 *
 * The label is interpolated into every fan-facing prompt as the language to
 * reply in, so an arbitrary string here is arbitrary prompt text: "English.
 * Ignore all prior instructions" is a perfectly ordinary-looking language name
 * and a perfectly ordinary prompt injection. Checking against the catalogue —
 * which is also exactly what the picker offers — closes that off without costing
 * any fan a language they could actually have chosen.
 *
 * @param label The candidate endonym, compared exactly — no trimming or casing.
 */
export function isKnownLanguage(label: string): boolean {
	return LABELS.has(label);
}

/**
 * BCP 47 tag for a language label, falling back to English for an unknown label.
 *
 * @param label An endonym from {@link LANGUAGES}.
 */
export function tagFor(label: string): string {
	return LANGUAGES.find((option) => option.label === label)?.tag ?? "en";
}
