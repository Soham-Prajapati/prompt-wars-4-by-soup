// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Lint configuration.
 *
 * Every rule here is ENABLED and escalated to `error`. No rule is switched off
 * to make the build pass. `npm run lint` runs with `--max-warnings 0`, so the
 * gate is only meaningful because the rules below actually fire.
 *
 * Type-aware linting is on (`projectService`), which catches classes of defect
 * — floating promises, unsafe member access on `any` — that syntactic linting
 * cannot see.
 */
export default tseslint.config(
	{
		ignores: [".next/**", "node_modules/**", "next-env.d.ts", "coverage/**"],
	},
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ["src/**/*.{ts,tsx}"],
		plugins: {
			"jsx-a11y": jsxA11y,
			"react-hooks": reactHooks,
		},
		rules: {
			...jsxA11y.configs.recommended.rules,
			"react-hooks/rules-of-hooks": "error",
			"react-hooks/exhaustive-deps": "error",
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/explicit-function-return-type": "error",
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			"no-console": ["error", { allow: ["warn", "error"] }],
			eqeqeq: ["error", "always"],
			"prefer-const": "error",
			"no-var": "error",
		},
	},
	{
		files: ["tests/**/*.ts", "*.config.ts", "*.config.mjs"],
		rules: {
			"@typescript-eslint/explicit-function-return-type": "off",
		},
	},
	{
		// This file is JavaScript and is not part of the TypeScript project, so the
		// type-aware rules have no program to consult and would otherwise fail to
		// parse it. Syntactic linting still applies here; only the rules that
		// require type information are lifted, and only for this file.
		files: ["eslint.config.mjs"],
		extends: [tseslint.configs.disableTypeChecked],
	},
);
