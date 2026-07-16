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
 * @returns A zone id that exists in the venue topology.
 */
export function arrivalGate(district: HostDistrict): string {
	const gates = GATES_BY_MODE[district.transitMode];
	const peers = HOST_DISTRICTS.filter((d) => d.transitMode === district.transitMode);
	const index = peers.findIndex((d) => d.id === district.id);

	// A district outside the catalogue still gets a real gate for its mode rather
	// than an invented one.
	if (index < 0) return gates[0];
	return index % 2 === 0 ? gates[0] : gates[1];
}

/**
 * The transit zone a mode's fans arrive into.
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
 * @param district Where the fan is staying.
 */
export function approachZones(district: HostDistrict): readonly string[] {
	return [transitZone(district.transitMode), arrivalGate(district)];
}
