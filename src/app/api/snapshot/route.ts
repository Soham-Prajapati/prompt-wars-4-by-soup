/**
 * `GET /api/snapshot` — the current venue state, and where it is heading.
 *
 * Returns the deterministic crowd model evaluated at the wall-clock instant of
 * the request, plus the projection anchored to that same instant. Every AI
 * endpoint grounds its prompt in this same data, so a client polling here sees
 * exactly what the advisor reasoned over.
 *
 * The forecast rides on this response rather than living at `GET /api/forecast`
 * for two reasons. It costs nothing: the crowd model is a pure function of the
 * clock, so projecting it is arithmetic over the same seventeen zones, with no
 * I/O to duplicate. And it cannot tear: the console reads both halves from one
 * response anchored to one clock read, where a second endpoint would be a second
 * request on a clock that advances every four seconds — the map could then draw
 * minute 30 while the trend arrow beside it describes minute 31. A separate
 * route would also mean a second poller, and this console deliberately has one.
 */
import { NextResponse } from "next/server";

import { handle, jsonOk } from "@/lib/api";
import { currentReport } from "@/lib/crowd-model";

export const runtime = "nodejs";

/**
 * The snapshot changes with wall-clock time, so a cached response would be a
 * wrong response.
 */
export const dynamic = "force-dynamic";

/** Return the live venue snapshot with its short-horizon forecast attached. */
export async function GET(): Promise<NextResponse> {
	// Reading the model is synchronous, so the handler resolves immediately
	// rather than being marked `async` with nothing to await.
	return handle(() => {
		const { snapshot, forecast } = currentReport();
		return Promise.resolve(jsonOk({ ...snapshot, forecast }));
	});
}
