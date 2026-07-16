/**
 * Deterministic crowd-density model.
 *
 * IMPORTANT — this is a *simulation*, not a live sensor feed. No BLE, Wi-Fi or
 * CCTV hardware is connected. Every reading is derived analytically from the
 * match clock so that the same timestamp always yields the same state.
 *
 * Determinism is a deliberate design choice: it makes the model a pure
 * function, which is exercisable in unit tests without mocks or fake timers,
 * and it lets the dashboard and the AI advisor observe identical state without
 * sharing mutable storage — a requirement on stateless serverless runtimes.
 *
 * Density semantics: occupancy divided by capacity, clamped to 0..1.
 */
import { ZONES, type Zone } from "@/lib/venue";

/** Phase of the matchday operation, which dominates crowd distribution. */
export type MatchPhase = "pre-match" | "first-half" | "half-time" | "second-half" | "egress";

/** Operational severity band derived from density. */
export type AlertLevel = "normal" | "elevated" | "high" | "critical";

/** A density reading for a single zone at a single instant. */
export interface ZoneReading {
	readonly zoneId: string;
	readonly name: string;
	readonly kind: Zone["kind"];
	readonly x: number;
	readonly y: number;
	/** Occupancy ratio in the range 0..1. */
	readonly density: number;
	/** Estimated people present, derived from density and capacity. */
	readonly occupancy: number;
	/** Estimated queue wait in minutes; 0 for zones without a queue. */
	readonly waitMinutes: number;
	readonly alert: AlertLevel;
}

/** A complete venue snapshot at one instant of the match clock. */
export interface VenueSnapshot {
	/** Minutes elapsed since gates opened. */
	readonly clockMinutes: number;
	readonly phase: MatchPhase;
	readonly zones: readonly ZoneReading[];
	/** Mean density across all zones, 0..1. */
	readonly meanDensity: number;
	/**
	 * Aggregate Fan Friction Score, 0..100 (lower is better).
	 *
	 * Defined as the mean of squared zone densities, scaled to 0..100. Squaring
	 * is intentional: it penalises a single dangerously-packed zone far more
	 * than uniform moderate occupancy, which matches operational risk.
	 */
	readonly frictionScore: number;
}

/** Density at or above which a zone is considered critical. */
const CRITICAL_THRESHOLD = 0.85;
/** Density at or above which a zone is considered high. */
const HIGH_THRESHOLD = 0.65;
/** Density at or above which a zone is considered elevated. */
const ELEVATED_THRESHOLD = 0.4;

/** Total duration of the simulated matchday operation, in minutes. */
export const MATCHDAY_MINUTES = 210;

/**
 * Classify a density value into an operational alert band.
 *
 * @param density Occupancy ratio in the range 0..1.
 */
export function alertFor(density: number): AlertLevel {
	if (density >= CRITICAL_THRESHOLD) return "critical";
	if (density >= HIGH_THRESHOLD) return "high";
	if (density >= ELEVATED_THRESHOLD) return "elevated";
	return "normal";
}

/**
 * Determine the matchday phase for a point on the match clock.
 *
 * @param clockMinutes Minutes since gates opened (0 = gates open).
 */
export function phaseFor(clockMinutes: number): MatchPhase {
	if (clockMinutes < 45) return "pre-match";
	if (clockMinutes < 90) return "first-half";
	if (clockMinutes < 105) return "half-time";
	if (clockMinutes < 150) return "second-half";
	return "egress";
}

/**
 * Deterministic pseudo-noise in the range -1..1.
 *
 * A hash-like sine mix, not a PRNG: it carries no state, so it stays pure and
 * reproducible across processes and across serverless invocations.
 */
function noise(seed: number): number {
	return Math.sin(seed * 12.9898) * 43758.5453 % 1;
}

/**
 * Baseline density for a zone during a given phase, before noise is applied.
 *
 * Encodes the operational reality of a matchday: gates and transit saturate
 * before kick-off and again at egress; stands fill during play; concessions
 * spike at half-time.
 */
function baseDensity(zone: Zone, phase: MatchPhase): number {
	switch (zone.kind) {
		case "gate":
			return phase === "pre-match" ? 0.82 : phase === "egress" ? 0.7 : 0.12;
		case "transit":
			return phase === "pre-match" ? 0.68 : phase === "egress" ? 0.88 : 0.1;
		case "stand":
			return phase === "first-half" || phase === "second-half" ? 0.9 : phase === "half-time" ? 0.55 : 0.3;
		case "concession":
			return phase === "half-time" ? 0.92 : phase === "pre-match" ? 0.6 : 0.25;
		case "concourse":
			return phase === "half-time" ? 0.78 : phase === "egress" ? 0.75 : phase === "pre-match" ? 0.55 : 0.2;
		case "medical":
			return 0.15;
	}
}

/**
 * Estimated queue wait for a zone, in minutes.
 *
 * Only gates, concessions and transit have meaningful queues. Wait grows
 * super-linearly with density, reflecting service-rate collapse under load.
 */
function waitFor(zone: Zone, density: number): number {
	const queues: readonly Zone["kind"][] = ["gate", "concession", "transit"];
	if (!queues.includes(zone.kind)) return 0;
	return Math.round(density * density * 26 * 10) / 10;
}

/**
 * Compute the density reading for one zone at one instant.
 *
 * @param zone The zone to evaluate.
 * @param clockMinutes Minutes since gates opened.
 */
export function readZone(zone: Zone, clockMinutes: number): ZoneReading {
	const phase = phaseFor(clockMinutes);
	const base = baseDensity(zone, phase);

	// Slow drift across the phase plus a per-zone offset, so neighbouring zones
	// never move in lockstep.
	const drift = Math.sin((clockMinutes / 18) + zone.x) * 0.06;
	const jitter = noise(clockMinutes + zone.y) * 0.05;

	const raw = Math.min(1, Math.max(0, base + drift + jitter));

	// Round once, then derive every dependent field from the rounded value.
	// Deriving `alert` from the unrounded density would let a reading of 0.850
	// report as "high", contradicting its own published density.
	const density = Math.round(raw * 1000) / 1000;

	return {
		zoneId: zone.id,
		name: zone.name,
		kind: zone.kind,
		x: zone.x,
		y: zone.y,
		density,
		occupancy: Math.round(density * zone.capacity),
		waitMinutes: waitFor(zone, density),
		alert: alertFor(density),
	};
}

/**
 * Compute a full venue snapshot for a point on the match clock.
 *
 * @param clockMinutes Minutes since gates opened; wrapped into 0..MATCHDAY_MINUTES.
 */
export function snapshotAt(clockMinutes: number): VenueSnapshot {
	const clock = ((clockMinutes % MATCHDAY_MINUTES) + MATCHDAY_MINUTES) % MATCHDAY_MINUTES;
	const zones = ZONES.map((z) => readZone(z, clock));

	const meanDensity = zones.reduce((sum, z) => sum + z.density, 0) / zones.length;
	const meanSquared = zones.reduce((sum, z) => sum + z.density * z.density, 0) / zones.length;

	return {
		clockMinutes: clock,
		phase: phaseFor(clock),
		zones,
		meanDensity: Math.round(meanDensity * 1000) / 1000,
		frictionScore: Math.round(meanSquared * 100 * 10) / 10,
	};
}

/**
 * Map wall-clock time onto the simulated match clock.
 *
 * The matchday loops continuously so the deployed demo always shows an active
 * operation regardless of when it is opened.
 *
 * @param now Milliseconds since the Unix epoch.
 */
export function clockFromWallTime(now: number): number {
	return Math.floor(now / 1000 / 4) % MATCHDAY_MINUTES;
}
