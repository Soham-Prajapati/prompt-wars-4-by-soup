/**
 * WCAG contrast enforcement.
 *
 * The design system's header comment claims specific contrast ratios. A comment
 * cannot enforce anything, so this suite parses the real stylesheet, recomputes
 * every ratio from the actual token values, and fails when a claim stops being
 * true. Editing a colour without meeting the threshold breaks the build.
 *
 * Ratios follow WCAG 2.1: 4.5:1 for body text (1.4.3) and 3:1 for non-text UI
 * such as borders and map markers (1.4.11).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Relative luminance of an sRGB hex colour, per WCAG 2.1 formula. */
function luminance(hex: string): number {
	const clean = hex.replace("#", "");
	const parts = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)];
	const channels = parts.map((part) => {
		const value = Number.parseInt(part, 16) / 255;
		return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	});
	const [r, g, b] = channels;
	if (r === undefined || g === undefined || b === undefined) {
		throw new Error(`Malformed hex colour: ${hex}`);
	}
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colours, in the range 1..21. */
function contrast(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Read a custom property's hex value from a specific block of the stylesheet.
 *
 * @param token Property name without the leading dashes.
 * @param scheme Which scheme block to read from.
 */
function token(token: string, scheme: "dark" | "light"): string {
	// The light scheme lives inside a prefers-color-scheme block; the dark
	// scheme is the default :root. Slice the file at the media query boundary
	// so the same token name resolves to the right value.
	const boundary = CSS.indexOf("@media (prefers-color-scheme: light)");
	expect(boundary).toBeGreaterThan(-1);
	const region = scheme === "dark" ? CSS.slice(0, boundary) : CSS.slice(boundary);

	const matches = [...region.matchAll(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`, "g"))];
	const last = matches.at(-1);
	if (last === undefined) throw new Error(`Token --${token} not found in ${scheme} scheme`);
	const value = last[1];
	if (value === undefined) throw new Error(`Token --${token} has no hex value in ${scheme} scheme`);
	return value;
}

describe("design system contrast", () => {
	const schemes = ["dark", "light"] as const;

	describe.each(schemes)("%s scheme", (scheme) => {
		it("body text meets WCAG AA 4.5:1 against its surface", () => {
			const ratio = contrast(token("text", scheme), token("surface", scheme));
			expect(ratio).toBeGreaterThanOrEqual(4.5);
		});

		it("muted text meets WCAG AA 4.5:1 against its surface", () => {
			const ratio = contrast(token("text-muted", scheme), token("surface", scheme));
			expect(ratio).toBeGreaterThanOrEqual(4.5);
		});

		it("strong borders meet WCAG 1.4.11 non-text contrast of 3:1", () => {
			const ratio = contrast(token("border-strong", scheme), token("surface", scheme));
			expect(ratio).toBeGreaterThanOrEqual(3);
		});
	});

	it("computes known reference ratios correctly", () => {
		// Sanity-check the formula itself against WCAG's published extremes, so a
		// broken luminance implementation cannot silently pass every assertion above.
		expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
		expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
	});
});
