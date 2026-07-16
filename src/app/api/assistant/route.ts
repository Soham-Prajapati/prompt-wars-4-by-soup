/**
 * `POST /api/assistant` — multilingual fan assistant.
 *
 * FIFA World Cup 2026 brings 48 nations into the same concourse, so a fan
 * asking in Korean must be answered in Korean, not handed an English string
 * with a translation widget bolted on. The language is part of the request and
 * the model composes the whole reply in it.
 *
 * The answer is grounded in the same live snapshot the operations dashboard
 * reads. Wait times, congestion and step-free status are supplied as data; the
 * model is instructed to say when the data cannot answer rather than to fill
 * the gap, because a confidently wrong gate number moves a crowd the wrong way.
 */
import { NextResponse, type NextRequest } from "next/server";

import { handle, jsonOk, readJsonBody } from "@/lib/api";
import { clockFromWallTime, snapshotAt, type VenueSnapshot, type ZoneReading } from "@/lib/crowd-model";
import { MODEL_NAME, generate } from "@/lib/gemini";
import { assistantRequestSchema } from "@/lib/validation";
import { getZone } from "@/lib/venue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render one zone reading as a fan-facing prompt line. */
function describeZone(zone: ZoneReading): string {
	const wait = zone.waitMinutes > 0 ? `, about ${String(zone.waitMinutes)} min queue` : "";
	const access = getZone(zone.zoneId)?.stepFree === true ? "step-free access" : "steps on approach";
	const pct = Math.round(zone.density * 100);
	return `- ${zone.name} (${zone.kind}): ${String(pct)}% full, alert ${zone.alert}${wait}, ${access}`;
}

/** Compose the assistant prompt from the live snapshot and the fan's question. */
function buildPrompt(snapshot: VenueSnapshot, question: string, language: string): string {
	return [
		`Matchday phase: ${snapshot.phase} (clock ${String(snapshot.clockMinutes)} min since gates opened).`,
		"",
		"Live venue state:",
		...snapshot.zones.map(describeZone),
		"",
		`A fan asks: "${question}"`,
		"",
		`Answer the fan directly in at most 4 sentences. Write your ENTIRE reply in ${language} —`,
		"every word, including any zone names you translate or transliterate. Do not add an English version.",
		"Use only the venue state above; if it does not answer the question, say so plainly in",
		`${language} and suggest what the fan can do instead. Never invent gates, wait times or facilities.`,
	].join("\n");
}

/** Answer a fan question in the requested language, grounded in live state. */
export async function POST(request: NextRequest): Promise<NextResponse> {
	return handle(async () => {
		const { question, language } = assistantRequestSchema.parse(await readJsonBody(request));

		const snapshot = snapshotAt(clockFromWallTime(Date.now()));
		const answer = await generate(buildPrompt(snapshot, question, language));

		return jsonOk({ answer, language, model: MODEL_NAME });
	});
}
