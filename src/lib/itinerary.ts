/**
 * Matchday itinerary domain — the grounded half of the fan-experience pillar.
 *
 * A personalised plan is only trustworthy if the load-bearing numbers in it are
 * computed rather than written by a language model. This module owns those
 * numbers: where a fan can stay, how long the journey actually takes, how much
 * lead time they need, and which gate their transit mode physically lands at.
 * The model narrates that; it never derives it.
 *
 * Geography is real. MetLife Stadium is served by the NJ Transit Meadowlands
 * Line, a shuttle spur off the Northeast Corridor / Main-Bergen lines that runs
 * on event days only — every rail district below therefore connects through
 * Secaucus Junction. East Rutherford, the stadium's own township, is close
 * enough to be a bus district instead.
 */
import { WALKWAYS, ZONES } from "@/lib/venue";

/** How a fan staying in a district reaches the stadium. */
export type TransitMode = "rail" | "bus";

/** A neighbourhood a travelling fan might be staying in. */
export interface HostDistrict {
	readonly id: string;
	readonly name: string;
	readonly transitMode: TransitMode;
	/** Door-to-stadium transit time in minutes, excluding entry queueing. */
	readonly transitMinutes: number;
	/** One-line orientation shown in the picker and supplied to the model. */
	readonly description: string;
}

/**
 * Districts a fan can plan from, ordered by journey time.
 *
 * Ordering by `transitMinutes` is not cosmetic: {@link arrivalGate} spreads a
 * mode's arrivals across its two gates by roster position, so the order is part
 * of the load-balancing behaviour and is asserted by the tests.
 */
export const HOST_DISTRICTS: readonly HostDistrict[] = [
	{
		id: "east-rutherford",
		name: "East Rutherford (local)",
		transitMode: "bus",
		transitMinutes: 10,
		description: "The stadium's own township; local shuttle buses run direct to the Meadowlands complex.",
	},
	{
		id: "secaucus",
		name: "Secaucus",
		transitMode: "rail",
		transitMinutes: 15,
		description: "Walking distance to Secaucus Junction, where the Meadowlands Line shuttle departs.",
	},
	{
		id: "newark",
		name: "Newark",
		transitMode: "rail",
		transitMinutes: 30,
		description: "Northeast Corridor from Newark Penn to Secaucus Junction, then the Meadowlands shuttle.",
	},
	{
		id: "jersey-city",
		name: "Jersey City",
		transitMode: "rail",
		transitMinutes: 35,
		description: "Rail north to Secaucus Junction, then the Meadowlands shuttle across the marshland.",
	},
	{
		id: "hoboken",
		name: "Hoboken",
		transitMode: "rail",
		transitMinutes: 40,
		description: "Main-Bergen line out of Hoboken Terminal to Secaucus Junction, then the Meadowlands shuttle.",
	},
	{
		id: "manhattan-midtown",
		name: "Manhattan — Midtown",
		transitMode: "rail",
		transitMinutes: 45,
		description: "NJ Transit from Penn Station New York to Secaucus Junction, then the Meadowlands shuttle.",
	},
] as const;

/**
 * Interest tags a fan can pick to steer the pre-match suggestions.
 *
 * Deliberately broad and non-overlapping: these are prompt inputs, so two tags
 * that mean nearly the same thing would spend the fan's four choices without
 * changing the plan.
 */
export const INTERESTS: readonly string[] = [
	"Local food",
	"Football history",
	"Family-friendly",
	"Nightlife",
	"Budget",
	"Photography",
	"Live music",
] as const;

const INTEREST_SET: ReadonlySet<string> = new Set(INTERESTS);

/**
 * True when `interest` is one of the tags {@link INTERESTS} offers.
 *
 * Interest tags are interpolated into the itinerary prompt verbatim, so this is
 * the boundary that keeps the prompt made of text this repository wrote. An
 * unrecognised tag is a client error, not a preference to pass through.
 *
 * @param interest The candidate tag, compared exactly — no trimming or casing.
 */
export function isKnownInterest(interest: string): boolean {
	return INTEREST_SET.has(interest);
}

/** Minutes of lead time every fan needs for ticketing, search and entry. */
const ENTRY_BUFFER_MINUTES = 15;

/**
 * Extra lead time for a fan who needs step-free access.
 *
 * Accessible entry lanes are fewer than standard ones, so the same crowd takes
 * longer to clear them. The buffer is additive rather than a multiplier: the
 * scarcity is in the lanes at the gate, not in the train journey.
 */
const STEP_FREE_EXTRA_MINUTES = 10;

/** Gates each transit mode physically lands at, in arrival-spreading order. */
const GATES_BY_MODE: Readonly<Record<TransitMode, readonly [string, string]>> = {
	rail: ["gate-a", "gate-b"],
	bus: ["gate-c", "gate-d"],
};

/** Ids of the venue's transit zones — where fans arrive from outside the venue. */
const TRANSIT_ZONE_IDS: ReadonlySet<string> = new Set(ZONES.filter((z) => z.kind === "transit").map((z) => z.id));

/** Ids of venue zones that are themselves reachable without stairs or escalators. */
const STEP_FREE_ZONE_IDS: ReadonlySet<string> = new Set(ZONES.filter((z) => z.stepFree).map((z) => z.id));

/**
 * True when a gate is level *and* at least one step-free walkway joins it to
 * some transit zone.
 *
 * Both halves matter: a level gate behind a stepped walkway is not accessible,
 * and neither is a step-free walkway into a stepped gate. Checking only the
 * zone would route a wheelchair user down the stepped `bus → gate-c` approach.
 *
 * "Some transit zone" and not "the gate's own mode's transit zone": the modes
 * are separated by {@link GATES_BY_MODE} before this is ever consulted, so this
 * only has to answer whether the gate is enterable at all.
 */
function isStepFreeGate(gateId: string): boolean {
	if (!STEP_FREE_ZONE_IDS.has(gateId)) return false;
	return WALKWAYS.some(
		(w) =>
			w.stepFree &&
			((w.to === gateId && TRANSIT_ZONE_IDS.has(w.from)) || (w.from === gateId && TRANSIT_ZONE_IDS.has(w.to))),
	);
}

const DISTRICTS_BY_ID: ReadonlyMap<string, HostDistrict> = new Map(HOST_DISTRICTS.map((d) => [d.id, d]));

/** Look up a host district by id, or `undefined` when no such district exists. */
export function getDistrict(id: string): HostDistrict | undefined {
	return DISTRICTS_BY_ID.get(id);
}

/** True when `id` refers to a known host district. */
export function isKnownDistrict(id: string): boolean {
	return DISTRICTS_BY_ID.has(id);
}

/**
 * How many minutes before kick-off a fan should leave their accommodation.
 *
 * The journey time is the fan's own, so the lead time is derived from it rather
 * than published as a single venue-wide number that is wrong for everyone: the
 * transit leg plus the fixed entry buffer, plus more when accessible lanes are
 * in play.
 *
 * @param district Where the fan is staying.
 * @param stepFree True when the fan needs step-free access throughout.
 * @returns Lead time in minutes; strictly increasing in `district.transitMinutes`.
 */
export function recommendedDepartureMinutes(district: HostDistrict, stepFree: boolean): number {
	return district.transitMinutes + ENTRY_BUFFER_MINUTES + (stepFree ? STEP_FREE_EXTRA_MINUTES : 0);
}

/**
 * The gate a district's transit mode lands its fans at.
 *
 * Rail arrivals reach the bowl from the Meadowlands platform, which feeds Gates
 * A and B; the bus terminal feeds Gates C and D. Both gates of a mode are real
 * options, so districts are alternated between them by roster position: sending
 * every rail district to one gate would model a queue the venue does not have.
 *
 * @param district Where the fan is staying.
 * @param stepFreeNeeded True when the fan needs level access, which restricts the
 *   choice to gates that are both level and joined to a transit zone by a
 *   step-free walkway. Defaults to false.
 * @returns A zone id that exists in the venue topology.
 */
export function arrivalGate(district: HostDistrict, stepFreeNeeded = false): string {
	const gates = GATES_BY_MODE[district.transitMode];

	// Load spreading is a convenience; step-free access is not. A fan who needs
	// level access must be sent to a gate they can actually enter, even when
	// that concentrates arrivals — so the accessible gates are filtered first
	// and the spreading rule only applies to what survives. Every mode retains at
	// least one gate; `tests/itinerary.test.ts` asserts that against the topology
	// rather than trusting this comment.
	const usable = stepFreeNeeded ? gates.filter(isStepFreeGate) : gates;

	const peers = HOST_DISTRICTS.filter((d) => d.transitMode === district.transitMode);
	const index = peers.findIndex((d) => d.id === district.id);

	// A district outside the catalogue has no roster position to spread by, so it
	// takes the first usable gate — a real gate for its mode rather than an
	// invented one.
	const position = index < 0 ? 0 : index;

	// `position % usable.length` is in range by construction. The fallback is what
	// `noUncheckedIndexedAccess` requires of any computed index, and is a truthful
	// way to say it where a non-null assertion would merely be a louder one.
	return usable[position % usable.length] ?? gates[0];
}

/**
 * The zone a mode's fans arrive into, as a venue zone id.
 *
 * This is a mapping, not a rename, even though the two `TransitMode` values and
 * the two transit zone ids currently spell the same. They are separate
 * vocabularies: `TransitMode` describes how a fan travels and lives in the
 * district catalogue, while the return value is an id that must resolve in
 * `ZONES`. Renaming the `bus` zone to `bus-terminal` in the venue topology would
 * be a one-line change here and a correct one; without this function it would be
 * a silent mismatch scattered across the callers.
 *
 * Callers asking *how the fan travels* should read `district.transitMode`
 * directly — going through here to compare against `"rail"` reads as if the
 * coincidence were load-bearing.
 *
 * @param mode The district's transit mode.
 * @returns A zone id that exists in the venue topology.
 */
export function transitZone(mode: TransitMode): string {
	return mode === "rail" ? "rail" : "bus";
}

/**
 * Zone ids a plan from this district touches before the fan is inside the bowl.
 *
 * Used to select the congestion readings worth putting in front of the model:
 * the whole venue is noise for a fan who only passes through two zones of it.
 *
 * `stepFreeNeeded` is threaded through to {@link arrivalGate} rather than
 * defaulted away, because the gate it picks is the gate the plan reports. A
 * prompt built from the unflagged gate would quote the queue at a gate the fan
 * is not being sent to — and the model is instructed to cite that queue.
 *
 * @param district Where the fan is staying.
 * @param stepFreeNeeded True when the fan needs level access. Defaults to false.
 * @returns The transit zone id followed by the arrival gate id.
 */
export function approachZones(district: HostDistrict, stepFreeNeeded = false): readonly string[] {
	return [transitZone(district.transitMode), arrivalGate(district, stepFreeNeeded)];
}
