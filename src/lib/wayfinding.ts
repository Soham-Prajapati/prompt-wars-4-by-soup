/**
 * Crowd-aware accessible wayfinding.
 *
 * Computes the lowest-cost walking route between two zones using Dijkstra's
 * algorithm over the venue walkway graph. Edge cost blends physical distance
 * with live congestion, so the router steers fans away from packed concourses
 * rather than returning the shortest path in metres.
 *
 * When step-free routing is requested, stepped walkways and stepped zones are
 * excluded from the graph entirely — an accessibility guarantee enforced by
 * construction, not by post-filtering a route that may already be unusable.
 */
import { type VenueSnapshot } from "@/lib/crowd-model";
import { WALKWAYS, getZone, type Walkway } from "@/lib/venue";

/** A computed route between two zones. */
export interface Route {
	/** Ordered zone ids from origin to destination, inclusive. */
	readonly path: readonly string[];
	/** Human-readable zone names, parallel to `path`. */
	readonly names: readonly string[];
	/** Total physical walking distance in metres. */
	readonly metres: number;
	/** Estimated walking time in minutes, including congestion slowdown. */
	readonly minutes: number;
	/** True when every hop on the route is step-free. */
	readonly stepFree: boolean;
	/** Mean density across the zones on the route, 0..1. */
	readonly meanDensity: number;
}

/** Options controlling route selection. */
export interface RouteOptions {
	/** When true, only step-free zones and walkways may be used. */
	readonly stepFreeOnly: boolean;
}

/** Comfortable walking pace on an empty concourse, in metres per minute. */
const WALK_METRES_PER_MINUTE = 75;

/**
 * Congestion multiplier applied to an edge cost.
 *
 * Rises steeply with density so that a near-critical zone becomes expensive
 * enough for the router to detour around it. At density 1.0 an edge costs four
 * times its free-flow length.
 */
function congestionFactor(density: number): number {
	return 1 + 3 * density * density;
}

/** Build an adjacency list, omitting edges that violate the given options. */
function buildGraph(options: RouteOptions): ReadonlyMap<string, readonly Walkway[]> {
	const graph = new Map<string, Walkway[]>();

	const usable = (w: Walkway): boolean => {
		if (!options.stepFreeOnly) return true;
		if (!w.stepFree) return false;
		const from = getZone(w.from);
		const to = getZone(w.to);
		return from?.stepFree === true && to?.stepFree === true;
	};

	for (const walkway of WALKWAYS) {
		if (!usable(walkway)) continue;
		// Walkways are bidirectional; store both directions.
		const forward: Walkway = walkway;
		const reverse: Walkway = { ...walkway, from: walkway.to, to: walkway.from };
		for (const edge of [forward, reverse]) {
			const existing = graph.get(edge.from);
			if (existing) existing.push(edge);
			else graph.set(edge.from, [edge]);
		}
	}

	return graph;
}

/**
 * True when every zone on `path`, and every walkway joining them, is step-free.
 *
 * @param path Ordered zone ids forming a contiguous route.
 */
function isPathStepFree(path: readonly string[]): boolean {
	for (const id of path) {
		if (getZone(id)?.stepFree !== true) return false;
	}
	for (let i = 0; i + 1 < path.length; i += 1) {
		const from = path[i];
		const to = path[i + 1];
		if (from === undefined || to === undefined) return false;
		const edge = WALKWAYS.find(
			(w) => (w.from === from && w.to === to) || (w.from === to && w.to === from),
		);
		if (edge?.stepFree !== true) return false;
	}
	return true;
}

/**
 * Find the lowest-cost route between two zones.
 *
 * @param originId Zone id to start from.
 * @param destinationId Zone id to finish at.
 * @param snapshot Live venue state used to weight congestion.
 * @param options Route constraints.
 * @returns The route, or `null` when no path satisfies the constraints.
 */
export function findRoute(
	originId: string,
	destinationId: string,
	snapshot: VenueSnapshot,
	options: RouteOptions,
): Route | null {
	if (!getZone(originId) || !getZone(destinationId)) return null;
	if (originId === destinationId) {
		const zone = getZone(originId);
		if (!zone) return null;
		return { path: [originId], names: [zone.name], metres: 0, minutes: 0, stepFree: true, meanDensity: 0 };
	}

	const graph = buildGraph(options);
	const densityById = new Map(snapshot.zones.map((z) => [z.zoneId, z.density]));

	const cost = new Map<string, number>([[originId, 0]]);
	const metres = new Map<string, number>([[originId, 0]]);
	const previous = new Map<string, string>();
	const settled = new Set<string>();

	// Linear-scan frontier. The venue graph is 17 nodes, so a binary heap would
	// add complexity without measurable benefit.
	const frontier = new Set<string>([originId]);

	while (frontier.size > 0) {
		let current: string | null = null;
		let best = Infinity;
		for (const id of frontier) {
			const c = cost.get(id) ?? Infinity;
			if (c < best) {
				best = c;
				current = id;
			}
		}
		if (current === null) break;

		frontier.delete(current);
		settled.add(current);
		if (current === destinationId) break;

		for (const edge of graph.get(current) ?? []) {
			if (settled.has(edge.to)) continue;
			const density = densityById.get(edge.to) ?? 0;
			const stepCost = edge.metres * congestionFactor(density);
			const nextCost = (cost.get(current) ?? Infinity) + stepCost;

			if (nextCost < (cost.get(edge.to) ?? Infinity)) {
				cost.set(edge.to, nextCost);
				metres.set(edge.to, (metres.get(current) ?? 0) + edge.metres);
				previous.set(edge.to, current);
				frontier.add(edge.to);
			}
		}
	}

	if (!settled.has(destinationId)) return null;

	// Walk the predecessor chain back to the origin.
	const path: string[] = [];
	let cursor: string | undefined = destinationId;
	while (cursor !== undefined) {
		path.unshift(cursor);
		cursor = previous.get(cursor);
	}

	const densities = path.map((id) => densityById.get(id) ?? 0);
	const meanDensity = densities.reduce((a, b) => a + b, 0) / densities.length;
	const totalMetres = metres.get(destinationId) ?? 0;
	const totalCost = cost.get(destinationId) ?? 0;

	// Derive step-free status from the route itself rather than echoing the
	// request flag: an unconstrained search may still return a fully step-free
	// path, and callers rely on this field to describe the route as computed.
	const stepFree = isPathStepFree(path);

	return {
		path,
		names: path.map((id) => getZone(id)?.name ?? id),
		metres: totalMetres,
		minutes: Math.round((totalCost / WALK_METRES_PER_MINUTE) * 10) / 10,
		stepFree,
		meanDensity: Math.round(meanDensity * 1000) / 1000,
	};
}
