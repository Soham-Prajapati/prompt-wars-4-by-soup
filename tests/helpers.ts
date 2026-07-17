/**
 * Assertions and readers shared by more than one suite.
 *
 * A helper earns a place here by being needed in two suites at once, not by
 * being generic. Each one below was written twice independently and had drifted
 * only in its comment, which is the argument for hoisting it: two copies of an
 * assertion are two things to keep in step, and the copy a reader is looking at
 * is never obviously the one that runs.
 */
import { expect } from "vitest";

import { SECURITY_HEADERS } from "@/lib/api";

/**
 * Read a response body as `unknown`.
 *
 * Deliberately not typed to the expected shape. The suites that call this are
 * checking what the server actually emitted, so handing back a value the test
 * must narrow itself keeps a wrong shape a test failure rather than a cast that
 * asserts the shape into existence.
 */
export async function bodyOf(response: Response): Promise<unknown> {
	return (await response.json()) as unknown;
}

/**
 * Assert the full security header set is present with its documented values.
 *
 * Pinned against {@link SECURITY_HEADERS} rather than a hand-written list, so a
 * header weakened at the source fails here instead of passing because the test
 * was updated alongside it. The header name is passed to `expect` as the message
 * so a failure names the header that went missing.
 */
export function expectSecurityHeaders(response: Response): void {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		expect(response.headers.get(name), name).toBe(value);
	}
}

/**
 * A copy of `value` with `key` removed.
 *
 * For building the payload that is well-formed except for one absent field —
 * the shape a truncated response or a client that forgot a field really sends.
 * Rebuilt through `Object.fromEntries` rather than `delete`, so the input is
 * left untouched and a caller can omit several keys from one reference object.
 */
export function omit(value: Record<string, unknown>, key: string): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
