# Gantry AI Advisor — Modernization Plan (native tool-use loop)

> Internal engineering plan. Tracks the migration of the AI advisor from a handrolled
> JSON-action agent loop to native provider tool-calling.

## Context

The Gantry advisor is a ~26k-line handrolled multi-provider agent (`src/FileCabinet/SuiteApps/com.gantry.finance/lib/advisor/`). Its provider layer (`Lib_Advisor_AIProviders.js`) already implements **native** function-calling for all six backends (Anthropic, OpenAI, Gemini, OpenRouter, Grok, NetSuite `N/llm`) — it sends a `tools` array and parses `tool_use`/`tool_calls` into a normalized `{type:'tool_call', toolCalls:[{id,name,arguments}]}`. But the agent loop (`Lib_Advisor_StreamingAgent.js`, 10.3k lines) **bypasses that path**: it prompts each model to emit a custom JSON action (`{"action":"GET_DATA",...}`) and hand-parses the model's *text* with `parseJsonResponse()` at **13 sites** (vs. 1 native `toolCalls` read). The 65 tools (`Lib_Advisor_Tools.js`) already carry proper JSON-Schema `parameters`, so ~90% of native tool-calling exists and is routed around.

**Problems this causes:** brittle JSON repair, post-hoc enum/parameter validation, extra "did-you-mean" LLM calls to fix bad parameter names, a 9-phase state machine (`INTENT→REASON_ACT→SYNTHESIZE→RESPOND` + deprecated `SELECT/INVOKE/REFLECT`), no prompt caching (full tool list + context re-sent every step), no 429 handling, and models a generation behind — with the BALANCED tier pinned to **`claude-sonnet-4-20250514`, which is past its 2026-06-15 retirement and will 404** (`Lib_Model_Registry.js:399`).

**Outcome:** switch the loop to native tool-use (the standard `while stop_reason==='tool_use': run tools → append results → re-call` loop), upgrade models, add prompt caching + retry, and delete the FSM/JSON-protocol machinery — cutting `StreamingAgent` by roughly half while preserving the exact client UX and security contracts. Provider coverage: **all five providers in lockstep** before cutover.

## Hard platform constraints (must respect)

- **SuiteScript 2.1, no SDK** — all LLM calls go out via `N/https` (raw REST). Handrolled HTTP is unavoidable and is not the problem.
- **Poll-per-step execution** — client calls `advisor_chat_async` → gets `request_id`, then polls `advisor_status` every 500ms. Each poll = `Orchestrator.getStatus()` → `acquireProcessingLock` → **one** `StreamingAgent.runStep(state)` → persist state or complete. Each poll is a **fresh RESTlet execution** (fresh governance budget). The native loop maps perfectly: **one model round-trip per `runStep` = one poll.**
- **No real streaming** — `N/https` is blocking; "streaming" is the poll loop. Keep `max_tokens` modest (~8k) and effort bounded so a single call returns inside the RESTlet timeout.
- **N/cache limits** — progress blob ≤ ~450KB, data refs ≤ ~400KB, TTL 15min (`Lib_Advisor_Cache.js`). Large tool results are already stored by `dataRef`; the new `messages` array must store **compact tool_result summaries + dataRef**, never inline rows.

## Keep vs. Replace (guardrail)

| Component | Verdict |
|---|---|
| 65 tool JSON-schemas + `ALL_TOOLS[name].execute` + `validateAndNormalizeArgs` + `checkToolAccess` (`Lib_Advisor_Tools.js`) | **KEEP** — reuse as native `tools` |
| `QueryValidator` / `QueryExecutor` / `EntityResolver` (SuiteQL safety, name→ID) | **KEEP** — orthogonal safety layers |
| Cache ownership/isolation, `requireAdvisorAccess`, per-tool `checkToolAccess` | **KEEP** — security; harness asserts these |
| Directive parsing (`parseMarkdownDirectives`/`parseTableDirective`/`parseChartDirective`/`parseMetricsDirective`) + UX step emitters (`upsertThinkingStep`/`addToolCallStep`/`updateToolCallStep`) + `buildFinalResponse` | **KEEP** — client contract (`steps`/`blocks`/`narration`/`answer`/`richContent`) |
| `Lib_Advisor_Utils` helpers (`debugLog`,`escapeSql`,`cleanQuery`,`formatResultsCompact`,`extractErrorDetails`,`checkGovernance`,…) | **KEEP** — reuse |
| Orchestrator shape (`processChatAsync`/`getStatus`/`getUsage`) + Router actions + client (`Dashboard.Advisor.js`,`Gantry.AdvisorRenderer.js`) | **KEEP UNCHANGED** — server must keep emitting the same poll shape |
| 9-phase FSM, `REASON_ACT` JSON-action protocol, `parseJsonResponse` (13 sites), `SELECT/INVOKE/REFLECT`, param "did-you-mean" LLM calls, most circuit-breakers | **REPLACE** with native loop + `stop_reason` + max-rounds |
| `SYNTHESIZE` custom-SQL phase | **REPLACE** with a `run_suiteql` tool (model calls it natively; guarded by `QueryValidator`/`QueryExecutor`) |

## Target architecture — native tool-use on poll-per-step

State persists a provider-neutral **`messages`** array (turns carrying `text`/`tool_use`/`tool_result` blocks) instead of `phase`+`accumulatedData`. Each `runStep`:

1. Governance check (`Utils.checkGovernance`), then `AIProviders.callAI({ system, tools, messages, tier, ... })` — **one** round-trip. Record `usage`.
2. **If** `stopReason==='tool_use'` (toolCalls present): push assistant turn (text + `tool_use` blocks) to `messages`; for each call → `addToolCallStep(running)` → `Tools.executeTool(name,args)` → store big rows via `Cache` dataRef → build `tool_result` block = `formatResultsCompact()` summary + `dataRef` → `updateToolCallStep(complete)` → update `sessionContext.lastDataRefs`/`resolvedEntities`; push user turn of `tool_result` blocks; `state.rounds++`; return `{hasMore:true}`.
3. **Else** (`end_turn` or rounds exhausted): `richContent = parseMarkdownDirectives(text, dataRefs)`; return `{hasMore:false, response: buildFinalResponse(...)}`.
4. Safety: `MAX_ROUNDS` (~8–12) replaces `MAX_REASON_ACT_ITERATIONS`/circuit-breakers.

This deletes the action-enum protocol, `parseJsonResponse`, the phase FSM, and the param-fix LLM calls; gives **parallel tool calls** for free.

## Phased implementation (each phase independently shippable; feature-flagged)

### Phase 0 — Quick wins (no behavior change, ship first)
- **`Lib_Model_Registry.js`**: fix the retired BALANCED model; bump Anthropic tiers to current — `{1:'claude-haiku-4-5', 2:'claude-sonnet-4-6', 3:'claude-opus-4-8'}` (verify OpenAI gpt-5 / Gemini 2.5 ids); set `recommended`. Keep `maxOutput` non-streaming-safe (~8192) given `N/https`.
- **`Lib_Advisor_AIProviders.js`**: add `stopReason` + `usage:{inputTokens,outputTokens,cacheReadTokens}` to the normalized return (all providers); add a small **retry wrapper** (429/5xx → exponential backoff + jitter, parse `Retry-After`, ~3 tries) around each `https.post`.

### Phase 1 — Provider transport: structured `messages` round-tripping (all 5, lockstep)
Add a provider-neutral `messages` option to `callAI` (content = string **or** array of `{type:'text'|'tool_use'|'tool_result', ...}` blocks). Translate per provider in their `callX` functions:
- **Anthropic**: native content blocks; `tool_result` = `{type:'tool_result', tool_use_id, content}`; add `cache_control` on the stable **tools+system** prefix.
- **OpenAI / OpenRouter / Grok**: assistant `tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify}}]`; results as `{role:'tool', tool_call_id, content}`; map internal id↔`tool_call_id`.
- **Gemini**: model part `{functionCall:{name,args}}`; result turn part `{functionResponse:{name,response}}`; **synthesize stable ids** (`name#round`) since Gemini omits ids; keep id↔name map. Reuse `sanitizeParametersForGemini`.
- **NetSuite `N/llm`**: best-effort — if multi-turn `tool_result` round-trip is unsupported, fall back to inlining compact results as text into the next prompt (degraded but functional); flag clearly.
Keep the existing `prompt`+`chatHistory` path for any retained single-shot calls.

### Phase 2 — New native loop behind a flag
- New module **`Lib_Advisor_Agent.js`** implementing the `runStep` loop above; persist `messages` in state.
- Reuse, don't rewrite: `Tools.executeTool`, `Cache` (dataRef storage + `trimAgentStateForStorage` + lock), the UX emitters and directive parsers and `buildFinalResponse` from today's `StreamingAgent` (extract these KEEP helpers into a shared `Lib_Advisor_Render.js` if cleaner).
- Add **`run_suiteql`** tool to `Lib_Advisor_Tools.js` wrapping `QueryValidator`+`QueryExecutor` (replaces the `SYNTHESIZE` phase; its prompt text becomes the tool description).
- **Prompt caching discipline**: keep `tools`+`system` byte-stable (always full schemas — no "enhanced on retry" variants); move volatile context (date, `ACTIVE REQUEST CONTEXT`, resolved entities) into the first user turn so the cached prefix holds.
- **Cache-size guard** in `Lib_Advisor_Cache.js`: `tool_result` blocks store summary+dataRef only; if the blob nears ~450KB, demote oldest `tool_result` bodies to dataRef-only.
- **Flag**: `useNativeToolLoop` in `Lib_Config.js`; `Orchestrator.getStatus` dispatches to `Agent.runStep` vs legacy `StreamingAgent.runStep`. Preserve `requestContext` threading + the `ACTIVE REQUEST CONTEXT` system note (harness + ownership).

### Phase 3 — Cutover + cleanup
- Flip `useNativeToolLoop` default on after parity; delete `StreamingAgent` FSM/`parseJsonResponse`/`SELECT/INVOKE/REFLECT`/`REASON_ACT` protocol/circuit-breakers (~50% reduction).
- Update **`scripts/verify-advisor-harness.js`**: keep all security assertions (cache ownership, router `requireAdvisorAccess`, tools `checkToolAccess`); replace the agent-internal assertions (deterministic-mode strings, `ref_id` enhancement, `SCA:` markers) with native-loop equivalents.
- Update `docs/modules/ai-advisor.mdx` + this doc.

### Phase 4 — Optional polish
- Replace/augment manual FAST/BALANCED/PREMIUM tiering with Anthropic **adaptive thinking** (`thinking:{type:'adaptive'}`) + **`effort`** (bound to `low`/`medium` for latency under the RESTlet timeout).
- Structured outputs (`output_config.format` / `strict` tools) for the final formatting step instead of markdown-directive parsing (optional; directive parsing already works).

## Critical files
- `lib/advisor/Lib_Advisor_AIProviders.js` — transport, normalize (stopReason/usage), caching, retry (Phases 0–1)
- `lib/Lib_Model_Registry.js` — model ids/tiers (Phase 0)
- `lib/advisor/Lib_Advisor_Agent.js` *(new)* — native loop (Phase 2)
- `lib/advisor/Lib_Advisor_StreamingAgent.js` — extract KEEP helpers; later gut FSM (Phases 2–3)
- `lib/advisor/Lib_Advisor_Tools.js` — add `run_suiteql` (Phase 2)
- `lib/advisor/Lib_Advisor_Cache.js` — persist `messages` w/ dataRef tool_result + size guard (Phase 2)
- `lib/advisor/Lib_Advisor_Orchestrator.js` — flag dispatch + usage aggregation (Phase 2)
- `lib/Lib_Config.js` — `useNativeToolLoop` flag (Phase 2)
- `scripts/verify-advisor-harness.js` — update agent assertions (Phase 3)

## Risks & mitigations
- **RESTlet timeout per poll** → one model call per `runStep`, modest `max_tokens`, bounded effort.
- **N/cache 450KB blow** → dataRef-backed `tool_result` + oldest-body demotion.
- **Gemini/`N/llm` round-trip fidelity** → Gemini id-synthesis; `N/llm` text-fallback; test each provider end-to-end.
- **Prompt-cache misses** → byte-stable tools+system; volatile content in user turn; verify `usage.cacheReadTokens>0`.
- **Behavior regressions** → feature flag + keep legacy path until A/B parity on representative questions.
- **Harness breakage** → keep security assertions; rewrite only agent-internal ones.

## Verification
- `npm test` (`verify-production-readiness.js` + updated `verify-advisor-harness.js`) green; `node --check` on every edited file.
- **Scripted dry-run** (mock provider): assert native `tools` sent, `tool_use`→`tool_result` round-trip across a multi-step question, final `richContent` directives parsed, dataRefs resolved, `steps`/`narration` emitted — per provider wire format (Anthropic blocks, OpenAI `role:'tool'`, Gemini `functionResponse`).
- **Sandbox NetSuite**: real questions per provider; confirm the client renders identical steps/tables/charts and answers match legacy; confirm Anthropic prompt-cache hit, 429 backoff, governance headroom, and that a non-admin user is still gated (`checkToolAccess`) with cache owner isolation intact.
