# Rubric audit — PitchOps 26

Per-category evidence, with file:line references and numbers taken from real command output. Every figure below was produced by running the command named next to it, against this commit.

**Verification commands used throughout:**

```bash
npx tsc --noEmit                  # exit 0
npx eslint . --max-warnings 0     # exit 0
npx vitest run                    # 103 passed (103)
npx vitest run --coverage         # table under "Testing"
npx next build                    # ✓ Compiled successfully
find src tests -name '*.ts' -o -name '*.tsx' | wc -l   # 32
```

---

## 1. Code Quality — HIGH impact

*"How clean, readable, and well-structured the submitted code is."*

| What was done | Where | Verifiable evidence |
| --- | --- | --- |
| TypeScript `strict`, **plus** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | `tsconfig.json:7-13` | `npx tsc --noEmit` → **exit 0**, 0 errors |
| ESLint on `typescript-eslint` **`strictTypeChecked`** with type-aware linting (`projectService: true`) — catches floating promises and unsafe `any` access that syntactic linting cannot see | `eslint.config.mjs:23`, `:27` | `npx eslint . --max-warnings 0` → **exit 0**, 0 errors, 0 warnings |
| **Zero rules disabled to pass the build.** The config turns rules *on* and escalates to `error`. The two `off` entries are scoped and justified in comments: `explicit-function-return-type` for test files (`:55`), and `disableTypeChecked` for `eslint.config.mjs` itself (`:64`), which is JavaScript and outside the TS program | `eslint.config.mjs:38-50` (rules, all `error`), `:53-56`, `:58-65` | `grep -rn "eslint-disable\|@ts-ignore\|@ts-expect-error\|@ts-nocheck" src tests eslint.config.mjs` → **0 matches**. The gate is meaningful because nothing is switched off to reach it. |
| No `any` | all of `src`, `tests` | `grep -rn ": any\|as any\|<any>" src tests` → **0** |
| No non-null assertions | all of `src` | `grep -rnE '[A-Za-z0-9_)\]]!\.' src` → **0** (`no-non-null-assertion` is also `error`, `eslint.config.mjs:43`) |
| No `TODO` / `FIXME` / `HACK` | all of `src`, `tests` | `grep -rni "TODO\|FIXME\|XXX\|HACK" src tests` → **0** |
| No `console.log` | all of `src`, `tests` | `grep -rn "console.log" src tests` → **0**; rule enforced at `eslint.config.mjs:46` |
| No inline styles — all presentation in one tokenised stylesheet | `src/app/globals.css` (821 lines) | `grep -rn "style={{" src` → **0** |
| `explicit-function-return-type` enforced in `src/**` | `eslint.config.mjs:44` | Every function in `src/` declares its return type; lint exit 0 |
| **Every exported function, class, interface and type alias carries JSDoc.** Exceptions are Next.js framework config constants (`runtime`, `dynamic`, `metadata`) and the two venue data tables — noted here rather than glossed over | e.g. `src/lib/wayfinding.ts:100-108`, `src/lib/itinerary.ts:129-140`, `src/lib/api.ts:92-99` | AWK sweep for `^export (const\|function\|class\|interface\|type)` without a preceding `*/` returns only `export const` framework/data lines |
| **Pure-function domain core.** `crowd-model.ts`, `venue.ts`, `wayfinding.ts`, `itinerary.ts` perform no I/O and import nothing from React or `next/*` | `src/lib/crowd-model.ts:15`, `src/lib/wayfinding.ts:13-14`, `src/lib/itinerary.ts` (no imports) | The four modules at 100% statement coverage; testable with no mocks |
| Duplication removed rather than tolerated: one error envelope + one header set for six routes; one async state machine for four panels; one language list for two panels | `src/lib/api.ts:100-124`, `src/hooks/use-async-action.ts:38-64`, `src/lib/languages.ts:23-34` | Each is imported by every consumer; no second copy exists |
| Impossible states unrepresentable — request lifecycle is a discriminated union, not parallel booleans | `src/hooks/use-async-action.ts:20-24` | `busy && data` cannot be constructed |
| Codebase size | — | 32 TS/TSX files; **3,034** lines `src/`, **1,194** lines `tests/` |

**Note on an inaccuracy found during this audit:** the comment at `src/lib/wayfinding.ts:130-131` says the graph is "~15 nodes". It is **17** (`src/lib/venue.ts:37-58`). The algorithm and its justification are unaffected. Recorded here rather than silently omitted.

---

## 2. Problem Statement Alignment — HIGH impact

*"How accurately your submission targets the root challenge, user needs, and core objectives."*

The challenge names eight capability areas. Seven are implemented; one is not, and is declared as not.

| Challenge keyword | Addressed? | Implementation | Evidence it is real |
| --- | --- | --- | --- |
| **Crowd management** | Yes | Per-zone density/occupancy/queue/alert; Fan Friction Score as mean of *squared* densities, so one packed zone outranks uniform load | `src/lib/crowd-model.ts:178-192`; band thresholds `:58-62`; rationale `:47-53` |
| **Operational intelligence** | Yes | Aggregate score + phase + per-zone alert bands surfaced to the duty manager; zone selection focuses the analysis | `src/components/LiveClock.tsx:29-74`, `src/components/ZonePanel.tsx:25-76` |
| **Real-time decision support** | Yes | Top-3 prioritised actions from live state, each required to name a real zone and cite the density/queue/alert justifying it | `src/app/api/advisor/route.ts:28-50` (prompt), `:53-69` (handler) |
| **Navigation** | Yes | Dijkstra over the walkway graph, edge cost = metres × congestion factor, so the router detours around packed zones | `src/lib/wayfinding.ts:109-192`; congestion weighting `:48-50` |
| **Accessibility** | Yes | Step-free routing enforced by graph construction; accessible seating platforms are real destinations | `src/lib/wayfinding.ts:53-77`; `src/lib/venue.ts:51-52`; itinerary seat choice `src/app/api/itinerary/route.ts:45-47` |
| **Multilingual assistance** | Yes | 10 languages, each listed in its own script; the *entire* reply is composed in the target language | `src/lib/languages.ts:23-34`; prompt instruction `src/app/api/assistant/route.ts:43-46` |
| **Transportation** | Yes | Host-district catalogue with real NJ Transit geography; computed departure lead time; mode-correct arrival gate with load spreading | `src/lib/itinerary.ts:37-80`, `:141-143`, `:156-165` |
| **Fan experience** | Yes | Assistant + personalised end-to-end itinerary, hotel to seat and back | `src/components/FanAssistant.tsx`, `src/components/FanItinerary.tsx` |
| **Sustainability** | **No** | Not implemented. No waste, energy, transport-emissions or resource modelling exists anywhere in the repo. | Stated in `README.md`; `grep -rni "sustainab\|emission\|carbon" src` → 0 |

**Alignment beyond feature-matching — the design decisions the problem forced:**

1. **The model narrates; it never computes an actionable number.** Departure time (`src/lib/itinerary.ts:141`), arrival gate (`:156`), route, distance and walking minutes (`src/lib/wayfinding.ts:185-192`) are all computed before Gemini is called. A hallucinated departure time makes a fan miss kick-off; a hallucinated gate number moves a crowd the wrong way. Rationale in-code at `src/app/api/itinerary/route.ts:1-13`.
2. **Degradation is graded, not binary.** Wayfinding and itinerary return the computed result with `directions: null` / `itinerary: null` when generation fails, rather than a 503 — losing the prose is degraded, losing the path is no answer (`src/app/api/wayfinding/route.ts:41-53`, `src/app/api/itinerary/route.ts:130-142`).
3. **The advisor and the map cannot disagree.** Both read `snapshotAt(clockFromWallTime(Date.now()))` from the same pure function, so the advice is grounded in exactly the numbers on screen (`src/app/api/snapshot/route.ts:25` and `src/app/api/advisor/route.ts:57`).
4. **The honest branch is written.** When a step-free plan has no graph solution, the prompt explicitly forbids inventing a ramp and routes the fan to staff (`src/app/api/itinerary/route.ts:66-79`).

---

## 3. Security — MEDIUM impact

*"Whether the code follows safe practices and avoids common vulnerabilities."*

| What was done | Where | Evidence |
| --- | --- | --- |
| **Security headers on every API response** — applied per-response, so a route is hardened by being written, with no middleware config to forget | `src/lib/api.ts:24-30`, applied at `:47` (errors) and `:89` (success) | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`, `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| **Zod validation at every request boundary.** All four POST bodies are parsed before touching the crowd model or Gemini | `src/lib/validation.ts:25-55`; call sites `advisor/route.ts:55`, `assistant/route.ts:53`, `wayfinding/route.ts:58`, `itinerary/route.ts:147` | Length bounds (`question` 3–500, `language` 2–40, `interests` 1–4 × 1–40 chars) at `validation.ts:31-32`, `:52` |
| **IDs validated against the topology, not merely against `string`** — an unknown zone or district is rejected at the boundary, keeping unresolvable ids out of the router and out of model prompts | `src/lib/validation.ts:19`, `:22`; predicates `src/lib/venue.ts:93-95`, `src/lib/itinerary.ts:125-127` | Prompt injection surface is reduced by construction: only `question` and `interests` are free text; every zone/district/gate string in a prompt comes from the server-side catalogue |
| **API key is server-side only and cannot reach the browser** | `src/lib/gemini.ts:21`, `:35` | `grep -rn "process.env" src` → **2 matches, both in `src/lib/gemini.ts`**. Not `NEXT_PUBLIC_`-prefixed; `gemini.ts` is imported only by route handlers, which run server-side (`runtime = "nodejs"`, e.g. `advisor/route.ts:17`); the key is never placed in a response body |
| **Structured errors that never leak internals.** Clients get a stable machine code and a safe message — never a stack trace, never an upstream error string | `src/lib/api.ts:100-124` | Unmapped throws collapse to `500 INTERNAL_ERROR` / `"An unexpected error occurred."` (`api.ts:122`). Only three error classes are translated: `GeminiUnavailableError`→503, `MalformedBodyError`→400, `ZodError`→422 with field paths only (`:51-56`) |
| Malformed JSON is a 400, not a misleading 500 | `src/lib/api.ts:75-81`, `:107-109` | `MalformedBodyError` distinguished from internal failure |
| **No secrets in the repo** | — | `grep -rniE "AIza[0-9A-Za-z_-]{10,}\|sk-[a-zA-Z0-9]{20,}\|api[_-]?key\s*=\s*[\"'][^\"']{8,}" src tests *.json *.ts *.mjs` → **0 matches**. No `.env` file is tracked; `.gitignore` excludes `.env*` while keeping `.env.example` |
| Client never throws into a render; malformed payloads degrade to a handled error | `src/lib/client.ts:200-230` | Responses are zod-parsed against schemas *typed on the server's own exported types* (`z.ZodType<VenueSnapshot>`, `client.ts:104`), so API/client drift is a compile error |
| No `dangerouslySetInnerHTML`, no `eval` | all of `src` | `grep -rn "dangerouslySetInnerHTML\|eval(" src` → 0. Model output renders as a JSX text child (`OpsAdvisor.tsx:71`), so it is escaped by React |

---

## 4. Efficiency — MEDIUM impact

*"How well the code utilizes resources like time and memory."*

| What was done | Where | Evidence / reasoning |
| --- | --- | --- |
| **Crowd state costs zero I/O.** The model is a closed-form function of the clock — no database, no cache, no network, no shared store. `GET /api/snapshot` is 17 zones of arithmetic | `src/lib/crowd-model.ts:144-192`, `:202-204` | `snapshotAt` reads only `ZONES`; the module imports nothing but `@/lib/venue` (`:15`) |
| **Gemini client cached across warm invocations** — a warm serverless container does not rebuild the SDK client or re-send the system instruction per request | `src/lib/gemini.ts:17`, `:32-49` | `if (cachedModel) return cachedModel;` at `:33` |
| **One shared 4-second poller for the entire console**, not one per component. Consumed once by `ConsoleProvider`; every panel reads from context | `src/hooks/use-venue-snapshot.ts:22`, `:38-61`; single consumer `src/components/ConsoleProvider.tsx:28` | Seven panels, **one** request per 4s. Per-component polling would multiply requests by the panel count *and* let two panels disagree about the same instant — rationale at `use-venue-snapshot.ts:3-15` |
| **Dijkstra with a deliberately linear frontier.** 17 nodes, 21 undirected edges | `src/lib/wayfinding.ts:109-192`; frontier `:132-143` | A binary heap improves `O(V²)` → `O(E log V)`; at V=17 that is ~289 vs ~92 comparisons — unmeasurable, against real added complexity. The choice is justified in-code at `:130-131` (which mis-states the count as ~15; the real count is 17 per `venue.ts:37-58`) |
| Every request cancelled when superseded or unmounted — no wasted in-flight work, no state written by a stale response | `src/hooks/use-async-action.ts:42-46`, `:49-51`, `:57` | `AbortController` aborted on new run and on unmount; `if (controller.signal.aborted) return;` guards the setState |
| O(1) lookups instead of repeated scans | `src/lib/venue.ts:85`, `src/lib/itinerary.ts:117`, `src/lib/wayfinding.ts:123` | `ReadonlyMap` built once at module load; `densityById` built once per route search rather than scanning `snapshot.zones` per edge |
| Failed polls keep the last good snapshot rather than re-fetching or blanking | `src/hooks/use-venue-snapshot.ts:45-49` | Stale-but-labelled beats an empty map for a duty manager |
| Bundle | — | `npx next build` → **126 kB First Load JS** for `/`; page chunk 20.4 kB. No chart, map, i18n or UI framework dependency: 5 production dependencies total (`package.json:16-22`) |

---

## 5. Testing — LOW impact

*"How easily the code can be tested, validated, and maintained over time."*

**Real numbers — `npx vitest run`:**

```
✓ tests/gemini.test.ts      (9 tests)
✓ tests/venue.test.ts       (9 tests)
✓ tests/itinerary.test.ts  (22 tests)
✓ tests/wayfinding.test.ts (19 tests)
✓ tests/crowd-model.test.ts (44 tests)

Test Files  5 passed (5)
     Tests  103 passed (103)
  Duration  5.48s
```

**Real coverage — `npx vitest run --coverage` (v8, `include: ["src/lib/**"]`):**

| File | % Stmts | % Branch | % Funcs | % Lines |
| --- | --- | --- | --- | --- |
| `crowd-model.ts` | 100 | 100 | 100 | 100 |
| `itinerary.ts` | 100 | 100 | 100 | 100 |
| `venue.ts` | 100 | 100 | 100 | 100 |
| `wayfinding.ts` | 100 | 80.95 | 100 | 100 |
| `gemini.ts` | 66.66 | 70 | 100 | 66.66 |
| `languages.ts` | 0 | 100 | 100 | 0 |
| `api.ts` | 0 | 0 | 0 | 0 |
| `client.ts` | 0 | 0 | 0 | 0 |
| `validation.ts` | 0 | 0 | 0 | 0 |
| **All files** | **55.5** | **88.31** | **90** | **55.5** |

**The aggregate is 55.5%, and that is the number reported.** The four pure domain modules are at 100% statements. `api.ts` / `client.ts` / `validation.ts` / `languages.ts` have no unit tests — that is the real gap in this submission.

**The suite is property-based, not tautological.** It does not re-implement the model and compare; it asserts properties that must hold for any correct implementation, swept exhaustively rather than sampled — which the pure-function core makes possible.

| Property asserted | Where | Sweep size |
| --- | --- | --- |
| Density within 0..1 for every zone at every minute | `tests/crowd-model.test.ts:92` | 211 minutes × 17 zones = **3,587 readings** |
| Occupancy never exceeds capacity | `tests/crowd-model.test.ts:102` | 3,587 readings |
| `frictionScore` within 0..100 for every minute | `tests/crowd-model.test.ts:115` | 211 minutes |
| Alert severity never decreases as density rises (monotonicity) | `tests/crowd-model.test.ts:191` | swept |
| Every minute of the matchday maps to a phase | `tests/crowd-model.test.ts:222` | 211 minutes |
| **No step-free route ever touches a stepped zone or stepped walkway** | `tests/wayfinding.test.ts:208` | every ordered zone pair = **272 pairs** |
| Every route is a non-repeating walk over *declared* walkways | `tests/wayfinding.test.ts:239` | 272 pairs |
| Distance is symmetric in both directions | `tests/wayfinding.test.ts:254` | 272 pairs |
| Congested venue is never estimated quicker to cross than an empty one | `tests/wayfinding.test.ts:344` | swept |
| Departure lead time strictly increasing in journey time | `tests/itinerary.test.ts:125`, `:140` | every district pair + arbitrary journeys |
| Every district lands at a gate connected to its own transit zone | `tests/itinerary.test.ts:207` | all districts |
| The venue graph is fully connected | `tests/venue.test.ts:86` | full BFS |

Behavioural assertions are operational, not incidental: stands denser during play than pre-match (`crowd-model.test.ts:238`), concessions peak at half-time (`:245`), gates busier pre-match than during the first half (`:252`), transit heaviest at egress (`:257`), medical posts never leave the normal band (`:262`).

**The suite caught a real bug during development.** `readZone` rounded `density` to 3dp for display but classified `alert` from the *unrounded* value — so a density rounding up across a threshold was published with the band of the value below it, and the record contradicted itself. Because the AI advisor is instructed to base every statement strictly on that data, the model would have been handed a reading saying `density: 0.85, alert: "high"`. The defect and its consequence are written up in the test's own JSDoc at **`tests/crowd-model.test.ts:150-155`**; the guard is **`tests/crowd-model.test.ts:156`** ("publishes an alert band consistent with the density it publishes"), which sweeps all 3,587 readings; the fix — round once, then derive every dependent field from the rounded value — is at **`src/lib/crowd-model.ts:155-169`**, with the reasoning left in-code.

A second defect of the same family is recorded at **`src/lib/wayfinding.ts:180-183`**: `Route.stepFree` originally echoed the request flag instead of being computed from the path, so an unconstrained search that happened to return a fully step-free path reported `stepFree: false`. It is now derived by `isPathStepFree()` (**`src/lib/wayfinding.ts:84-98`**), which re-checks every zone *and* every joining walkway. **Honest scope note:** the suite pins the step-free *guarantee* exhaustively (`tests/wayfinding.test.ts:208`, 272 pairs) and asserts `route.stepFree === true` for a constrained route (`:168`), but there is no test asserting the unconstrained-but-step-free case specifically. That case is guarded by code, not by a test.

**Maintainability:** `npm run verify` runs typecheck + lint + test in one command (`package.json:14`). Test file names map 1:1 onto the modules they cover. No mocks, fake timers or fixtures are needed for the domain suite — a direct dividend of the pure-function core.

**Not claimed:** there is no CI workflow in this repo, no mutation-testing tool, no E2E/browser suite, and no component tests. The gates are run locally by the commands above.

---

## 6. Accessibility — LOW impact

*"How usable the solution is for diverse users and environments."*

| What was done | Where | Evidence |
| --- | --- | --- |
| **Step-free routing as a first-class feature, not a filter.** Stepped zones and walkways are removed from the graph *before* the search, so the guarantee holds by construction | `src/lib/wayfinding.ts:53-77` | Verified exhaustively across all 272 zone pairs (`tests/wayfinding.test.ts:208`) |
| **Accessible seating platforms are real destinations.** Real venues serve level-access wheelchair positions by lift rather than through the stepped bowl, so step-free routing has somewhere to *reach* | `src/lib/venue.ts:48-52` (`access-n`, `access-s`), lift walkways `:80-82`, seat selection `src/app/api/itinerary/route.ts:35-47` | Routing a wheelchair user to the standard stand and reporting "no route" would be an accessibility failure dressed up as a computation — rationale in-code |
| **Accessible entry modelled in the timing, not just the geometry** — accessible lanes are fewer, so the same crowd clears them slower; step-free plans get additive extra lead time | `src/lib/itinerary.ts:102-109`, `:141-143` | Asserted at `tests/itinerary.test.ts:168`, `:178` |
| **Step-free failure is stated, never papered over** | `src/app/api/wayfinding/route.ts:63-71` (404 `NO_ROUTE` naming the fallback), `src/app/api/itinerary/route.ts:66-79`, UI `src/components/FanItinerary.tsx:83-87` | The prompt explicitly forbids inventing a step-free route |
| Skip link, first in the DOM | `src/app/layout.tsx:24-26`; styles `globals.css:109-126` | Target `#main-content` is focusable (`src/app/page.tsx:33`, `tabIndex={-1}`) |
| Document language declared | `src/app/layout.tsx:22` | `<html lang="en">` |
| Visible focus indicator everywhere | `globals.css:88-92` | `:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px }` — global, plus map-specific ring at `:367-373` |
| `prefers-reduced-motion` honoured | `globals.css:781-790` | All animations/transitions/scroll-behavior reduced to 0.01ms |
| `prefers-color-scheme` — both schemes fully styled, not just inverted | `globals.css:794-820`; token set `:17-47` | Alert-band hues are *re-darkened* for light mode because the dark-scheme hues fail 4.5:1 on white (`globals.css:811`) |
| **WCAG AA contrast, measured** | tokens at `globals.css:17-47`, `:794-820` | Computed ratios — **dark:** text/bg 16.17:1, text/surface 14.68:1, muted/surface 8.17:1, accent-contrast/accent 9.46:1; alert bands on surface 6.26–10.38:1. **Light:** text/bg 16.20:1, text/surface 18.22:1, muted/surface 7.32:1, accent-contrast/accent 6.56:1; alert bands 5.93–6.72:1. Every text pair clears AA (4.5:1) in both schemes, most clear AAA (7:1) |
| **Colour is never the only channel** on the map: marker *size* also encodes density, and each marker's accessible name states the reading in words | `src/components/VenueMap.tsx:25-27` (`radiusFor`), `:91` (label), legend `:121-129` | `aria-label={`${zone.name}, ${percent}% full, ${zone.alert}`}` — usable without colour vision and without sight |
| **Keyboard-operable SVG map** | `src/components/VenueMap.tsx:67-72`, `:94-107` | Each zone is `role="button"`, `tabIndex={0}`, `aria-pressed`, activated by Enter *or* Space with `preventDefault()` so Space does not scroll the console |
| Map exposes a summary rather than 17 markers to walk | `src/components/VenueMap.tsx:41-49`, `:83` | `role="group"` with a summarising `aria-label` — deliberately **not** `role="img"`, which makes its subtree presentational and would drop the focusable markers from the a11y tree (axe's `nested-interactive`). Reasoning left in-code at `:76-82` |
| `aria-live="polite"` + `aria-busy` on every async result region | `FanAssistant.tsx:104`, `OpsAdvisor.tsx:60`, `RoutePlanner.tsx:109`, `FanItinerary.tsx:253` | Errors additionally carry `role="alert"` (`FanAssistant.tsx:108`, `OpsAdvisor.tsx:64`, `RoutePlanner.tsx:120`, `FanItinerary.tsx:257`) |
| The 4s-polling status strip is deliberately **not** `aria-live` | `src/components/LiveClock.tsx:21-28` | Announcing values that change every poll would bury the result the user actually asked for. Reasoning in-code |
| Every control labelled; ids collision-free via `useId()` | `FanAssistant.tsx:32-34`, `FanItinerary.tsx:121-125`, `RoutePlanner.tsx:24-26` | Every `<select>`/`<textarea>`/`<input>` has a `<label htmlFor>`; the interests group is a `<fieldset>` with a `<legend>` (`FanItinerary.tsx:179-180`); hints wired with `aria-describedby` (`FanAssistant.tsx:70`, `FanItinerary.tsx:196`) |
| `eslint-plugin-jsx-a11y` recommended rules, applied to `src/**/*.{ts,tsx}` | `eslint.config.mjs:35`, `:39` | `npx eslint . --max-warnings 0` → exit 0 |
| **Multilingual output is marked up, not just translated** | `FanAssistant.tsx:115`, `FanItinerary.tsx:99` | `dir="auto"` + `lang={tagFor(...)}` so an Arabic reply lays out RTL and a screen reader switches voice instead of reading Arabic with an English one. Language options carry their own `lang` (`FanAssistant.tsx:92`) and are listed in their own script (`src/lib/languages.ts:23-34`) |
| The reply language is echoed by the server and used for markup, so late-arriving prose is tagged with the language it was *actually* written in | `src/app/api/itinerary/route.ts:177-180` | Not whatever the picker happens to show when the response lands |

**Not claimed:** no automated axe/Lighthouse scan is committed to this repo, and no screen-reader test was recorded. The contrast ratios above were computed from the CSS tokens; every other row is a code reference. The CSS header comment at `globals.css:11` claims "borders at or above 3:1" — measured, `--border-strong` on `--surface` is 2.00:1 in dark mode. That comment overstates it; the claim is not repeated here.

---

## 7. Google Services (weight ≤ 12.88%)

| What was done | Where | Evidence |
| --- | --- | --- |
| **Google Gemini API** via the official `@google/generative-ai` SDK — the generative layer behind all five AI features | `src/lib/gemini.ts:12`, `:38-47`, `:65-71`; dependency `package.json:17` (`"@google/generative-ai": "^0.21.0"`) | `new GoogleGenerativeAI(apiKey)` → `client.getGenerativeModel(...)` → `model.generateContent(prompt)` |
| Model: `gemini-2.0-flash`, chosen for latency | `src/lib/gemini.ts:15` | Asserted by `tests/gemini.test.ts:93` |
| A system instruction constrains the model to the supplied venue data at the client level, not just per-prompt | `src/lib/gemini.ts:41-46` | "never invent zones, wait times, gate numbers or incidents… If the data does not answer the question, say so plainly." |
| Four distinct grounded prompt surfaces, each with the full zone table rather than a summary — the model is asked to prioritise, not to guess at state | `advisor/route.ts:28-50`, `assistant/route.ts:34-48`, `wayfinding/route.ts:23-39`, `itinerary/route.ts:82-128` | Every zone the model may name is present in the data it was given |
| **The integration is verifiable at runtime.** `GET /api/health` reports the exact model name and whether a key is configured, read from the same module the AI endpoints use | `src/app/api/health/route.ts:20`, `:36-40` | The health response cannot drift from what the app really does — rationale at `health/route.ts:4-12` |
| Model attribution surfaced in the UI, per panel | `OpsAdvisor.tsx:73`, `FanAssistant.tsx:119`, `RoutePlanner.tsx:155`, `FanItinerary.tsx:103` | "Generated by Google {model}" — and the itinerary/route panels state which parts the model did *not* compute |
| Failure is never faked | `src/lib/gemini.ts:66-67`, `src/lib/api.ts:104-106` | No key → `GeminiUnavailableError` → `503 AI_UNAVAILABLE`; the UI names the missing key (`OpsAdvisor.tsx:19-21`). Tested at `tests/gemini.test.ts:54`, `:61`, `:69` |

**Honest scope — this is the only Google service used.** No Vertex AI, BigQuery, Pub/Sub, Cloud Run, Firebase, Cloud Storage, Maps Platform or Secret Manager. **No GCP billing account was available for this build**, which rules out the entire billed GCP surface; the free-tier Gemini API is used directly and the app is deployed on Vercel.

Verification: `grep -rn "process.env" src` returns 2 matches, both `GEMINI_API_KEY` in `src/lib/gemini.ts`. `package.json` lists 5 production dependencies — `@google/generative-ai`, `next`, `react`, `react-dom`, `zod` — and exactly one is a Google SDK. There is no `google-cloud`, `@google-cloud/*`, `firebase` or `googleapis` package anywhere in the dependency list.
