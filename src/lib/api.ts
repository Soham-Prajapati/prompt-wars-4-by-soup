/**
 * Shared plumbing for the route handlers.
 *
 * Centralises the three things every endpoint must get right and none should
 * restate: a single error envelope, a single set of security headers, and a
 * single place where thrown errors become status codes.
 *
 * The error envelope is deliberately narrow. Clients receive a stable machine
 * code and a human message — never a stack trace, never an upstream error
 * string — because an unhandled internal detail leaked to the browser is a
 * disclosure bug, not a debugging aid.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { GeminiUnavailableError } from "@/lib/gemini";

/**
 * Response headers applied to every API response.
 *
 * These are set per-response rather than in middleware so that a route is
 * hardened by the act of being written, with no separate config to forget.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "geolocation=(), microphone=(), camera=()",
	"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

/** Shape of a single Zod validation failure exposed to the client. */
interface IssueDetail {
	/** Dotted path to the offending field, or `""` for the body root. */
	readonly path: string;
	readonly message: string;
}

/**
 * Build a structured JSON error response.
 *
 * @param status HTTP status code to send.
 * @param code Stable machine-readable error code.
 * @param message Human-readable explanation, safe to display.
 */
export function jsonError(status: number, code: string, message: string): NextResponse {
	return NextResponse.json({ error: { code, message } }, { status, headers: SECURITY_HEADERS });
}

/** Flatten a `ZodError` into client-safe issue details. */
function issueDetails(error: ZodError): readonly IssueDetail[] {
	return error.issues.map((issue) => ({
		path: issue.path.join("."),
		message: issue.message,
	}));
}

/** Raised when a request body is not parseable as JSON. */
export class MalformedBodyError extends Error {
	constructor(message = "The request body could not be parsed as JSON.") {
		super(message);
		this.name = "MalformedBodyError";
	}
}

/**
 * Read and parse a request body as JSON.
 *
 * A body that is not valid JSON is a client error, so it is distinguished from
 * an internal failure here rather than surfacing as a misleading 500.
 *
 * @param request The incoming request.
 * @throws {MalformedBodyError} When the body is absent or not valid JSON.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
	try {
		return (await request.json()) as unknown;
	} catch {
		throw new MalformedBodyError();
	}
}

/**
 * Send a successful JSON payload with the standard security headers.
 *
 * @param body The payload to serialise.
 */
export function jsonOk(body: unknown): NextResponse {
	return NextResponse.json(body, { status: 200, headers: SECURITY_HEADERS });
}

/**
 * Run a route handler, mapping thrown errors onto the error envelope.
 *
 * Handlers throw and stay linear; the translation from error to status code
 * happens once, here, so no endpoint can invent its own contract.
 *
 * @param fn The handler body.
 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof GeminiUnavailableError) {
			return jsonError(503, "AI_UNAVAILABLE", error.message);
		}
		if (error instanceof MalformedBodyError) {
			return jsonError(400, "MALFORMED_BODY", error.message);
		}
		if (error instanceof ZodError) {
			return NextResponse.json(
				{
					error: {
						code: "VALIDATION_ERROR",
						message: "The request body is invalid.",
						issues: issueDetails(error),
					},
				},
				{ status: 422, headers: SECURITY_HEADERS },
			);
		}
		return jsonError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
	}
}
