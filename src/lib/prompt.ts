/**
 * Shared prompt fragments.
 *
 * A zone reading reaches a model as a line of text, and the wording of that line
 * is a contract: the tests assert what a prompt contains, and the models are
 * told to reuse the zone names verbatim. Three routes were rendering that line
 * from three copies of the same function, which is three places for the contract
 * to drift and only one of them would be caught by any given test.
 *
 * The renderings come in pairs — one per audience — rather than one apiece,
 * because the audiences genuinely differ. A fan, or the volunteer steward
 * answering them, needs to know whether they can get in without steps and
 * whether the queue is about to grow; a duty manager needs the zone id to type
 * into a radio call, a head count to justify moving staff, and the alert band it
 * is about to cross into. Collapsing either pair into one line would give each
 * audience the other's noise.
 *
 * The `*ForOps` and `*ForFan` split is the same distinction throughout, so a
 * caller picks a register once and every line it renders agrees.
 */
import { type TrendReading, type ZoneReading } from "@/lib/crowd-model";
import { getZone } from "@/lib/venue";

/**
 * Render a change with an explicit sign.
 *
 * A delta of `3` printed bare is ambiguous in a table of changes — it reads as a
 * value as easily as a movement. `+3` cannot. Negative values already carry
 * their sign, and zero is left bare because `+0` reads as a rise that did not
 * happen.
 *
 * Exported because both prompt registers state deltas — the per-zone lines here
 * and the venue-level friction line the advisor composes — and two copies of a
 * sign convention is two places for the model to be shown a movement it cannot
 * tell the direction of.
 *
 * @param value The signed change to render.
 */
export function signed(value: number): string {
	return value > 0 ? `+${String(value)}` : String(value);
}

/**
 * Render one zone reading as a fan-facing prompt line.
 *
 * Names the queue only when there is one, and always names the step-free status,
 * because "no mention of steps" and "no steps" are not the same claim and a fan
 * reading the model's reply cannot tell them apart.
 *
 * @param zone The live reading to describe.
 * @returns A single prompt line, prefixed with `- `.
 */
export function describeZoneForFan(zone: ZoneReading): string {
	const wait = zone.waitMinutes > 0 ? `, about ${String(zone.waitMinutes)} min queue` : "";
	const access = getZone(zone.zoneId)?.stepFree === true ? "step-free access" : "steps on approach";
	const pct = Math.round(zone.density * 100);
	return `- ${zone.name} (${zone.kind}): ${String(pct)}% full, alert ${zone.alert}${wait}, ${access}`;
}

/**
 * Render one zone reading as an operations-facing prompt line.
 *
 * Carries the zone id and the absolute head count on top of the fan-facing
 * figures: an action addressed to staff has to name the zone the way the radio
 * and the incident log name it, and "91% full" is not a number anyone can deploy
 * stewards against.
 *
 * @param zone The live reading to describe.
 * @returns A single prompt line, prefixed with `- `.
 */
export function describeZoneForOps(zone: ZoneReading): string {
	const wait = zone.waitMinutes > 0 ? `, queue ${String(zone.waitMinutes)} min` : "";
	const pct = Math.round(zone.density * 100);
	return `- ${zone.name} (id: ${zone.zoneId}, ${zone.kind}): ${String(pct)}% full, ${String(zone.occupancy)} people${wait}, alert ${zone.alert}`;
}

/**
 * Render one zone's projection as an operations-facing prompt line.
 *
 * Both endpoints, never just the direction. "Gate B rising" is not an action;
 * "Gate B 62% → 79%, alert elevated → high" tells the duty manager what will be
 * true when the lanes they open now are finally open, which is the only reason
 * this line is in the prompt at all.
 *
 * The alert transition is stated only when the band actually changes: a zone
 * crossing into `high` is the event worth acting on, and printing
 * `alert high → high` for the fifteen zones that did nothing would bury it.
 *
 * @param trend The live projection to describe.
 * @returns A single prompt line, prefixed with `- `.
 */
export function describeTrendForOps(trend: TrendReading): string {
	const now = Math.round(trend.density * 100);
	const then = Math.round(trend.projectedDensity * 100);
	const delta = signed(then - now);

	const band = trend.projectedAlert === trend.alert ? "" : `, alert ${trend.alert} → ${trend.projectedAlert}`;
	const queue =
		trend.waitMinutes > 0 || trend.projectedWaitMinutes > 0
			? `, queue ${String(trend.waitMinutes)} → ${String(trend.projectedWaitMinutes)} min`
			: "";

	return `- ${trend.name} (id: ${trend.zoneId}): ${String(now)}% → ${String(then)}% (${delta} pts, ${trend.trend})${band}${queue}`;
}

/**
 * Render one zone's projection in the register a steward is briefed in.
 *
 * A volunteer on a post does not read an alert band or a percentage-point delta;
 * they need to know whether it is about to get busier or quieter than the moment
 * they are stood in, and roughly how much of a queue to expect. So this says it
 * in words and keeps exactly one number a steward can act on — the queue they
 * will be asked about.
 *
 * The horizon is deliberately not named here. The line describes a movement, not
 * a duration, and the caller's header already states how far ahead it is looking
 * — a "15 minutes" written into this string would be a second, unchecked copy of
 * `FORECAST_HORIZON_MINUTES` that no test would catch going stale.
 *
 * @param trend The live projection to describe.
 * @returns A single prompt line, prefixed with `- `.
 */
export function describeTrendForFan(trend: TrendReading): string {
	const direction =
		trend.trend === "rising"
			? "getting busier"
			: trend.trend === "falling"
				? "getting quieter"
				: "staying about as busy as it is now";

	const then = Math.round(trend.projectedDensity * 100);
	const queue =
		trend.projectedWaitMinutes > 0 ? `, with about a ${String(trend.projectedWaitMinutes)} min queue` : "";

	return `- This post is ${direction}: about ${String(then)}% full${queue}.`;
}
