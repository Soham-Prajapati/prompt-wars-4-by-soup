/**
 * Who the operations advisor is speaking to.
 *
 * The advisor grounds itself in the same live venue state whoever asks, but the
 * two people who read it are not doing the same job, and a single register
 * serves neither well.
 *
 * A duty manager works the whole venue from the control room: they need the zone
 * ids the radio uses, head counts to justify moving staff, and a ranking across
 * every zone at once. A steward is a volunteer — often on their first shift, at a
 * tournament staffed largely by volunteers — posted at one zone for the
 * afternoon, whose actual job is answering the fans in front of them and knowing
 * when a situation has stopped being theirs to handle. Handing them the venue
 * table is handing them seventeen zones of noise around the one they are stood
 * in.
 *
 * The catalogue lives here rather than inline in the schema for the same reason
 * the zone, district, interest and language catalogues do: the value is
 * interpolated into a decision about how to build a prompt, so the set of legal
 * values has to be stated once, checked at the boundary, and shared with the
 * control that offers them.
 */

/** An audience the advisor can be asked to write for. */
export type Audience = "duty-manager" | "steward";

/** Every audience the advisor supports, in the order the picker offers them. */
export const AUDIENCES: readonly Audience[] = ["duty-manager", "steward"] as const;

/**
 * Audience assumed when a request does not name one.
 *
 * The duty manager, which is what the advisor answered for before stewards were
 * added — so a client written against the older contract keeps the behaviour it
 * was written against rather than silently getting a different document.
 */
export const DEFAULT_AUDIENCE: Audience = "duty-manager";

const AUDIENCE_SET: ReadonlySet<string> = new Set<string>(AUDIENCES);

/**
 * True when `value` is one of the audiences {@link AUDIENCES} offers.
 *
 * Declared as a type predicate so the request schema's refinement narrows
 * `string` to {@link Audience}: the route then switches on the parsed value with
 * the compiler enforcing that every audience is handled, rather than a `default`
 * branch quietly absorbing one that was added and never wired up.
 *
 * @param value The candidate audience, compared exactly — no trimming or casing.
 */
export function isKnownAudience(value: string): value is Audience {
	return AUDIENCE_SET.has(value);
}

/** Operator-facing name for an audience, for labelling the control that picks it. */
export const AUDIENCE_LABELS: Readonly<Record<Audience, string>> = {
	"duty-manager": "Duty manager — venue-wide actions",
	steward: "Steward — briefing for one post",
};
