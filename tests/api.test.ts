/**
 * The API envelope: headers, error mapping, and what must never leak.
 *
 * `handle` is the single place where a thrown error becomes a status code, so
 * every route inherits whatever it decides. Two properties carry real weight
 * here. First, the mapping itself — a `GeminiUnavailableError` surfacing as a
 * 500 would tell a client to retry nothing, and a `ZodError` surfacing as a 500
 * would hide a fixable client mistake. Second, containment: an unrecognised
 * error must produce a generic message, because an upstream error string
 * reaching the browser is a disclosure bug that no route could catch on its own.
 */
import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";

import { MalformedBodyError, SECURITY_HEADERS, handle, jsonError, jsonOk, readJsonBody } from "@/lib/api";
import { GeminiUnavailableError } from "@/lib/gemini";
import { bodyOf, expectSecurityHeaders } from "./helpers";

/** The envelope every failing route emits. */
const envelope = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		issues: z
			.array(z.object({ path: z.string(), message: z.string() }))
			.optional(),
	}),
});

/** Parse a response as the error envelope, failing the test if it is not one. */
async function errorBody(response: Response): Promise<z.infer<typeof envelope>> {
	return envelope.parse(await bodyOf(response));
}

/** Build a POST request carrying a raw, possibly invalid, body string. */
function requestWithBody(raw: string): Request {
	return new Request("https://pitchops.test/api/test", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: raw,
	});
}

describe("SECURITY_HEADERS", () => {
	/**
	 * Pinned exactly. These are the response's whole defence against MIME
	 * sniffing, framing and referrer leakage, so a weakened value must show up
	 * as a deliberate diff rather than pass because "a header is set".
	 */
	it("declares the five hardening headers with their expected values", () => {
		expect(SECURITY_HEADERS).toEqual({
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY",
			"Referrer-Policy": "strict-origin-when-cross-origin",
			"Permissions-Policy": "geolocation=(), microphone=(), camera=()",
			"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
		});
	});
});

describe("jsonOk", () => {
	it("returns the payload verbatim with status 200", async () => {
		const response = jsonOk({ status: "ok", zoneCount: 17 });
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({ status: "ok", zoneCount: 17 });
	});

	it("carries the security headers", () => {
		expectSecurityHeaders(jsonOk({}));
	});
});

describe("jsonError", () => {
	it("uses the given status and reports the code and message", async () => {
		const response = jsonError(404, "NO_ROUTE", "No walkway path exists between these zones.");
		expect(response.status).toBe(404);
		expect(await bodyOf(response)).toEqual({
			error: { code: "NO_ROUTE", message: "No walkway path exists between these zones." },
		});
	});

	/** A failure response is exactly as exposed as a successful one. */
	it("carries the security headers", () => {
		expectSecurityHeaders(jsonError(500, "INTERNAL_ERROR", "An unexpected error occurred."));
	});
});

describe("readJsonBody", () => {
	it("returns the parsed body for valid JSON", async () => {
		expect(await readJsonBody(requestWithBody('{"zoneId":"gate-a"}'))).toEqual({ zoneId: "gate-a" });
	});

	/**
	 * Distinguishing an unparseable body from an internal fault is the whole
	 * point of this wrapper: one is the client's to fix, the other is not.
	 */
	it("throws MalformedBodyError for a truncated JSON body", async () => {
		await expect(readJsonBody(requestWithBody('{"zoneId":'))).rejects.toBeInstanceOf(MalformedBodyError);
	});

	it("throws MalformedBodyError for a body that is not JSON at all", async () => {
		await expect(readJsonBody(requestWithBody("gate-a"))).rejects.toBeInstanceOf(MalformedBodyError);
	});

	it("throws MalformedBodyError for an empty body", async () => {
		await expect(readJsonBody(requestWithBody(""))).rejects.toBeInstanceOf(MalformedBodyError);
	});
});

describe("MalformedBodyError", () => {
	it("keeps its name and takes a custom message", () => {
		const error = new MalformedBodyError("nope");
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("MalformedBodyError");
		expect(error.message).toBe("nope");
	});
});

describe("handle", () => {
	it("passes a successful response through untouched", async () => {
		const response = await handle(() => Promise.resolve(jsonOk({ phase: "pre-match" })));
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({ phase: "pre-match" });
	});

	/** An unconfigured or unreachable model is a service-availability problem. */
	it("maps GeminiUnavailableError to 503 AI_UNAVAILABLE and keeps its message", async () => {
		const response = await handle(() => {
			throw new GeminiUnavailableError();
		});
		expect(response.status).toBe(503);
		const body = await errorBody(response);
		expect(body.error.code).toBe("AI_UNAVAILABLE");
		expect(body.error.message).toContain("GEMINI_API_KEY");
		expectSecurityHeaders(response);
	});

	it("maps MalformedBodyError to 400 MALFORMED_BODY", async () => {
		const response = await handle(() => {
			throw new MalformedBodyError();
		});
		expect(response.status).toBe(400);
		const body = await errorBody(response);
		expect(body.error.code).toBe("MALFORMED_BODY");
		expect(body.error.message).toContain("JSON");
		expectSecurityHeaders(response);
	});

	/**
	 * The client cannot fix what it is not told, so the per-field issues must
	 * survive the mapping rather than collapsing into a bare status.
	 */
	it("maps ZodError to 422 VALIDATION_ERROR carrying the failing paths", async () => {
		const schema = z.object({ question: z.string().min(3), language: z.string().min(2) });
		const response = await handle(() => {
			schema.parse({ question: "a", language: "" });
			return Promise.resolve(jsonOk({}));
		});

		expect(response.status).toBe(422);
		const body = await errorBody(response);
		expect(body.error.code).toBe("VALIDATION_ERROR");
		expect(body.error.issues).toBeDefined();
		expect(body.error.issues?.map((issue) => issue.path)).toEqual(["question", "language"]);
		for (const issue of body.error.issues ?? []) {
			expect(issue.message.length).toBeGreaterThan(0);
		}
		expectSecurityHeaders(response);
	});

	/** A root-level type failure has no field to blame, and reports the empty path. */
	it("reports an empty path for a whole-body validation failure", async () => {
		const response = await handle(() => {
			z.object({ zoneId: z.string() }).parse("gate-a");
			return Promise.resolve(jsonOk({}));
		});
		const body = await errorBody(response);
		expect(body.error.issues).toEqual([expect.objectContaining({ path: "" })]);
	});

	it("maps a ZodError thrown asynchronously the same way", async () => {
		const response = await handle(() =>
			Promise.reject(new ZodError([{ code: "custom", path: ["zoneId"], message: "Unknown zone id." }])),
		);
		expect(response.status).toBe(422);
		expect((await errorBody(response)).error.issues).toEqual([{ path: "zoneId", message: "Unknown zone id." }]);
	});

	it("maps an unrecognised error to 500 INTERNAL_ERROR", async () => {
		const response = await handle(() => {
			throw new Error("connect ECONNREFUSED 10.0.0.7:5432");
		});
		expect(response.status).toBe(500);
		expect(await bodyOf(response)).toEqual({
			error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
		});
		expectSecurityHeaders(response);
	});

	/**
	 * Containment, stated as the property it actually is: nothing about the
	 * thrown error — its message, its stack, its class name — may appear in
	 * anything the client can read. This is the test that fails if someone
	 * "helpfully" forwards `error.message` to aid debugging.
	 */
	it("does not leak an internal error's message, stack or name to the client", async () => {
		const secret = "postgres://admin:hunter2@db.internal:5432/pitchops";
		const thrown = new Error(secret);
		thrown.name = "DatabaseConnectionError";

		const response = await handle(() => {
			throw thrown;
		});

		const serialised = JSON.stringify(await bodyOf(response));
		expect(serialised).not.toContain(secret);
		expect(serialised).not.toContain("hunter2");
		expect(serialised).not.toContain("DatabaseConnectionError");
		expect(serialised).not.toContain("api.test.ts");
		expect(serialised).not.toContain(thrown.stack ?? "");
	});

	/** A thrown non-Error still has to produce the envelope, not crash the route. */
	it("maps a thrown non-Error value to 500 without echoing it", async () => {
		const response = await handle(() => {
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw "raw string failure";
		});
		expect(response.status).toBe(500);
		expect(JSON.stringify(await bodyOf(response))).not.toContain("raw string failure");
	});

	/**
	 * `GeminiUnavailableError` extends `Error`, so the order of the instanceof
	 * checks is load-bearing: reversing them would turn every 503 into a 500.
	 */
	it("prefers the specific error mapping over the generic one", async () => {
		const gemini = await handle(() => Promise.reject(new GeminiUnavailableError()));
		const malformed = await handle(() => Promise.reject(new MalformedBodyError()));
		expect([gemini.status, malformed.status]).toEqual([503, 400]);
	});
});
