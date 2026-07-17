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

/** Direction of travel of a measure between now and a forecast horizon. */
export type Trend = "rising" | "falling" | "steady";

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

/**
 * How one zone is expected to move between now and the forecast horizon.
 *
 * Carries both endpoints rather than just the delta: an operator deciding
 * whether to act needs to know that a gate goes from 62% to 79%, not merely that
 * it rose by 17. "Rising" is not an instruction on its own — the level it is
 * rising *to* is what distinguishes a zone worth watching from one worth
 * staffing.
 */
export interface TrendReading {
	readonly zoneId: string;
	readonly name: string;
	readonly kind: Zone["kind"];
	/** Occupancy ratio now, 0..1. */
	readonly density: number;
	/** Occupancy ratio projected at the horizon, 0..1. */
	readonly projectedDensity: number;
	/** `projectedDensity - density`, so negative means emptying. */
	readonly densityDelta: number;
	/** Alert band now. */
	readonly alert: AlertLevel;
	/** Alert band projected at the horizon. */
	readonly projectedAlert: AlertLevel;
	/** Estimated queue wait now, in minutes; 0 for zones without a queue. */
	readonly waitMinutes: number;
	/** Estimated queue wait projected at the horizon, in minutes. */
	readonly projectedWaitMinutes: number;
	readonly trend: Trend;
}

/**
 * A projection of the whole venue from one instant to a horizon ahead of it.
 *
 * This is what separates an operational readout from operational intelligence:
 * the snapshot says a gate is busy, the forecast says it is *becoming* busy, and
 * only the second one can be acted on before the queue exists.
 *
 * It is as deterministic as the snapshot it projects from, and for the same
 * reason: the crowd model is a pure function of the match clock, so the state at
 * `clock + horizon` is not estimated or extrapolated — it is simply read. This
 * is a property of the simulation, not a claim about forecasting real crowds. A
 * sensor-fed deployment would need a genuine predictive model here; the shape of
 * what it would return is exactly this.
 */
export interface VenueForecast {
	/** Minutes since gates opened, at the instant projected *from*. */
	readonly clockMinutes: number;
	/** How far ahead the projection looks, in minutes. */
	readonly horizonMinutes: number;
	/** Minutes since gates opened, at the instant projected *to*. */
	readonly horizonClockMinutes: number;
	/** Matchday phase at the horizon, which may differ from the phase now. */
	readonly horizonPhase: MatchPhase;
	readonly zones: readonly TrendReading[];
	/** Aggregate Fan Friction Score projected at the horizon, 0..100. */
	readonly projectedFrictionScore: number;
	/** Projected friction minus current friction, so negative means improving. */
	readonly frictionDelta: number;
	/** Venue-level direction of travel, classified from {@link frictionDelta}. */
	readonly trend: Trend;
}

/**
 * The live venue state and the projection anchored to the same instant.
 *
 * The pairing is the point. Reading the wall clock twice — once for a snapshot,
 * once for a forecast — lets the two straddle a tick and describe different
 * minutes, which is precisely the disagreement `currentSnapshot` exists to
 * prevent between the map and the advisor.
 */
export interface VenueReport {
	readonly snapshot: VenueSnapshot;
	readonly forecast: VenueForecast;
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
 * How far ahead {@link currentReport} projects, in minutes.
 *
 * Fifteen, for two independent reasons that happen to agree.
 *
 * Operationally, it is the shortest horizon a duty manager can still *use*. An
 * action at a venue — opening extra entry lanes, moving stewards to a concourse,
 * holding a stand back at egress — has to be decided, radioed, walked to and
 * physically taken effect. A five-minute warning arrives after the queue does. A
 * sixty-minute warning is a different job: it is planning, and the operator
 * cannot hold sixty minutes of projected state in their head while working the
 * floor.
 *
 * Structurally, it is the length of the shortest matchday phase (half-time, 15
 * min — see {@link phaseFor}). A horizon longer than that could skip a phase
 * entirely, so the projection would report the state *after* an event without
 * ever reporting the event: at clock 88 a 30-minute horizon reads the second
 * half and never mentions the half-time concessions rush it jumps over. At 15
 * the projection crosses at most one phase boundary, and crossing a boundary is
 * exactly what an operator needs the warning for.
 */
export const FORECAST_HORIZON_MINUTES = 15;

/**
 * Density change below which a zone counts as steady rather than moving.
 *
 * The model carries per-zone drift and jitter of a few points, so a bare
 * `projected > current` test would classify noise as a trend and flag all 17
 * zones as moving at every clock. Five points of occupancy is the smallest
 * change that survives that noise and would still change what an operator does.
 */
export const TREND_DENSITY_DEADBAND = 0.05;

/**
 * Friction change below which the venue counts as steady rather than moving.
 *
 * Stated on the published 0..100 scale, so it is read against the number the
 * console actually shows. Friction is a mean of squared densities, so it moves
 * less than any single zone does — a deadband of 2 points here is roughly as
 * strict as {@link TREND_DENSITY_DEADBAND} is per zone.
 */
export const TREND_FRICTION_DEADBAND = 2;

/**
 * Classify a change as rising, falling, or steady within a deadband.
 *
 * The deadband is a parameter rather than a constant because the two things this
 * classifies are measured on different scales — a 0..1 density and a 0..100
 * friction index — and one hard-coded threshold could only be right for one of
 * them.
 *
 * Boundaries are inclusive: a delta of exactly `deadband` is rising, and exactly
 * `-deadband` is falling. A zone sitting precisely on the threshold is one an
 * operator should be told about rather than one to round away.
 *
 * @param delta Signed change, in the same units as `deadband`.
 * @param deadband Magnitude below which the change is not worth reporting; must
 *   be non-negative.
 */
export function classifyTrend(delta: number, deadband: number): Trend {
	if (delta >= deadband) return "rising";
	if (delta <= -deadband) return "falling";
	return "steady";
}

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
 * Fold an arbitrary clock reading into 0..MATCHDAY_MINUTES.
 *
 * The matchday loops, and JS `%` is remainder rather than modulo, so a negative
 * input needs the second correction to land in range instead of mirroring below
 * zero.
 */
function wrapClock(clockMinutes: number): number {
	return ((clockMinutes % MATCHDAY_MINUTES) + MATCHDAY_MINUTES) % MATCHDAY_MINUTES;
}

/**
 * Aggregate Fan Friction Score for a set of zone densities, 0..100.
 *
 * Lives apart from {@link snapshotAt} because the forecast scores a *projected*
 * set of densities with the same definition. Two copies of "mean of squares,
 * scaled" would let the number the console shows and the number the forecast
 * compares it against drift apart, which would make every reported delta wrong
 * while both endpoints looked plausible.
 */
function frictionOf(densities: readonly number[]): number {
	const meanSquared = densities.reduce((sum, d) => sum + d * d, 0) / densities.length;
	return Math.round(meanSquared * 100 * 10) / 10;
}

/**
 * Compute a full venue snapshot for a point on the match clock.
 *
 * @param clockMinutes Minutes since gates opened; wrapped into 0..MATCHDAY_MINUTES.
 */
export function snapshotAt(clockMinutes: number): VenueSnapshot {
	const clock = wrapClock(clockMinutes);
	const zones = ZONES.map((z) => readZone(z, clock));

	const meanDensity = zones.reduce((sum, z) => sum + z.density, 0) / zones.length;

	return {
		clockMinutes: clock,
		phase: phaseFor(clock),
		zones,
		meanDensity: Math.round(meanDensity * 1000) / 1000,
		frictionScore: frictionOf(zones.map((z) => z.density)),
	};
}

/**
 * Project the venue from one point on the match clock to a horizon ahead of it.
 *
 * Pure, and deterministic in both arguments: the projection is the crowd model
 * evaluated at `clockMinutes + horizonMinutes`, not a curve fitted to recent
 * history. Both ends of the horizon wrap independently, so a projection made
 * near the end of the matchday reads into the start of the next one rather than
 * running off the end of the clock.
 *
 * @param clockMinutes Minutes since gates opened; wrapped into 0..MATCHDAY_MINUTES.
 * @param horizonMinutes How far ahead to look. Wrapping makes any value legal;
 *   {@link FORECAST_HORIZON_MINUTES} explains why the app passes 15.
 */
export function forecastAt(clockMinutes: number, horizonMinutes: number): VenueForecast {
	const clock = wrapClock(clockMinutes);
	const horizonClock = wrapClock(clockMinutes + horizonMinutes);

	// Read each zone at both instants rather than diffing two full snapshots:
	// pairing readings by id would need a lookup that can miss, and the pair is
	// the unit of work here.
	const zones: readonly TrendReading[] = ZONES.map((zone) => {
		const current = readZone(zone, clock);
		const projected = readZone(zone, horizonClock);

		// Rounded to the same 3dp as the densities it is derived from. Subtracting
		// two rounded values in binary floating point yields things like
		// 0.16999999999999998, and a delta published next to the two figures it
		// claims to be the difference of has to actually be their difference.
		const densityDelta = Math.round((projected.density - current.density) * 1000) / 1000;

		return {
			zoneId: zone.id,
			name: zone.name,
			kind: zone.kind,
			density: current.density,
			projectedDensity: projected.density,
			densityDelta,
			alert: current.alert,
			projectedAlert: projected.alert,
			waitMinutes: current.waitMinutes,
			projectedWaitMinutes: projected.waitMinutes,
			trend: classifyTrend(densityDelta, TREND_DENSITY_DEADBAND),
		};
	});

	const projectedFrictionScore = frictionOf(zones.map((z) => z.projectedDensity));
	const frictionScore = frictionOf(zones.map((z) => z.density));
	const frictionDelta = Math.round((projectedFrictionScore - frictionScore) * 10) / 10;

	return {
		clockMinutes: clock,
		horizonMinutes,
		horizonClockMinutes: horizonClock,
		horizonPhase: phaseFor(horizonClock),
		zones,
		projectedFrictionScore,
		frictionDelta,
		trend: classifyTrend(frictionDelta, TREND_FRICTION_DEADBAND),
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

/**
 * The venue snapshot for this instant of wall-clock time.
 *
 * Every route handler needs exactly this — `snapshotAt(clockFromWallTime(now))`
 * — and each one spelling it out invites one of them to drift onto a different
 * clock, at which point the dashboard and the advisor would be reasoning over
 * different venues while both claiming to read "live" state.
 *
 * Impure only in reading the clock; the mapping from that instant to a snapshot
 * stays the pure, deterministic function the rest of this module documents.
 *
 * @returns The snapshot at `Date.now()`.
 */
export function currentSnapshot(): VenueSnapshot {
	return snapshotAt(clockFromWallTime(Date.now()));
}

/**
 * The venue snapshot and its {@link FORECAST_HORIZON_MINUTES} forecast for this
 * instant, both anchored to a single reading of the wall clock.
 *
 * The single read is the whole reason this exists rather than the callers
 * composing `currentSnapshot()` with `currentForecast()`. The match clock
 * advances every four real seconds, so two independent reads can straddle a
 * tick — and then the response says the venue is at minute 30 while the forecast
 * attached to it projects from minute 31. The delta between them would be
 * measured against a state the caller was never shown, which is the exact class
 * of disagreement `currentSnapshot` was extracted to prevent.
 *
 * Impure only in reading the clock; both mappings from that instant stay pure.
 *
 * @returns The snapshot and forecast at `Date.now()`.
 */
export function currentReport(): VenueReport {
	const clock = clockFromWallTime(Date.now());
	return {
		snapshot: snapshotAt(clock),
		forecast: forecastAt(clock, FORECAST_HORIZON_MINUTES),
	};
}
