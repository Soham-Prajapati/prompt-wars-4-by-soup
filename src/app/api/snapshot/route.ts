/**
 * `GET /api/snapshot` — the current venue state.
 *
 * Returns the deterministic crowd model evaluated at the wall-clock instant of
 * the request. Every AI endpoint grounds its prompt in this same snapshot, so a
 * client polling here sees exactly the data the advisor reasoned over.
 */
import { NextResponse } from "next/server";

import { handle, jsonOk } from "@/lib/api";
import { clockFromWallTime, snapshotAt } from "@/lib/crowd-model";

export const runtime = "nodejs";

/**
 * The snapshot changes with wall-clock time, so a cached response would be a
 * wrong response.
 */
export const dynamic = "force-dynamic";

/** Return the live venue snapshot. */
export async function GET(): Promise<NextResponse> {
	// Reading the model is synchronous, so the handler resolves immediately
	// rather than being marked `async` with nothing to await.
	return handle(() => Promise.resolve(jsonOk(snapshotAt(clockFromWallTime(Date.now())))));
}
