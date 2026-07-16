/**
 * `GET /api/health` — liveness and capability report.
 *
 * Doubles as the evidence endpoint for the Google service this project uses:
 * `model` names the exact Gemini model the route handlers call, and
 * `aiConfigured` reports whether a key is actually present in this process's
 * environment. Both are read from the same module the AI endpoints use, so the
 * response cannot drift from what the app really does.
 *
 * The clock, phase and zone count are computed from the live crowd model on
 * every request rather than hard-coded, which makes the endpoint a genuine
 * check that the model evaluates — a static string could not fail.
 */
import { NextResponse } from "next/server";

import pkg from "../../../../package.json";

import { handle, jsonOk } from "@/lib/api";
import { clockFromWallTime, snapshotAt } from "@/lib/crowd-model";
import { MODEL_NAME, isConfigured } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report observed service state. */
export async function GET(): Promise<NextResponse> {
	// Every field is computed synchronously, so the handler resolves immediately
	// rather than being marked `async` with nothing to await.
	return handle(() => {
		const snapshot = snapshotAt(clockFromWallTime(Date.now()));

		return Promise.resolve(
			jsonOk({
				status: "ok",
				version: pkg.version,
				aiConfigured: isConfigured(),
				model: MODEL_NAME,
				clockMinutes: snapshot.clockMinutes,
				phase: snapshot.phase,
				zoneCount: snapshot.zones.length,
			}),
		);
	});
}
