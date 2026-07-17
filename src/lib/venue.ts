/**
 * Venue topology for a FIFA World Cup 2026 host stadium.
 *
 * Models MetLife Stadium (East Rutherford, NJ) — the 2026 Final venue — as a
 * graph of zones connected by walkways. Coordinates are normalised to a
 * 0..100 unit square so the frontend can render them resolution-independently.
 */

/** Category of a venue zone, used to weight crowd-flow behaviour. */
export type ZoneKind = "gate" | "concourse" | "stand" | "concession" | "transit" | "medical";

/**
 * A discrete area of the venue, and the unit the crowd model reports against.
 *
 * Not sensor-instrumented: no hardware is connected to this project. Occupancy
 * for a zone is derived analytically from the match clock — see `crowd-model.ts`
 * — and calling a zone "instrumented" would claim the one thing the README is
 * careful not to.
 */
export interface Zone {
	readonly id: string;
	readonly name: string;
	readonly kind: ZoneKind;
	/** Normalised x position in the range 0..100. */
	readonly x: number;
	/** Normalised y position in the range 0..100. */
	readonly y: number;
	/** Maximum safe occupancy, in people. */
	readonly capacity: number;
	/** True when the zone is reachable without stairs or escalators. */
	readonly stepFree: boolean;
}

/** A bidirectional walkway between two zones. */
export interface Walkway {
	readonly from: string;
	readonly to: string;
	/** Traversal distance in metres. */
	readonly metres: number;
	/** True when the walkway has no stairs (ramp or level access). */
	readonly stepFree: boolean;
}

/**
 * Every zone the venue is modelled as.
 *
 * The single source of truth for the topology: the crowd model reads one
 * per zone, the router walks between them, and the itinerary planner derives
 * its accessible gates from them. Adding a zone here adds it everywhere.
 */
export const ZONES: readonly Zone[] = [
	{ id: "gate-a", name: "Gate A — North", kind: "gate", x: 50, y: 6, capacity: 2400, stepFree: true },
	{ id: "gate-b", name: "Gate B — East", kind: "gate", x: 92, y: 50, capacity: 2400, stepFree: true },
	{ id: "gate-c", name: "Gate C — South", kind: "gate", x: 50, y: 94, capacity: 2400, stepFree: false },
	{ id: "gate-d", name: "Gate D — West", kind: "gate", x: 8, y: 50, capacity: 2400, stepFree: true },
	{ id: "conc-n", name: "North Concourse", kind: "concourse", x: 50, y: 22, capacity: 5200, stepFree: true },
	{ id: "conc-e", name: "East Concourse", kind: "concourse", x: 76, y: 50, capacity: 5200, stepFree: true },
	{ id: "conc-s", name: "South Concourse", kind: "concourse", x: 50, y: 78, capacity: 5200, stepFree: true },
	{ id: "conc-w", name: "West Concourse", kind: "concourse", x: 24, y: 50, capacity: 5200, stepFree: true },
	{ id: "stand-n", name: "North Stand", kind: "stand", x: 50, y: 34, capacity: 18000, stepFree: false },
	{ id: "stand-s", name: "South Stand", kind: "stand", x: 50, y: 66, capacity: 18000, stepFree: false },
	// Accessible seating platforms. Real host venues provide level-access
	// wheelchair positions served by lifts rather than the stepped bowl
	// entrances, so step-free routing must have a genuine destination to reach.
	{ id: "access-n", name: "North Accessible Platform", kind: "stand", x: 38, y: 34, capacity: 240, stepFree: true },
	{ id: "access-s", name: "South Accessible Platform", kind: "stand", x: 62, y: 66, capacity: 240, stepFree: true },
	{ id: "food-ne", name: "Concessions NE", kind: "concession", x: 68, y: 30, capacity: 900, stepFree: true },
	{ id: "food-sw", name: "Concessions SW", kind: "concession", x: 32, y: 70, capacity: 900, stepFree: true },
	{ id: "medical-w", name: "Medical Post West", kind: "medical", x: 16, y: 34, capacity: 120, stepFree: true },
	{ id: "rail", name: "Rail Link — Meadowlands", kind: "transit", x: 92, y: 14, capacity: 3600, stepFree: true },
	{ id: "bus", name: "Bus Terminal", kind: "transit", x: 8, y: 86, capacity: 2200, stepFree: true },
] as const;

/**
 * Every walkway joining two zones.
 *
 * Declared once per pair, in one direction, but read as bidirectional
 * throughout — a fan walks a corridor either way. Consumers must therefore
 * match on `from` and `to` in both orders rather than assume the order below.
 */
export const WALKWAYS: readonly Walkway[] = [
	{ from: "rail", to: "gate-a", metres: 260, stepFree: true },
	{ from: "rail", to: "gate-b", metres: 240, stepFree: true },
	{ from: "bus", to: "gate-c", metres: 220, stepFree: false },
	{ from: "bus", to: "gate-d", metres: 280, stepFree: true },
	{ from: "gate-a", to: "conc-n", metres: 90, stepFree: true },
	{ from: "gate-b", to: "conc-e", metres: 90, stepFree: true },
	{ from: "gate-c", to: "conc-s", metres: 90, stepFree: false },
	{ from: "gate-d", to: "conc-w", metres: 90, stepFree: true },
	{ from: "conc-n", to: "conc-e", metres: 150, stepFree: true },
	{ from: "conc-e", to: "conc-s", metres: 150, stepFree: true },
	{ from: "conc-s", to: "conc-w", metres: 150, stepFree: true },
	{ from: "conc-w", to: "conc-n", metres: 150, stepFree: true },
	{ from: "conc-n", to: "stand-n", metres: 70, stepFree: false },
	{ from: "conc-s", to: "stand-s", metres: 70, stepFree: false },
	{ from: "conc-n", to: "food-ne", metres: 80, stepFree: true },
	{ from: "conc-s", to: "food-sw", metres: 80, stepFree: true },
	{ from: "conc-w", to: "medical-w", metres: 60, stepFree: true },
	{ from: "conc-e", to: "stand-n", metres: 130, stepFree: true },
	{ from: "conc-w", to: "stand-s", metres: 130, stepFree: true },
	// Lift-served level access to the accessible platforms.
	{ from: "conc-n", to: "access-n", metres: 85, stepFree: true },
	{ from: "conc-s", to: "access-s", metres: 85, stepFree: true },
] as const;

const ZONES_BY_ID: ReadonlyMap<string, Zone> = new Map(ZONES.map((z) => [z.id, z]));

/** Look up a zone by id, or `undefined` when no such zone exists. */
export function getZone(id: string): Zone | undefined {
	return ZONES_BY_ID.get(id);
}

/** True when `id` refers to a known zone. */
export function isKnownZone(id: string): boolean {
	return ZONES_BY_ID.has(id);
}
