# Engineering notes — PitchOps 26

How this repository is built, and the evidence for each claim it makes about itself. Every figure below was produced by running the command named next to it, against this commit, and every `file:line` reference points at the code that implements the thing described. Where something is not built, it says so.

**Verification commands used throughout:**

```bash
npx tsc --noEmit                  # exit 0
npx eslint . --max-warnings 0     # exit 0
npx vitest run                    # Test Files 12 passed (12) / Tests 387 passed (387)
npx vitest run --coverage         # table under "Testing"
npx next build                    # ✓ Compiled successfully, 8 routes
npm audit                         # found 0 vulnerabilities
find src tests -name '*.ts' -o -name '*.tsx' | wc -l   # 44
```

---

## 1. Type safety and lint discipline

| What was done | Where | Verifiable evidence |
| --- | --- | --- |
| TypeScript `strict`, **plus** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | `tsconfig.json:11-17` | `npx tsc --noEmit` → **exit 0**, 0 errors |
| ESLint on `typescript-eslint` **`strictTypeChecked`** with type-aware linting (`projectService: true`) — catches floating promises and unsafe `any` access that syntactic linting cannot see | `eslint.config.mjs:23`, `:27` | `npx eslint . --max-warnings 0` → **exit 0**, 0 errors, 0 warnings |
| **No rule is disabled to pass the build.** The config turns rules *on* and escalates to `error`. The two `off` entries are scoped and justified in comments: `explicit-function-return-type` for test files (`:55`), and `disableTypeChecked` for `eslint.config.mjs` itself (`:64`), which is JavaScript and outside the TS program | `eslint.config.mjs:38-50` (rules, all `error`), `:53-56`, `:58-65` | `grep -rn "eslint-disable\|@ts-ignore\|@ts-expect-error\|@ts-nocheck" src tests eslint.config.mjs` → **exactly 1 match**, `tests/api.test.ts:226`. It is a one-line `eslint-disable-next-line @typescript-eslint/only-throw-error` in a test that deliberately throws a raw string, to prove the error envelope maps a thrown non-`Error` to 500 without echoing it. Suppressing the rule *is* the test. **`src/` contains zero suppressions of any kind.** |
| No `any` | all of `src`, `tests` | `grep -rn ": any\|as any\|<any>" src tests` → **0** |
| No non-null assertions | all of `src` | `grep -rnE '[A-Za-z0-9_)\]]!\.' src` → **0** (`no-non-null-assertion` is also `error`, `eslint.config.mjs:43`) |
| No `TODO` / `FIXME` / `HACK` | all of `src`, `tests` | `grep -rni "TODO\|FIXME\|XXX\|HACK" src tests` → **0** |
| No `console.log` | all of `src`, `tests` | `grep -rn "console.log" src tests` → **0**; rule enforced at `eslint.config.mjs:46` |
| No inline styles — all presentation in one tokenised stylesheet | `src/app/globals.css` (885 lines) | `grep -rn "style={{" src` → **0** |
| `explicit-function-return-type` enforced in `src/**` | `eslint.config.mjs:44` | Every function in `src/` declares its return type; lint exit 0 |
| **Every exported function, class, interface and type alias carries JSDoc.** Exceptions are Next.js framework config constants (`runtime`, `dynamic`, `metadata`) and the venue data tables — noted here rather than glossed over | e.g. `src/lib/wayfinding.ts:100-108`, `src/lib/itinerary.ts:173-184`, `src/lib/api.ts:92-99` | AWK sweep for `^export (const\|function\|class\|interface\|type)` without a preceding `*/` returns only `export const` framework/data lines |
| **Pure-function domain core.** `crowd-model.ts`, `venue.ts`, `wayfinding.ts`, `itinerary.ts` perform no I/O and import nothing from React or `next/*` | `src/lib/crowd-model.ts:15`, `src/lib/wayfinding.ts:13-14`, `src/lib/itinerary.ts:16` | `crowd-model.ts`, `venue.ts` and `itinerary.ts` at **100%** statements, `wayfinding.ts` at **95.65%** (the shortfall is four unreachable guards — see §5); all testable with no mocks |
| Duplication removed rather than tolerated: one error envelope + one header set for six routes; one async state machine for four panels; one language list for two panels; one route-summary component for both panels that render a computed walk; one `generateOptional` for both endpoints that degrade to their computed answer; one set of test helpers for the four suites that share them | `src/lib/api.ts:100-124`, `src/hooks/use-async-action.ts:38-64`, `src/lib/languages.ts:23-34`, `src/components/RouteSummary.tsx:47-70`, `src/lib/gemini.ts:95-101`, `tests/helpers.ts:22-49` | Each is imported by every consumer; no second copy exists |
| Impossible states unrepresentable — request lifecycle is a discriminated union, not parallel booleans | `src/hooks/use-async-action.ts:20-24` | `busy && data` cannot be constructed |
| Codebase size | — | 44 TS/TSX files; **4,056** lines `src/`, **4,654** lines `tests/` |

**Inaccuracies found while writing this document, and fixed:** the comment at `src/lib/wayfinding.ts:130-131` claimed the graph was "~15 nodes" when it is **17** (`ZONES`, `src/lib/venue.ts:51-72`); it now says 17. The stylesheet header claimed border contrast ≥ 3:1 when the token measured 2.00:1; the token was darkened until the claim was true, and `tests/contrast.test.ts` now enforces it against the real CSS.

Both were comments asserting a property that nothing verified — the same class of defect as a README describing a database that does not exist. Writing this document meant fixing them, not annotating them.

---

## 2. What the product does, and for whom

### 2a. The four user types in the brief

The problem statement names four audiences — *"fans, organizers, volunteers, or venue staff"*. Three are served; one is not, and is declared as not.

| User type | Served? | Implementation | Evidence it is real |
| --- | --- | --- | --- |
| **Fans** | Yes | Multilingual assistant, congestion-aware step-free wayfinding, personalised door-to-seat itinerary | `src/components/FanAssistant.tsx`, `src/components/RoutePlanner.tsx`, `src/components/FanItinerary.tsx`; domain at `src/lib/wayfinding.ts`, `src/lib/itinerary.ts` |
| **Venue staff** | Yes | Live congestion map + per-zone detail + 15-min outlook; anticipatory prioritised actions for the duty manager | `src/components/VenueMap.tsx`, `src/components/ZonePanel.tsx`, `src/components/LiveClock.tsx`, `src/app/api/advisor/route.ts:38-74` |
| **Volunteers** | Yes — **stewards only** | `audience: "steward"` rewrites the same grounded state as a plain-language briefing for the one post the volunteer is stood at: what they will see, what to tell fans, one observable escalation trigger | `src/lib/audience.ts:25-53`; prompt `src/app/api/advisor/route.ts:93-127`; fan-register rendering `src/lib/prompt.ts:123-136`. Scoping asserted at `tests/routes.test.ts:577` — *"scopes the steward prompt to their own post and no other zone"*, which sweeps all 17 zones and fails if any other is named |
| **Organizers** | **No** | Not implemented. | Stated in `README.md` and below. `grep -rniE "fixture\|multi-venue\|accreditation\|broadcast\|scheduling" src` → **0 matches**. The repo models one stadium (`src/lib/venue.ts:51` declares a single `ZONES` table) on one 210-minute clock (`src/lib/crowd-model.ts:143`) |

**Organizers are not addressed.** Every model in this repo is scoped to one venue on one matchday: `src/lib/venue.ts` is a single stadium's topology, and `src/lib/crowd-model.ts` is a single 210-minute clock. There is no fixture list, no multi-venue or tournament-level view, no scheduling, accreditation, broadcast, ticketing-inventory or cross-city resourcing anywhere in the code. An organizer's job starts where this console's data stops, and relabelling the duty manager's view a "tournament dashboard" would be a claim the code cannot keep — the same reason sustainability is declared below rather than gestured at.

**The volunteer row is deliberately narrow.** A posted steward is one volunteer role among the many a World Cup runs — transport marshals, accessibility hosts, media assistants, volunteer coordinators. Only the posted-steward case is built, and `AUDIENCES` (`src/lib/audience.ts:28`) holds exactly two values, so the code cannot be read as claiming more.

### 2b. The capabilities the brief calls for

Seven are implemented; one is not, and is declared as not.

| Challenge keyword | Addressed? | Implementation | Evidence it is real |
| --- | --- | --- | --- |
| **Crowd management** | Yes | Per-zone density/occupancy/queue/alert; Fan Friction Score as mean of *squared* densities, so one packed zone outranks uniform load | `src/lib/crowd-model.ts:346-359` (`snapshotAt`); band thresholds `:136-140`; rationale `:51-57` |
| **Operational intelligence** | Yes | **A forecast, not a readout.** `forecastAt(clock, horizon)` projects every zone to a 15-minute horizon, classifies each rising/falling/steady against a deadband that filters the model's own drift, and derives a venue-level friction delta. Surfaced on the status strip and the zone panel, and — the load-bearing part — injected into the advisor's prompt, so recommendations anticipate instead of react | `src/lib/crowd-model.ts:374-420` (`forecastAt`), `:467-473` (`currentReport`, single clock read); horizon justified in-code at `:145-166`; deadbands `:168-186`; classifier `:188-208`; UI `src/components/TrendIndicator.tsx`, `src/components/LiveClock.tsx`, `src/components/ZonePanel.tsx`. Behaviour asserted against the model, not the implementation — see 2c below |
| **Real-time decision support** | Yes | Top-3 prioritised actions from live state **and its projection**, each required to name a real zone and cite the density/queue/alert justifying it; the model is told an action takes ~15 min to reach the floor and to prefer preventing a projected problem where the projection justifies it | `src/app/api/advisor/route.ts:38-74` (duty-manager prompt), `:93-127` (steward prompt), `:150-179` (handler). Asserted at `tests/routes.test.ts:490` — *"grounds the prompt in the projection as well as the present, for every zone"* — and `:534`, *"instructs the model to prefer acting on the projection where it justifies one"* |
| **Navigation** | Yes | Dijkstra over the walkway graph, edge cost = metres × congestion factor, so the router detours around packed zones | `src/lib/wayfinding.ts:109-192`; congestion weighting `:48-50` |
| **Accessibility** | Yes | Step-free routing enforced by graph construction; accessible seating platforms are real destinations | `src/lib/wayfinding.ts:53-77`; `src/lib/venue.ts:65-66` (`access-n`, `access-s`); itinerary seat choice `src/app/api/itinerary/route.ts:39-41` (`seatZoneFor`) |
| **Multilingual assistance** | Yes | 10 languages, each listed in its own script; the *entire* reply is composed in the target language | `src/lib/languages.ts:23-34`; prompt instruction `src/app/api/assistant/route.ts:41-44` |
| **Transportation** | Yes | Host-district catalogue with real NJ Transit geography; computed departure lead time; mode-correct arrival gate with load spreading. **Egress surge on the ops side:** the rail link and bus terminal are zones like any other, so the forecast reports them loading in the quarter-hour *before* the final whistle rather than once the platform is full | Catalogue `src/lib/itinerary.ts:39-82`; lead time `:185` (`recommendedDepartureMinutes`); gate `:203` (`arrivalGate`); egress projection asserted at `tests/crowd-model.test.ts:642` — *"sees transit loading up before egress begins"*, which sweeps minutes 135–149 and requires every transit zone to read `rising` |
| **Fan experience** | Yes | Assistant + personalised end-to-end itinerary, hotel to seat and back | `src/components/FanAssistant.tsx`, `src/components/FanItinerary.tsx` |
| **Sustainability** | **No** | Not implemented. No waste, energy, transport-emissions or resource modelling exists anywhere in the repo. | Stated in `README.md`; `grep -rni "sustainab\|emission\|carbon" src` → 0 |

**Honest scope on transportation.** The forecast buys the *venue* fifteen minutes of warning on the egress surge, which is what a duty manager can act on. It does not reach outside the fence: there is no train-timetable integration, no service-frequency model and no departure-boards feed, and the fan-facing itinerary is computed from the district catalogue rather than from the forecast.

### 2c. The forecast is asserted against the model, not restated from it

"Operational intelligence" is the claim most easily faked by rendering an extra number, so the forecast is tested for behaviour a wrong implementation would fail:

| Property asserted | Why it is not a tautology | Where |
| --- | --- | --- |
| Concessions are reported **rising** at every minute from which the horizon lands in half-time (75→89) | The half-time rush is *the* concessions load event. A forecast that only reports it once it has started is a readout with a delay, not a warning — this is the window in which extra tills can still be opened | `tests/crowd-model.test.ts:596` — *"sees the half-time concessions rush coming before it starts"* |
| Gates are reported **falling**, with the projected queue strictly shorter, at every minute from which the horizon lands after kick-off (30→44) | The mirror case. An advisor told the gates are merely "busy" holds staff on a queue that is dissolving on its own | `:619` — *"sees the gates draining once the match is under way"* |
| Transit is reported **rising** at every minute from which the horizon lands in egress (135→149) | The egress surge, seen before it arrives | `:642` — *"sees transit loading up before egress begins"* |
| Projection equals `snapshotAt(clock + horizon)` exactly, for all 211 minutes × 17 zones | The property the whole forecast rests on: it is the model *read* forward, not a curve fitted to it. Asserted against `snapshotAt`, so re-implementing `forecastAt` wrongly cannot pass | `:403` — *"projects exactly the snapshot at clock + horizon, for every minute"* |
| Published `trend` always equals `classifyTrend(published delta)` — swept over the matchday | Same defect class as the density/alert bug in §5: a record that contradicts itself is one the advisor is instructed to trust | `:548` — *"publishes a trend consistent with the delta it publishes"* |
| Deadband boundaries pinned at ±0.05 inclusive; rising/falling mirrored around zero | Off-by-one here mislabels a moving zone as steady, which is the one error that makes the panel worse than absent | `:344` — *"classifyTrend — deadband boundaries"* |
| `FORECAST_HORIZON_MINUTES` ≤ the shortest phase, derived from `phaseFor` rather than hard-coded | The horizon's stated justification is that a projection can never skip a phase. The test derives the shortest phase from the model, so changing `phaseFor` breaks it | `:488` — *"never skips a phase, because the horizon fits inside the shortest one"* |
| All three classifications actually occur across the matchday; venue trend both rises and falls | Guards the opposite failure: a deadband so wide everything reads "steady" would make the panel decoration | `:672` — *"produces all three classifications across the matchday"* |
| Horizon wraps the matchday: at clock 200 the horizon is minute 5, not 215 | The matchday loops, so the last quarter-hour is exactly where a naive `clock + 15` runs off the end | `:441` — *"wraps the horizon around the end of the matchday"* |

**Graceful degradation.** The forecast is computed, never generated, so a model outage costs the prose and not the projection: `GET /api/snapshot` never calls Gemini, and the whole route suite runs with **no API key configured** — asserted at `tests/routes.test.ts:324`, *"serves the forecast with no model key configured"*. This is the same graded-degradation rule wayfinding and the itinerary already follow.

**API shape — why the forecast rides on `GET /api/snapshot` rather than a `GET /api/forecast`.** Two reasons, both stated in-code at `src/app/api/snapshot/route.ts:1-19`. It costs nothing (the crowd model is a pure function of the clock, so projecting it is arithmetic over the same 17 zones, with no I/O to duplicate), and it cannot tear: `currentReport()` reads the wall clock **once** and derives both halves from it, where a second endpoint would be a second request on a clock that advances every four seconds — the map could then draw minute 30 while the trend arrow beside it describes minute 31. A separate route would also mean a second poller, and this console deliberately has exactly one (§4). The anchoring is asserted at `tests/crowd-model.test.ts:716` (*"anchors the forecast to the same clock minute as the snapshot"*) and end-to-end at `tests/routes.test.ts:310` (*"anchors the attached forecast to the same instant as the snapshot"*).

**Alignment beyond feature-matching — the design decisions the problem forced:**

1. **The model narrates; it never computes an actionable number.** Departure time (`src/lib/itinerary.ts:185`, `recommendedDepartureMinutes`), arrival gate (`:203`, `arrivalGate`), route, distance and walking minutes (`src/lib/wayfinding.ts:185-192`) are all computed before Gemini is called; the prompt states it outright — *"Every number below is already computed; do not change or recompute any of them"* (`src/app/api/itinerary/route.ts:93`). A hallucinated departure time makes a fan miss kick-off; a hallucinated gate number moves a crowd the wrong way. Rationale in-code at `src/app/api/itinerary/route.ts:1-13`.
2. **Degradation is graded, not binary.** Wayfinding and itinerary return the computed result with `directions: null` / `itinerary: null` when generation fails, rather than a 503 — losing the prose is degraded, losing the path is no answer. The policy is stated once, as `generateOptional` (`src/lib/gemini.ts:95-101`, contract in-code at `:73-94`), and consumed by both endpoints (`src/app/api/wayfinding/route.ts:59`, `src/app/api/itinerary/route.ts:157`); the advisor and assistant call `generate` instead and *do* return 503, because their entire answer is the generated text.
3. **The advisor and the map cannot disagree.** Both derive their state from one wall-clock read through the same pure function — `currentReport()` for the advisor (`src/app/api/advisor/route.ts:155`) and `/api/snapshot` for the map (`src/app/api/snapshot/route.ts:36`) — so the advice is grounded in exactly the numbers on screen.
4. **The audience is a prompt-construction decision, not a tone setting.** A steward does not get the duty manager's document in a friendlier voice — they get a different prompt built from a different slice of the same grounded state: their post only, rendered through `describeZoneForFan` / `describeTrendForFan` rather than the ops pair, with the venue table absent entirely (`src/app/api/advisor/route.ts:93-127`). Handing a volunteer 17 zones invites the model to send them somewhere they are not posted; the exclusion is asserted over the whole topology (`tests/routes.test.ts:577`, `:591`) rather than spot-checked.
5. **A steward briefing requires a post, and the schema says so.** `audience: "steward"` without a `zoneId` is a 422, not a briefing addressed to nobody (`src/lib/validation.ts:67-75`). The rule is a zod refinement because it is the one constraint the field types cannot express, and it is enforced at the boundary so the handler never has to decide what an unposted steward means — asserted at `tests/routes.test.ts:637`, *"rejects a steward request with no zone, before calling the model"*. The panel disables the button for the same reason, so the operator learns it before spending a request (`src/components/OpsAdvisor.tsx:63-66`).
6. **Backwards compatibility is a tested property, not a hope.** `audience` is optional and defaults to `duty-manager` in the handler (`src/app/api/advisor/route.ts:153`) rather than in the schema, so a client written before stewards existed parses to exactly the body it always did — asserted at `tests/validation.test.ts:95`, *"accepts a body with no audience, leaving the key absent"*, and end-to-end at `tests/routes.test.ts:405`.

---

## 3. Security posture

| What was done | Where | Evidence |
| --- | --- | --- |
| **Security headers on every API response** — applied per-response, so a route is hardened by being written, with no middleware config to forget | `src/lib/api.ts:24-30`, applied at `:47` (errors) and `:89` (success) | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`, `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| **Zod validation at every request boundary.** All four POST bodies are parsed before touching the crowd model or Gemini | `src/lib/validation.ts:67-103`; call sites `advisor/route.ts:152`, `assistant/route.ts:51`, `wayfinding/route.ts:44`, `itinerary/route.ts:124` | `question` bounded 3–500 chars (`validation.ts:79`); `interests` bounded to an array of 1–4 (`:100`), because they are prompt input and a fan who selects everything has expressed no preference |
| **Prompt-injection hardening: every prompt field is refined against a catalogue, not a length.** `interests` and `language` are now checked by `isKnownInterest` / `isKnownLanguage`, exactly as zone and district ids already were. All four are interpolated into a model prompt verbatim, so a field validated only by length is a field an attacker writes | Rationale in-code `src/lib/validation.ts:9-19`; refinements `:29` (zone), `:38` (audience), `:41` (district), `:44` (interest), `:52` (language); predicates `src/lib/venue.ts:114-116`, `src/lib/itinerary.ts:112-114`, `src/lib/languages.ts:53-55` | `language: "English. Ignore all prior instructions"` passes `min(2).max(40)` and **fails** `isKnownLanguage` → 422. After this, the only free text reaching any prompt is `question`; every zone, district, gate, interest and language string in a prompt comes from a server-side catalogue this repository wrote. Every catalogue is the same one the picker renders, so no legitimate fan can select a value these schemas reject |
| **IDs validated against the topology, not merely against `string`** — an unknown zone or district is rejected at the boundary, keeping unresolvable ids out of the router and out of model prompts | `src/lib/validation.ts:29`, `:41`; predicates `src/lib/venue.ts:114-116`, `src/lib/itinerary.ts:169-171` | Asserted at `tests/routes.test.ts:649` — an unknown audience is a 422 **and does not call the model**; and at `:359`, which proves no invalid body on any POST route reaches Gemini |
| **API key is server-side only and cannot reach the browser** | `src/lib/gemini.ts:21`, `:35` | `grep -rn "process.env" src` → **2 matches, both in `src/lib/gemini.ts`**. Not `NEXT_PUBLIC_`-prefixed; `gemini.ts` is imported only by route handlers, which run server-side (`runtime = "nodejs"`, e.g. `advisor/route.ts:28`); the key is never placed in a response body |
| **Structured errors that never leak internals.** Clients get a stable machine code and a safe message — never a stack trace, never an upstream error string | `src/lib/api.ts:100-124` | Unmapped throws collapse to `500 INTERNAL_ERROR` / `"An unexpected error occurred."` (`api.ts:122`). Only three error classes are translated: `GeminiUnavailableError`→503, `MalformedBodyError`→400, `ZodError`→422 with field paths only (`:51-56`) |
| Malformed JSON is a 400, not a misleading 500 | `src/lib/api.ts:75-81`, `:107-109` | `MalformedBodyError` distinguished from internal failure |
| **No secrets in the repo** | — | `grep -rniE "AIza[0-9A-Za-z_-]{10,}\|sk-[a-zA-Z0-9]{20,}\|api[_-]?key\s*=\s*[\"'][^\"']{8,}" src tests *.json *.ts *.mjs` → **0 matches**. No `.env` file is tracked; `.gitignore` excludes `.env*` while keeping `.env.example` |
| Client never throws into a render; malformed payloads degrade to a handled error | `src/lib/client.ts:151-231` | Responses are zod-parsed against schemas *typed on the server's own exported types* (`z.ZodType<SnapshotResponse>`, `client.ts:162`; rationale `:9`), so API/client drift is a compile error. Asserted at `tests/client.test.ts` — a payload failing the schema returns a `BAD_RESPONSE` result, never a throw |
| No `dangerouslySetInnerHTML`, no `eval` | all of `src` | `grep -rn "dangerouslySetInnerHTML\|eval(" src` → 0. Model output renders as a JSX text child (`OpsAdvisor.tsx:128`, `FanAssistant.tsx:115`), so it is escaped by React |
| **Zero known vulnerabilities in the dependency tree** | `package.json` | `npm audit` → `{critical: 0, high: 0, moderate: 0, low: 0, info: 0}` |

### Dependency vulnerabilities found and fixed

These were not theoretical. Vercel **refused the first production deploy** with *"Vulnerable version of Next.js detected"*, which surfaced a real CVE in the pinned framework version. Fixing it properly meant working the tree down to zero:

| Finding | Severity | Action |
|---|---|---|
| Next.js `15.1.6` — known CVE, deploy blocked by Vercel | — | upgraded to `16.2.10` (`package.json:19`); verified all 8 routes still build and the whole suite still passes |
| `esbuild` dev-server advisory (GHSA-67mh-4wv8-2f99) via vitest 2 | moderate | upgraded vitest `2 → 4` |
| `vite` transitive advisory | **high** | resolved by the same upgrade |
| `postcss < 8.5.10` via Next | moderate | pinned with an `overrides` entry |
| `eslint-config-next@15.1.6` — **unreferenced dead dependency** | — | removed; it was left behind by the flat-config migration and was still dragging in vulnerable transitives |

The last row is worth calling out: it was a dependency that no file imported, pinned in `package.json`, contributing vulnerabilities to the tree. That is simultaneously a code-quality defect and a security defect.

---

## 4. Performance and resource use

| What was done | Where | Evidence / reasoning |
| --- | --- | --- |
| **Crowd state costs zero I/O.** The model is a closed-form function of the clock — no database, no cache, no network, no shared store. `GET /api/snapshot` is 17 zones of arithmetic | `src/lib/crowd-model.ts:287-314` (`readZone`), `:346-359` (`snapshotAt`) | `snapshotAt` reads only `ZONES`; the module imports nothing but `@/lib/venue` (`:15`) |
| **Gemini client cached across warm invocations** — a warm serverless container does not rebuild the SDK client or re-send the system instruction per request | `src/lib/gemini.ts:17`, `:32-49` | `if (cachedModel) return cachedModel;` at `:33` |
| **One shared 4-second poller for the entire console**, not one per component. Consumed once by `ConsoleProvider`; every panel reads from context | `src/hooks/use-venue-snapshot.ts:21` (`SNAPSHOT_POLL_MS`), `:40-61`; single consumer `src/components/ConsoleProvider.tsx:28` | Seven panels (`src/app/page.tsx:30-96`), **one** request per 4s. Per-component polling would multiply requests by the panel count *and* let two panels disagree about the same instant — rationale at `use-venue-snapshot.ts:3-15` |
| **Dijkstra with a deliberately linear frontier.** 17 nodes (`venue.ts:51-72`), 21 undirected edges (`venue.ts:81-104`) | `src/lib/wayfinding.ts:109-192`; frontier `:132-143` | A binary heap improves `O(V²)` → `O(E log V)`; at V=17 that is ~289 vs ~92 comparisons — unmeasurable, against real added complexity. The choice is justified in-code at `:130-131` |
| Every request cancelled when superseded or unmounted — no wasted in-flight work, no state written by a stale response | `src/hooks/use-async-action.ts:42-46`, `:49-51`, `:57` | `AbortController` aborted on new run and on unmount; `if (controller.signal.aborted) return;` guards the setState |
| O(1) lookups instead of repeated scans | `src/lib/venue.ts:106` (`ZONES_BY_ID`), `src/lib/itinerary.ts:161` (`DISTRICTS_BY_ID`), `src/lib/wayfinding.ts:123` (`densityById`) | `ReadonlyMap` built once at module load; `densityById` built once per route search rather than scanning `snapshot.zones` per edge |
| Failed polls keep the last good snapshot rather than re-fetching or blanking | `src/hooks/use-venue-snapshot.ts:50-54` | Stale-but-labelled beats an empty map for a duty manager — rationale at `:12-14` |
| Dependency weight | `package.json:17-23` | **5 production dependencies total** — `@google/generative-ai`, `next`, `react`, `react-dom`, `zod`. No chart, map, i18n or UI-framework dependency; the venue map is hand-written SVG (`src/components/VenueMap.tsx`) and the design system is one stylesheet. `npx next build` → 8 routes, ✓ compiled successfully |

---

## 5. Testing and coverage

**Real numbers — `npx vitest run`:**

```
✓ tests/crowd-model.test.ts (81 tests)
✓ tests/routes.test.ts      (65 tests)
✓ tests/validation.test.ts  (62 tests)
✓ tests/client.test.ts      (34 tests)
✓ tests/itinerary.test.ts   (33 tests)
✓ tests/prompt.test.ts      (33 tests)
✓ tests/api.test.ts         (20 tests)
✓ tests/wayfinding.test.ts  (19 tests)
✓ tests/languages.test.ts   (15 tests)
✓ tests/venue.test.ts        (9 tests)
✓ tests/gemini.test.ts       (9 tests)
✓ tests/contrast.test.ts     (7 tests)

Test Files  12 passed (12)
     Tests  387 passed (387)
```

**Real coverage — `npx vitest run --coverage`** (v8, `include: ["src/lib/**", "src/app/api/**"]` — `vitest.config.ts:19`). The scope is every line that runs on the server. React components are excluded because this suite does not render them; counting them would report a number no test earned, which is stated in-code at `vitest.config.ts:16-18`.

| | % Stmts | % Branch | % Funcs | % Lines |
| --- | --- | --- | --- | --- |
| **All files** | **97.33** | **90.95** | **100** | **98.31** |

Twelve of the seventeen files in scope are at 100% on all four measures: `api.ts`, `audience.ts`, `client.ts`, `crowd-model.ts`, `languages.ts`, `prompt.ts`, `validation.ts`, `venue.ts`, and the `advisor`, `assistant`, `health` and `snapshot` route handlers. The five that are not:

| File | % Stmts | % Branch | % Funcs | % Lines | Uncovered statements |
| --- | --- | --- | --- | --- | --- |
| `src/lib/gemini.ts` | 72.72 | 72.72 | 100 | 73.68 | 38–48, 69–70 |
| `src/lib/wayfinding.ts` | 95.65 | 80.64 | 100 | 100 | 91, 95, 118, 144 |
| `src/lib/itinerary.ts` | 100 | 89.47 | 100 | 100 | none (branch only: 156, 225) |
| `src/app/api/itinerary/route.ts` | 95.65 | 88.88 | 100 | 95.45 | 134 |
| `src/app/api/wayfinding/route.ts` | 100 | 83.33 | 100 | 100 | none (branch only: 53) |

**`gemini.ts` is the floor, and it is the honest one.** Its uncovered lines are exactly the two that cannot be tested without testing a mock: `:38-48` constructs the real `GoogleGenerativeAI` client, and `:69-70` is the live `generateContent` network call. Everything around them — the configuration check, the unconfigured path, the error class, the model name — is covered (`tests/gemini.test.ts`). Asserting against a stubbed Google SDK would raise the number and prove nothing.

**The rest of the shortfall is unreachable defensive code, and it is worth naming rather than rounding away.** Every remaining uncovered statement is a guard that cannot currently fire, for one of two reasons.

*Three are `noUncheckedIndexedAccess` tax* — the compiler demands them, the control flow forbids them: `wayfinding.ts:91` re-checks two path elements the loop bounds already guarantee, `:118` re-looks-up a zone resolved on the line above, and `:144` guards a `null` frontier pick a non-empty frontier cannot produce. `itinerary/route.ts:134` is the same shape: an `UNKNOWN_DISTRICT` 422 for an id the schema already refined against the catalogue, kept because the alternative is a non-null assertion (reasoning in-code at `:128-131`). A test could only reach these by defeating the type system.

*One is unreachable because of the topology, not the types* — and that is the more interesting case. `wayfinding.ts:95` rejects a path that crosses a **stepped walkway between two level zones**. No such walkway exists: all four stepped walkways in `WALKWAYS` have at least one stepped endpoint zone (`bus→gate-c`, `gate-c→conc-s`, `conc-n→stand-n`, `conc-s→stand-s`), so the zone loop at `:85-87` always rejects first. The check is not dead weight — it is the half of the step-free guarantee that would start carrying load the moment someone adds a stepped shortcut between two level concourses, which is exactly the edit a "harmless" topology change looks like. It is kept, and reported uncovered, rather than deleted for a prettier number.

These four are counted here rather than excluded, which is why the aggregate is 97.33 and not 100.

**The thresholds are enforced, not decorative.** `vitest.config.ts:24-29` fails the run below **97 / 90 / 98 / 98** — set a hair under what the suite actually reaches, so the gate bites on a real regression rather than sitting decoratively above the true figure. The reasoning, including "do not lower them to make a red build green", is left in-code at `:20-23`. `npm run test:coverage` runs as part of `npm run verify` (`package.json:15`).

**The suite is property-based, not tautological.** It does not re-implement the model and compare; it asserts properties that must hold for any correct implementation, swept exhaustively rather than sampled — which the pure-function core makes possible.

| Property asserted | Where | Sweep size |
| --- | --- | --- |
| Density within 0..1 for every zone at every minute | `tests/crowd-model.test.ts:100` | 211 minutes × 17 zones = **3,587 readings** |
| Occupancy never exceeds capacity | `tests/crowd-model.test.ts:110` | 3,587 readings |
| `frictionScore` within 0..100 for every minute | `tests/crowd-model.test.ts:123` | 211 minutes |
| Alert severity never decreases as density rises (monotonicity) | `tests/crowd-model.test.ts:199` | swept |
| Every minute of the matchday maps to a phase | `tests/crowd-model.test.ts:230` | 211 minutes |
| **No step-free route ever touches a stepped zone or stepped walkway** | `tests/wayfinding.test.ts:208` | every ordered zone pair = **272 pairs** |
| Every route is a non-repeating walk over *declared* walkways | `tests/wayfinding.test.ts:239` | 272 pairs |
| Distance is symmetric in both directions | `tests/wayfinding.test.ts:254` | 272 pairs |
| Congested venue is never estimated quicker to cross than an empty one | `tests/wayfinding.test.ts:344` | swept |
| Departure lead time strictly increasing in journey time | `tests/itinerary.test.ts:138`, `:153` | every district pair + arbitrary journeys |
| Every district lands at a gate connected to its own transit zone | `tests/itinerary.test.ts:220` | all districts |
| Every step-free district lands at a gate that is level *and* reached by a step-free walkway | `tests/itinerary.test.ts:295` | all districts × both access needs |
| The venue graph is fully connected | `tests/venue.test.ts:86` | full BFS |

Behavioural assertions are operational, not incidental: stands denser during play than pre-match (`crowd-model.test.ts:246`), concessions peak at half-time (`:253`), gates busier pre-match than during the first half (`:260`), transit heaviest at egress (`:265`), medical posts never leave the normal band (`:270`).

**The suite caught a real bug during development.** `readZone` rounded `density` to 3dp for display but classified `alert` from the *unrounded* value — so a density rounding up across a threshold was published with the band of the value below it, and the record contradicted itself. Because the AI advisor is instructed to base every statement strictly on that data, the model would have been handed a reading saying `density: 0.85, alert: "high"`. The defect and its consequence are written up in the test's own JSDoc at **`tests/crowd-model.test.ts:154-163`**; the guard is **`tests/crowd-model.test.ts:164`** ("publishes an alert band consistent with the density it publishes"), which sweeps all 3,587 readings; the fix — round once, then derive every dependent field from the rounded value — is at **`src/lib/crowd-model.ts:297-312`**, with the reasoning left in-code.

A second defect of the same family is recorded at **`src/lib/wayfinding.ts:180-183`**: `Route.stepFree` originally echoed the request flag instead of being computed from the path, so an unconstrained search that happened to return a fully step-free path reported `stepFree: false`. It is now derived by `isPathStepFree()` (**`src/lib/wayfinding.ts:84-98`**), which re-checks every zone *and* every joining walkway. **Honest scope note:** the suite pins the step-free *guarantee* exhaustively (`tests/wayfinding.test.ts:208`, 272 pairs) and asserts `route.stepFree === true` for a constrained route (`:168`), but there is no test asserting the unconstrained-but-step-free case specifically. That case is guarded by code, not by a test.

**Maintainability:** `npm run verify` runs typecheck + lint + coverage in one command (`package.json:15`). Test file names map 1:1 onto the modules they cover. No mocks, fake timers or fixtures are needed for the domain suite — a direct dividend of the pure-function core.

**The gates run in CI, not only on a developer's machine.** `.github/workflows/ci.yml` runs on every push and every pull request to `main`, in one job on `ubuntu-latest` with Node 22:

| Step | Command | Why it is a separate gate |
| --- | --- | --- |
| Install | `npm ci` | Installs the lockfile exactly, so a green run cannot depend on a dependency tree one machine happens to have |
| Verify | `npm run verify` | The same typecheck + lint (`--max-warnings 0`) + coverage-thresholded test run a developer runs locally (`package.json:15`) |
| Build | `npm run build` | Exercises the App Router's route collection, which the unit tests do not |
| Audit | `npm audit --audit-level=low` | Fails on any known vulnerability in the shipped tree — the zero above is enforced, not a snapshot |

This is what makes the thresholds on this page gates rather than claims: a regression fails there rather than reaching `main` unnoticed.

**Not claimed:** there is no status badge, no deploy pipeline and no matrix build — one job, one Node version. No mutation-testing tool, no E2E/browser suite and no component tests exist in this repo.

---

## 6. Accessibility

| What was done | Where | Evidence |
| --- | --- | --- |
| **Step-free routing as a first-class feature, not a filter.** Stepped zones and walkways are removed from the graph *before* the search, so the guarantee holds by construction | `src/lib/wayfinding.ts:53-77` | Verified exhaustively across all 272 zone pairs (`tests/wayfinding.test.ts:208`) |
| **Accessible seating platforms are real destinations.** Real venues serve level-access wheelchair positions by lift rather than through the stepped bowl, so step-free routing has somewhere to *reach* | `src/lib/venue.ts:62-66` (`access-n`, `access-s`, with the rationale in-code), lift walkways `:101-103`, seat selection `src/app/api/itinerary/route.ts:39-41` (`seatZoneFor`) | Routing a wheelchair user to the standard stand and reporting "no route" would be an accessibility failure dressed up as a computation — rationale at `itinerary/route.ts:32-35` |
| **Accessible entry modelled in the timing, not just the geometry** — accessible lanes are fewer, so the same crowd clears them slower; step-free plans get additive extra lead time | `src/lib/itinerary.ts:119-126` (`STEP_FREE_EXTRA_MINUTES`), applied at `:186` | Asserted at `tests/itinerary.test.ts:181` — *"always adds strictly more lead time than a non-step-free plan for the same district"* — and `:191`, which pins the premium as constant across journey lengths |
| **Accessible approach modelled in the geometry too** — `arrivalGate` diverts a step-free bus arrival off the stepped Gate C approach to Gate D, rather than sending a wheelchair user to a gate they cannot use | `src/lib/itinerary.ts:203` (`arrivalGate`), step-free gate predicate `:154-159` (`isStepFreeGate`) | Asserted at `tests/itinerary.test.ts:310` — *"diverts bus districts off the stepped Gate C approach"* — and `:295`, which requires every district's step-free gate to be level **and** joined to its transit zone by a step-free walkway |
| **Step-free failure is stated, never papered over** | `src/app/api/wayfinding/route.ts:49-56` — 404 `NO_ROUTE` naming the fallback ("route via a staffed accessible entrance") | The router returns `null` rather than a stepped path, and the handler says why instead of inventing a ramp. `grep -rn "ramp" src` → 1 match, a doc comment on `Walkway.stepFree` (`venue.ts:40`) — no prompt or response ever offers one |
| Skip link, first in the DOM | `src/app/layout.tsx:24-26`; styles `globals.css:111-129` | Target `#main-content` is focusable (`src/app/page.tsx:33`, `tabIndex={-1}`) |
| Document language declared | `src/app/layout.tsx:22` | `<html lang="en">` |
| Visible focus indicator everywhere | `globals.css:90-94` | `:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px }` — global, plus a map-specific drawn ring at `:371-380`, because Safari does not paint `outline` on SVG content (reasoning in-code) |
| `prefers-reduced-motion` honoured | `globals.css:844-853` | All animations/transitions/scroll-behavior reduced to 0.01ms |
| `prefers-color-scheme` — both schemes fully styled, not just inverted | `globals.css:857-885`; dark token set `:17-47` | Alert-band hues are *re-darkened* for light mode because the dark-scheme hues fail 4.5:1 on white — stated in-code and applied at `globals.css:875-879` |
| **WCAG AA contrast, measured** | tokens at `globals.css:17-47` (dark), `:861-879` (light) | Computed ratios — **dark:** text/bg 16.17:1, text/surface 14.68:1, muted/surface 8.17:1, accent-contrast/accent 9.46:1; alert bands on surface 6.26–10.38:1. **Light:** text/bg 16.20:1, text/surface 18.22:1, muted/surface 7.32:1, accent-contrast/accent 6.56:1; alert bands 5.93–6.72:1. Every text pair clears AA (4.5:1) in both schemes, most clear AAA (7:1) |
| **Colour is never the only channel** on the map: marker *size* also encodes density, and each marker's accessible name states the reading in words | `src/components/VenueMap.tsx:25-27` (`radiusFor`), `:91` (label), legend `:121-129` | `aria-label={`${zone.name}, ${percent}% full, ${zone.alert}`}` — usable without colour vision and without sight |
| **Trend is carried by three channels at once**, and colour is the least of them. Trend is the one reading acted on *before* anything is visibly wrong, so it is the last that should depend on seeing a hue | `src/components/TrendIndicator.tsx:25-52`; hues `globals.css:508-518` (`.trend--rising/falling/steady`) | Rendered markup: `<span class="trend trend--rising"><span class="trend__arrow" aria-hidden="true">↗</span><span class="trend__label">Rising — 62% to 79% in 15 min</span></span>`. The arrow is decorative and marked so; the **word** is real text, so a screen reader announces "Rising — 62% to 79% in 15 min" as one phrase, and a monochrome display or colour-blind reader loses nothing. Hues reuse the existing alert-band tokens rather than introducing a fourth palette, so they inherit the contrast already measured in both schemes |
| The audience picker is a labelled, keyboard-operable `<select>`, id-collision-free via `useId()` | `src/components/OpsAdvisor.tsx:56` (`useId`), `:72-88` | `<label htmlFor>` + native `<select>`; options come from the `AUDIENCES` catalogue (`src/lib/audience.ts:28`), so the control cannot offer a value the API rejects |
| **Keyboard-operable SVG map** | `src/components/VenueMap.tsx:67-72`, `:94-107` | Each zone is `role="button"`, `tabIndex={0}`, `aria-pressed`, activated by Enter *or* Space with `preventDefault()` so Space does not scroll the console |
| Map exposes a summary rather than 17 markers to walk | `src/components/VenueMap.tsx:41-49`, `:83` | `role="group"` with a summarising `aria-label` — deliberately **not** `role="img"`, which makes its subtree presentational and would drop the focusable markers from the a11y tree (axe's `nested-interactive`). Reasoning left in-code at `:76-82` |
| `aria-live="polite"` + `aria-busy` on every async result region | `FanAssistant.tsx:104`, `OpsAdvisor.tsx:117`, `RoutePlanner.tsx:110`, `FanItinerary.tsx:215` | Errors additionally carry `role="alert"` (`FanAssistant.tsx:108`, `OpsAdvisor.tsx:121`, `RoutePlanner.tsx:121`, `FanItinerary.tsx:226`) |
| The 4s-polling status strip is deliberately **not** `aria-live` | `src/components/LiveClock.tsx:21-28` | Announcing values that change every poll would bury the result the user actually asked for. Reasoning in-code |
| Every control labelled; ids collision-free via `useId()` | `FanAssistant.tsx:32-34`, `FanItinerary.tsx:83-87`, `RoutePlanner.tsx:25-27`, `OpsAdvisor.tsx:56` | Every `<select>`/`<textarea>`/`<input>` has a `<label htmlFor>`; the interests group is a `<fieldset>` with a `<legend>` (`FanItinerary.tsx:141-142`); hints wired with `aria-describedby` (`FanAssistant.tsx:70`, `FanItinerary.tsx:158`) |
| `eslint-plugin-jsx-a11y` recommended rules, applied to `src/**/*.{ts,tsx}` | `eslint.config.mjs:35`, `:39` | `npx eslint . --max-warnings 0` → exit 0 |
| **Multilingual output is marked up, not just translated** | `FanAssistant.tsx:115`, `FanItinerary.tsx:61` | `dir="auto"` + `lang={tagFor(...)}` so an Arabic reply lays out RTL and a screen reader switches voice instead of reading Arabic with an English one. Language options carry their own `lang` (`FanAssistant.tsx:92`) and are listed in their own script (`src/lib/languages.ts:23-34`) |
| The reply language is echoed by the server and used for markup, so late-arriving prose is tagged with the language it was *actually* written in | `src/app/api/itinerary/route.ts:173-176` (reasoning in-code), consumed at `src/components/FanItinerary.tsx:61` | Not whatever the picker happens to show when the response lands |

**Contrast is enforced by a test, not asserted by a comment.** `tests/contrast.test.ts` reads the real `globals.css`, re-derives every ratio from the actual token values using the WCAG 2.1 relative-luminance formula, and fails the build on regression. It covers body text and muted text at 4.5:1 (WCAG 1.4.3) and strong borders at 3:1 (WCAG 1.4.11), in **both** colour schemes, and includes a self-check against WCAG's published extremes (black-on-white = 21:1) so a broken luminance implementation cannot silently pass every other assertion.

That test found and forced the fix of two real violations: `--border-strong` measured **2.00:1** in dark and **2.22:1** in light, while the stylesheet's own header comment claimed 3:1. Both tokens were darkened (`#556880` → 3.03:1 dark, `#7f8fa1` → 3.31:1 light) until the claim became true. This is the drift class this document exists to catch — a comment asserting a property that nothing verified.

**Not claimed:** no automated axe/Lighthouse scan is committed to this repo, and no screen-reader test was recorded.

---

## 7. Google Gemini integration

| What was done | Where | Evidence |
| --- | --- | --- |
| **Google Gemini API** via the official `@google/generative-ai` SDK — the generative layer behind all **four** AI features (ops advisor, fan assistant, route narrator, itinerary planner) | `src/lib/gemini.ts:12`, `:38-47`, `:65-71`; dependency `package.json:18` (`"@google/generative-ai": "^0.21.0"`) | `new GoogleGenerativeAI(apiKey)` → `client.getGenerativeModel(...)` → `model.generateContent(prompt)` |
| Model: `gemini-2.0-flash`, chosen for latency | `src/lib/gemini.ts:15` | Asserted by `tests/gemini.test.ts:93` |
| A system instruction constrains the model to the supplied venue data at the client level, not just per-prompt | `src/lib/gemini.ts:41-46` | "never invent zones, wait times, gate numbers or incidents… If the data does not answer the question, say so plainly." |
| **Five** distinct grounded prompt surfaces across the four features — the advisor builds two, one per audience. Each ops-facing prompt carries the full zone table rather than a summary, so the model is asked to prioritise, not to guess at state | `advisor/route.ts:38-74` (duty manager), `:93-127` (steward — deliberately *one* zone), `assistant/route.ts:32-45`, `wayfinding/route.ts:23-39`, `itinerary/route.ts:68-119` | Every zone the model may name is present in the data it was given. Asserted at `tests/routes.test.ts:459` — *"grounds the prompt in live readings for every zone"* |
| **The integration is verifiable at runtime.** `GET /api/health` reports the exact model name and whether a key is configured, read from the same module the AI endpoints use | `src/app/api/health/route.ts:20` (import), `:36-40` (response) | The health response cannot drift from what the app really does — rationale at `health/route.ts:4-12`. Asserted at `tests/routes.test.ts:204`, `:209` (both key states) and `:229` (clock derived per request, so a static string could not pass) |
| Model attribution surfaced in the UI, per panel | `OpsAdvisor.tsx:129-130`, `FanAssistant.tsx:118-119`, `RoutePlanner.tsx:136-137`, `FanItinerary.tsx:64-65` | "Generated by Google {model}" — and the itinerary/route panels state which parts the model did *not* compute |
| Failure is never faked, and the degradation is graded | `src/lib/gemini.ts:66-67`, `src/lib/api.ts:104-106` | No key → `GeminiUnavailableError` → `503 AI_UNAVAILABLE` for the advisor and assistant, whose whole answer is the generated text; the UI names the missing key (`OpsAdvisor.tsx:19-21`). Wayfinding and itinerary instead absorb the failure through `generateOptional` (`src/lib/gemini.ts:95-101`) and return their computed answer with `directions`/`itinerary` `null` (`wayfinding/route.ts:59`, `itinerary/route.ts:157`), and the panels say the narration is missing (`RoutePlanner.tsx:129-132`, `FanItinerary.tsx:55-58`). Tested at `tests/gemini.test.ts:54`, `:61`, `:69`; end-to-end at `tests/routes.test.ts:376` and `:562` |

**Honest scope — this is the only Google service used.** No Vertex AI, BigQuery, Pub/Sub, Cloud Run, Firebase, Cloud Storage, Maps Platform or Secret Manager. **No GCP billing account was available for this build**, which rules out the entire billed GCP surface; the free-tier Gemini API is used directly and the app is deployed on Vercel.

Verification: `grep -rn "process.env" src` returns 2 matches, both `GEMINI_API_KEY` in `src/lib/gemini.ts`. `package.json` lists 5 production dependencies — `@google/generative-ai`, `next`, `react`, `react-dom`, `zod` — and exactly one is a Google SDK. There is no `google-cloud`, `@google-cloud/*`, `firebase` or `googleapis` package anywhere in the dependency list.
