/**
 * Gemini client — the generative layer behind every AI feature.
 *
 * The API key is read from the server-only `GEMINI_API_KEY` environment
 * variable and never reaches the browser: all calls originate from Next.js
 * route handlers, which execute exclusively on the server.
 *
 * When the key is absent the module reports itself unconfigured and callers
 * surface a 503. It never fabricates model output — a mocked response that is
 * indistinguishable from a real one makes an outage look like a success.
 */
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

/** Model used for all generation. Flash is chosen for sub-second latency. */
export const MODEL_NAME = "gemini-2.0-flash";

let cachedModel: GenerativeModel | null = null;

/** True when a Gemini API key is present in the environment. */
export function isConfigured(): boolean {
	return typeof process.env["GEMINI_API_KEY"] === "string" && process.env["GEMINI_API_KEY"].length > 0;
}

/**
 * Lazily construct the Gemini model.
 *
 * The client is cached across invocations so a warm serverless container does
 * not rebuild it per request.
 *
 * @returns The model, or `null` when no API key is configured.
 */
function getModel(): GenerativeModel | null {
	if (cachedModel) return cachedModel;

	const apiKey = process.env["GEMINI_API_KEY"];
	if (apiKey === undefined || apiKey.length === 0) return null;

	const client = new GoogleGenerativeAI(apiKey);
	cachedModel = client.getGenerativeModel({
		model: MODEL_NAME,
		systemInstruction:
			"You are PitchOps, the operations copilot for FIFA World Cup 2026 host stadiums. " +
			"You advise venue staff and assist fans. Be concise and specific. " +
			"Base every statement strictly on the venue data provided in the prompt — " +
			"never invent zones, wait times, gate numbers or incidents. " +
			"If the data does not answer the question, say so plainly.",
	});
	return cachedModel;
}

/** Raised when generation is attempted without a configured API key. */
export class GeminiUnavailableError extends Error {
	constructor(message = "Gemini is not configured: GEMINI_API_KEY is not set.") {
		super(message);
		this.name = "GeminiUnavailableError";
	}
}

/**
 * Generate text from a prompt.
 *
 * @param prompt The fully-composed user prompt.
 * @throws {GeminiUnavailableError} When no API key is configured.
 */
export async function generate(prompt: string): Promise<string> {
	const model = getModel();
	if (model === null) throw new GeminiUnavailableError();

	const result = await model.generateContent(prompt);
	return result.response.text().trim();
}

/** Reset the cached client. Exposed for tests; not used in application code. */
export function resetModelCache(): void {
	cachedModel = null;
}
