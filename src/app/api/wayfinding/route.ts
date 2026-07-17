/**
 * `POST /api/wayfinding` — crowd-aware accessible routing.
 *
 * The route itself is computed by Dijkstra over the walkway graph weighted by
 * live congestion; Gemini only narrates it. That split matters: the path is a
 * deterministic result the model cannot alter, and it is useful on its own.
 * So when generation fails this endpoint returns the route with `directions:
 * null` and `directionsAvailable: false` rather than a 503 — losing the prose
 * is a degraded answer, while losing the path would be no answer at all.
 */
import { NextResponse, type NextRequest } from "next/server";

import { handle, jsonError, jsonOk, readJsonBody } from "@/lib/api";
import { currentSnapshot } from "@/lib/crowd-model";
import { MODEL_NAME, generateOptional } from "@/lib/gemini";
import { wayfindingRequestSchema } from "@/lib/validation";
import { findRoute, type Route } from "@/lib/wayfinding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compose the narration prompt for a computed route. */
function buildPrompt(route: Route, stepFreeOnly: boolean): string {
	const access = stepFreeOnly
		? "This route was computed step-free: every walkway and zone on it is level or ramped."
		: "This route may include stairs or escalators.";

	return [
		`Walking route: ${route.names.join(" -> ")}`,
		`Distance: ${String(route.metres)} m. Estimated time: ${String(route.minutes)} min including congestion.`,
		`Mean crowd density along the route: ${String(Math.round(route.meanDensity * 100))}%.`,
		access,
		"",
		"Turn these stops into short turn-by-turn directions for a fan, one line per leg.",
		"Keep the whole reply under 90 words. Mention the step-free status once.",
		"If the route detours around a busy area, say so in one clause.",
		"Use only the stops listed above; do not invent landmarks, gates or distances.",
	].join("\n");
}

/** Compute a congestion-aware route and narrate it when possible. */
export async function POST(request: NextRequest): Promise<NextResponse> {
	return handle(async () => {
		const { origin, destination, stepFreeOnly } = wayfindingRequestSchema.parse(await readJsonBody(request));

		const snapshot = currentSnapshot();
		const route = findRoute(origin, destination, snapshot, { stepFreeOnly });

		if (route === null) {
			return jsonError(
				404,
				"NO_ROUTE",
				stepFreeOnly
					? "No step-free path exists between these zones. Try again without the step-free constraint, or route via a staffed accessible entrance."
					: "No walkway path exists between these zones.",
			);
		}

		const directions = await generateOptional(buildPrompt(route, stepFreeOnly));

		return jsonOk({
			route,
			directions,
			directionsAvailable: directions !== null,
			model: MODEL_NAME,
		});
	});
}
