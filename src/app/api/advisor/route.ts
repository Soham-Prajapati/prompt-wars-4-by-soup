/**
 * `POST /api/advisor` — operational decision support for the people on shift.
 *
 * Two audiences, one grounding. Both documents are written from the same live
 * report — the snapshot the map is drawing and the projection anchored to the
 * same instant — so neither can be reasoning over a venue the other cannot see.
 *
 * What differs is scope and register. The duty manager gets the full zone table
 * and a ranking across all of it, because their job is to decide where the next
 * intervention goes. A steward gets exactly the post they are stood at, in plain
 * language, because their job is the fans in front of them and knowing when the
 * situation stops being theirs.
 *
 * The forecast is in both prompts for the same reason it exists: an action a
 * duty manager takes now lands in about fifteen minutes, so advice grounded only
 * in the present is advice that arrives after the queue it describes.
 */
import { NextResponse, type NextRequest } from "next/server";

import { handle, jsonOk, readJsonBody } from "@/lib/api";
import { DEFAULT_AUDIENCE, type Audience } from "@/lib/audience";
import { currentReport, type TrendReading, type VenueForecast, type VenueSnapshot } from "@/lib/crowd-model";
import { MODEL_NAME, generate } from "@/lib/gemini";
import { describeTrendForFan, describeTrendForOps, describeZoneForFan, describeZoneForOps, signed } from "@/lib/prompt";
import { advisorRequestSchema } from "@/lib/validation";
import { getZone } from "@/lib/venue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compose the duty-manager prompt: the whole venue, now and shortly.
 *
 * @param snapshot Live venue state, the only present facts the actions may cite.
 * @param forecast Projection anchored to the same instant as `snapshot`.
 * @param focusZoneId Zone to weight the advice towards, or `undefined` for none.
 */
function buildDutyManagerPrompt(
	snapshot: VenueSnapshot,
	forecast: VenueForecast,
	focusZoneId: string | undefined,
): string {
	const focusZone = focusZoneId === undefined ? undefined : getZone(focusZoneId);
	const focusLine =
		focusZone === undefined
			? "No specific zone is in focus; advise across the whole venue."
			: `The duty manager is focused on ${focusZone.name} (id: ${focusZone.id}). Weight your actions towards it, but do not ignore a more severe problem elsewhere.`;

	const horizon = String(forecast.horizonMinutes);

	return [
		`Matchday phase: ${snapshot.phase} (clock ${String(snapshot.clockMinutes)} min since gates opened).`,
		`Fan Friction Score: ${String(snapshot.frictionScore)}/100 (lower is better). Mean density: ${String(Math.round(snapshot.meanDensity * 100))}%.`,
		"",
		"Live zone readings:",
		...snapshot.zones.map(describeZoneForOps),
		"",
		`Projected ${horizon} minutes from now (phase ${forecast.horizonPhase}, clock ${String(forecast.horizonClockMinutes)} min):`,
		`Fan Friction Score: ${String(forecast.projectedFrictionScore)}/100 (${signed(forecast.frictionDelta)} vs now) — venue trend ${forecast.trend}.`,
		...forecast.zones.map(describeTrendForOps),
		"",
		focusLine,
		"",
		"Give the top 3 prioritised operational actions, most urgent first.",
		"Number them 1 to 3. Each action must be one or two sentences: the action itself,",
		"then the rationale citing the specific density, queue or alert level that justifies it.",
		`Any measure an operator takes now takes about ${horizon} minutes to reach the floor, so where`,
		"the projection above justifies acting before a problem arrives, prefer that action and cite",
		"the projected figure alongside the present one.",
		"Every action must name at least one zone exactly as it appears above.",
		"Reference only zones listed above. Do not invent zones, staff numbers or incidents.",
		"Do not project beyond the figures given; the numbers above are the only forecast you have.",
	].join("\n");
}

/**
 * Compose the steward prompt: one post, plain language, nothing else.
 *
 * Deliberately scoped to the steward's own zone. Handing a volunteer the venue
 * table would invite the model to send them somewhere they are not posted, and a
 * briefing that ranges across seventeen zones is one they cannot use while
 * talking to the fan in front of them.
 *
 * @param snapshot Live venue state, read for the steward's post only.
 * @param forecast Projection anchored to the same instant as `snapshot`.
 * @param zoneId The post the steward is standing at. `advisorRequestSchema`
 *   guarantees this is present and names a real zone for this audience, so the
 *   absent case is a validation bug rather than a request to serve — and it is
 *   handled by the same lookup that handles a zone with no reading, rather than
 *   by a separate check that could only ever fire if the schema were wrong.
 * @returns The prompt, or `null` when there is no live reading for the post.
 */
function buildStewardPrompt(
	snapshot: VenueSnapshot,
	forecast: VenueForecast,
	zoneId: string | undefined,
): string | null {
	const reading = snapshot.zones.find((zone) => zone.zoneId === zoneId);
	const trend: TrendReading | undefined = forecast.zones.find((zone) => zone.zoneId === zoneId);
	if (reading === undefined || trend === undefined) return null;

	return [
		`Matchday phase: ${snapshot.phase} (clock ${String(snapshot.clockMinutes)} min since gates opened).`,
		"",
		`You are briefing a volunteer steward posted at ${reading.name} for this shift.`,
		"They are not an operations professional. They have a radio, a high-visibility vest,",
		"and the fans immediately in front of them.",
		"",
		"Their post right now:",
		describeZoneForFan(reading),
		"",
		`What the next ${String(forecast.horizonMinutes)} minutes look like at that post:`,
		describeTrendForFan(trend),
		"",
		"Write their briefing under exactly these three headings, in this order:",
		"What you will see — one or two sentences on how busy the post is and where it is heading.",
		"What to tell fans — one or two sentences they can say out loud, word for word.",
		"When to escalate — one sentence naming a specific thing they can see or count that means",
		"they should call the duty manager on the radio. Not a feeling; something observable.",
		"",
		"Plain language. No jargon, no percentages, no alert-band names, no zone ids —",
		"say 'busy' or 'quiet', not '78% full' or 'alert high'.",
		"Address the steward directly as 'you'. 120 words maximum.",
		`Refer only to ${reading.name}. Do not mention any other part of the venue,`,
		"and do not invent staff numbers, incidents or instructions you were not given above.",
	].join("\n");
}

/**
 * Build the prompt for whichever audience asked.
 *
 * Exhaustive over `Audience`: adding a third audience without writing its prompt
 * is a compile error rather than a silent fall-through to the duty manager's.
 */
function buildPrompt(
	audience: Audience,
	snapshot: VenueSnapshot,
	forecast: VenueForecast,
	zoneId: string | undefined,
): string | null {
	switch (audience) {
		case "duty-manager":
			return buildDutyManagerPrompt(snapshot, forecast, zoneId);
		case "steward":
			return buildStewardPrompt(snapshot, forecast, zoneId);
	}
}

/** Produce advice for the current venue state, written for the requested audience. */
export async function POST(request: NextRequest): Promise<NextResponse> {
	return handle(async () => {
		const { zoneId, audience } = advisorRequestSchema.parse(await readJsonBody(request));
		const forAudience = audience ?? DEFAULT_AUDIENCE;

		const { snapshot, forecast } = currentReport();
		const prompt = buildPrompt(forAudience, snapshot, forecast, zoneId);
		if (prompt === null) throw new Error("The advisor prompt could not be composed for this request.");

		const actions = await generate(prompt);

		return jsonOk({
			actions,
			audience: forAudience,
			snapshot: {
				phase: snapshot.phase,
				frictionScore: snapshot.frictionScore,
				criticalZones: snapshot.zones.filter((z) => z.alert === "critical").map((z) => z.name),
			},
			forecast: {
				horizonMinutes: forecast.horizonMinutes,
				projectedFrictionScore: forecast.projectedFrictionScore,
				frictionDelta: forecast.frictionDelta,
				trend: forecast.trend,
				risingZones: forecast.zones.filter((z) => z.trend === "rising").map((z) => z.name),
			},
			model: MODEL_NAME,
		});
	});
}
