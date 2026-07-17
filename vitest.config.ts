import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			// The domain modules and the API surface — every line that runs on the
			// server. The React components are excluded because this suite does not
			// render them; counting them would report a number no test earned.
			include: ["src/lib/**", "src/app/api/**"],
			// Set a hair under what the suite actually reaches (97.3 / 91.0 / 100 /
			// 98.3), so the gate bites on a real regression rather than sitting
			// decoratively above the true figure. Raise these when coverage rises;
			// do not lower them to make a red build green.
			thresholds: {
				statements: 97,
				branches: 90,
				functions: 98,
				lines: 98,
			},
		},
	},
});
