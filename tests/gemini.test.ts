/**
 * Configuration gating for the Gemini client.
 *
 * The module's contract is that it fails loudly rather than fabricating model
 * output: with no API key, `isConfigured` must say so and `generate` must throw
 * a typed error the route handlers can turn into a 503. Only that gate is
 * tested here — the SDK's own behaviour is not this suite's responsibility, and
 * no test in this file may reach the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeminiUnavailableError, MODEL_NAME, generate, isConfigured, resetModelCache } from "@/lib/gemini";

beforeEach(() => {
	resetModelCache();
});

afterEach(() => {
	vi.unstubAllEnvs();
	resetModelCache();
});

describe("isConfigured", () => {
	it("is false when GEMINI_API_KEY is unset", () => {
		vi.stubEnv("GEMINI_API_KEY", undefined);
		expect(isConfigured()).toBe(false);
	});

	/** An empty string is a present-but-useless key and must not count. */
	it("is false when GEMINI_API_KEY is empty", () => {
		vi.stubEnv("GEMINI_API_KEY", "");
		expect(isConfigured()).toBe(false);
	});

	it("is true when GEMINI_API_KEY holds a value", () => {
		vi.stubEnv("GEMINI_API_KEY", "test-key-value");
		expect(isConfigured()).toBe(true);
	});

	/** The check reads the environment live, not a value captured at import. */
	it("tracks changes to the environment within a process", () => {
		vi.stubEnv("GEMINI_API_KEY", "test-key-value");
		expect(isConfigured()).toBe(true);
		vi.stubEnv("GEMINI_API_KEY", "");
		expect(isConfigured()).toBe(false);
	});
});

describe("generate", () => {
	/**
	 * With no key there is nothing to call, so generation must reject with the
	 * typed error rather than returning a plausible-looking stub.
	 */
	it("rejects with GeminiUnavailableError when no key is configured", async () => {
		vi.stubEnv("GEMINI_API_KEY", undefined);
		resetModelCache();

		await expect(generate("How busy is Gate A?")).rejects.toBeInstanceOf(GeminiUnavailableError);
	});

	it("rejects with GeminiUnavailableError when the key is empty", async () => {
		vi.stubEnv("GEMINI_API_KEY", "");
		resetModelCache();

		await expect(generate("How busy is Gate A?")).rejects.toBeInstanceOf(GeminiUnavailableError);
	});

	/** The error must be identifiable by name after serialisation boundaries. */
	it("names the thrown error and explains the missing key", async () => {
		vi.stubEnv("GEMINI_API_KEY", "");
		resetModelCache();

		const error: unknown = await generate("anything").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(GeminiUnavailableError);
		if (!(error instanceof Error)) return;
		expect(error.name).toBe("GeminiUnavailableError");
		expect(error.message).toContain("GEMINI_API_KEY");
	});
});

describe("GeminiUnavailableError", () => {
	it("accepts a custom message and keeps its name", () => {
		const error = new GeminiUnavailableError("custom failure");
		expect(error.message).toBe("custom failure");
		expect(error.name).toBe("GeminiUnavailableError");
		expect(error).toBeInstanceOf(Error);
	});
});

describe("MODEL_NAME", () => {
	/** Pinned so an accidental model swap shows up as a deliberate diff. */
	it("is the Flash model chosen for sub-second latency", () => {
		expect(MODEL_NAME).toBe("gemini-2.0-flash");
	});
});
