/**
 * `POST /api/advisor` — operational decision support for venue staff.
 *
 * Turns the live snapshot into a ranked set of actions a duty manager can take
 * now. The prompt carries the full zone table rather than a summary: the model
 * is asked to prioritise, not to guess at state, and every zone it may name is
 * present in the data it was given.
 */
import { NextResponse, type NextRequest } from "next/server";

import { handle, jsonOk, readJsonBody } from "@/lib/api";
import { clockFromWallTime, snapshotAt, type VenueSnapshot, type ZoneReading } from "@/lib/crowd-model";
import { MODEL_NAME, generate } from "@/lib/gemini";
import { advisorRequestSchema } from "@/lib/validation";
import { getZone } from "@/lib/venue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render one zone reading as a single grounded prompt line. */
function describeZone(zone: ZoneReading): string {
	const wait = zone.waitMinutes > 0 ? `, queue ${String(zone.waitMinutes)} min` : "";
	const pct = Math.round(zone.density * 100);
	return `- ${zone.name} (id: ${zone.zoneId}, ${zone.kind}): ${String(pct)}% full, ${String(zone.occupancy)} people${wait}, alert ${zone.alert}`;
}

/** Compose the advisor prompt from live venue state. */
function buildPrompt(snapshot: VenueSnapshot, focusZoneId: string | undefined): string {
	const focusZone = focusZoneId === undefined ? undefined : getZone(focusZoneId);
	const focusLine =
		focusZone === undefined
			? "No specific zone is in focus; advise across the whole venue."
			: `The duty manager is focused on ${focusZone.name} (id: ${focusZone.id}). Weight your actions towards it, but do not ignore a more severe problem elsewhere.`;

	return [
		`Matchday phase: ${snapshot.phase} (clock ${String(snapshot.clockMinutes)} min since gates opened).`,
		`Fan Friction Score: ${String(snapshot.frictionScore)}/100 (lower is better). Mean density: ${String(Math.round(snapshot.meanDensity * 100))}%.`,
		"",
		"Live zone readings:",
		...snapshot.zones.map(describeZone),
		"",
		focusLine,
		"",
		"Give the top 3 prioritised operational actions, most urgent first.",
		"Number them 1 to 3. Each action must be one or two sentences: the action itself,",
		"then the rationale citing the specific density, queue or alert level that justifies it.",
		"Every action must name at least one zone exactly as it appears above.",
		"Reference only zones listed above. Do not invent zones, staff numbers or incidents.",
	].join("\n");
}

/** Produce prioritised operational actions for the current venue state. */
export async function POST(request: NextRequest): Promise<NextResponse> {
	return handle(async () => {
		const { zoneId } = advisorRequestSchema.parse(await readJsonBody(request));

		const snapshot = snapshotAt(clockFromWallTime(Date.now()));
		const actions = await generate(buildPrompt(snapshot, zoneId));

		return jsonOk({
			actions,
			snapshot: {
				phase: snapshot.phase,
				frictionScore: snapshot.frictionScore,
				criticalZones: snapshot.zones.filter((z) => z.alert === "critical").map((z) => z.name),
			},
			model: MODEL_NAME,
		});
	});
}
