# To-do

Consolidated feature, bug, and optimization backlog. Audit baseline: September 23, 2026.

## How to Use This Backlog

- Unchecked items are pending work, not verified fixes. Audit findings and measurements below are reported evidence, not independently reverified during consolidation.
- The explicitly marked P1 bugs and P2 attachment bug are implemented. Remaining unchecked items are grouped by owner/area without an assigned severity; manual verification remains pending where noted.
- Inspect the existing implementation before changing it, reuse shared owners, and verify the affected behavior. Historical file/line references may have moved.
- Measure optimization results against the baseline below; preserve relevant checks and output quality rather than assuming fewer tokens or cheaper models guarantee savings.

## Features — Chat UI and File Previews

- [x] Allow clicking a subagent to view its current activity and progress. Task cards open the existing Agents sidebar with the selected child expanded, live status, recent tool activity, latest text, and available plan progress; full conversation navigation remains available. Focused progress regressions pass; manual UI verification remains pending.
- [x] Add an elapsed-time counter for each message. Each submitted message shows a live turn timer while working, then a persisted completion-based duration; timers are disposed when inactive or unmounted. Focused timing regressions pass; manual UI verification remains pending.
- [x] Open an in-app file preview when clicking blue file references in chat (for example, `to-do.md`). Links and inline filename mentions use the sidebar file owner. User confirmed opening `to-do.md` in the updated installed desktop app.
  - For Markdown files, provide two tabs: **Preview** for rendered Markdown and **Code** for the raw Markdown source.

## Features — Context and Usage Dashboard

- [x] Redesign the Context details page as one compact, understandable dashboard. Implemented summary cards, role/model averages and shares, effort counts, Jev/Headroom summaries, and transport timing over the full session tree. Automated aggregation checks pass; visual verification remains pending.
  - Remove raw requests, original prompts, prompt IDs, and per-request/provider-attempt lists from the user-facing page. Preserve the underlying records and backend access for AI review and diagnostics; hiding them must not delete evidence.
  - Keep Headroom results and Jev decisions visible as concise summaries, with focused detail only when useful.
  - Show average token usage per model, with input, output, and cache usage clearly distinguished; label the averaging unit and reporting scope.
  - Show the most-used model, usage counts and percentage share by model, and reasoning-effort/weight distribution such as low, medium, and high.
  - Show which models and reasoning efforts Jev selects for the main agent and subagents, including read-only subagents; distinguish routing decisions from actual execution and retries.
  - Include aggregate token usage, cache-hit rate, and known costs without presenting unavailable billing data as zero.
  - Use compact summary cards and a readable model breakdown instead of long nested request accordions. Clearly label metric definitions so model usage, task counts, and provider attempts are not confused.
  - Reuse backend usage/accounting owners and aggregate over the stated scope, not just the currently loaded request page; coordinate with compaction accounting and Jev routing work below.

## Bug Fixes

### API, Authorization, and Session Reliability

- [x] **P1 — Align the app's V2 client with the current server.** The existing shared compatibility adapter uses the current generated client for prompt payloads and catalog routes; focused contract tests pass.
  - Evidence: `packages/app/package.json:59`, `packages/protocol/src/groups/session.ts:215`.
  - Expected: the app uses compatible prompt payloads and catalog routes through the shared API client owner.
- [x] **P1 — Enforce external-directory authorization in Core search.** Existing grep/glob authorization uses canonical path resolution and the shared external-directory permission boundary; focused permission regressions pass.
  - Evidence: `packages/core/src/tool/grep.ts:112`, `packages/core/src/tool/glob.ts:62`.
  - Expected: external-directory searches honor the same authorization boundary as Read.
- [x] **P1 — Reject truncated compaction summaries.** Existing completion validation rejects truncated, missing-finish, errored, empty, and post-finish output; scripted-stream regressions pass.
  - Evidence: `packages/core/src/session/compaction.ts:199`.
  - Expected: an incomplete summary cannot replace valid working history.
- [x] **P1 — Reconcile existing V2 sessions after reconnecting.** Existing reconnect reconciliation refreshes cached history before clearing stale status and preserves newer events; focused regressions pass. Manual reconnect verification remains pending.
  - Evidence: `packages/app/src/context/server-sync.tsx:547`.
  - Expected: reconnect restores history and current status, clears completed runs' busy state, and unblocks queued work.
- [x] Ensure native processes terminate after cancellation. Native commands use the shared process-tree terminator, escalate resistant process groups to SIGKILL, reject pre-cancelled launches, and wait for cleanup before settling. Real macOS process regressions cover cancellation, timeout, and a parent exiting before its resistant child. Windows process-tree behavior and manual Stop verification remain unverified.

### Composer, Attachments, and Chat Layout

- [ ] Fix composer `/` and `@` discovery: project-file search does not return the correct matches, slash commands do not work, and available skills are missing from the slash menu.
  - Manual verification — unverified: search for a known project file with `@` and check the relevant `/` discovery flow; expect correct project-scoped results. Open `/`, filter available commands and skills, and select one; expect skills to appear and the selected command or skill to work.
- [x] **P2 — Keep pending attachments in their originating chat.** Capture the originating draft before processing or opening a picker. Upload, native-picker, file-input, and draft-preservation regressions pass; manual UI verification remains pending.
  - Evidence: `packages/session-ui/src/v2/components/prompt-input/interaction.ts:88`.
  - Expected: starting an attachment in A and switching to B never attaches it to B.
- [x] Fix queued images breaking after reload; queued follow-ups now use blob-backed draft persistence. Durable-reference hydration is unit-tested; reload/send verification remains pending.
- [x] Preserve resource identity when serializing MCP mentions so mentions continue to refer to the intended resource. V1/V2 composers share the file-mention DOM serializer; server identity, resource URI, MIME type, URL, and updated text offsets survive edits and request/optimistic-part construction. Focused regressions pass; live MCP verification remains pending.
- [x] Preserve each project's unsent new-chat draft when navigating away or clicking New Chat for that project again. New Chat reuses the existing draft for the same server and project after tab hydration; explicitly supplied prompt text still creates a new draft. Manual navigation verification remains pending.
- [x] Fix the plan panel's scrollbar overflowing over the chat. The dock establishes its own clipped stacking context and bounds the scroll viewport. Manual visual verification remains pending.
- [x] Make resizing accessible by keyboard, including Home's resize controls. Shared `ResizeHandle` now provides focusable separator semantics, an accessible name, current/min/max values, Arrow-key resizing, and Home/End bounds. Home uses the shared keyboard implementation. Direction/bounds regressions pass; manual keyboard and visual verification remain pending.

## Features — Task Context

- [x] Add an "Independent tasks" switch next to the Browser control in chat. Both composers capture the selected mode per submitted/queued draft; V1 and V2 preserve the visible transcript while excluding previous task contexts from provider requests. History/replay, queue ordering, switching off during preparation, exact retries, context-limit resets, concurrent legacy admission, and stale background-result regressions pass. Manual UI verification remains pending.
  - Click to turn on or off, like the Jev and Browser controls; the user controls isolation explicitly rather than Jev detecting task boundaries.
  - Off: use normal shared conversation context, accumulating up to 250k tokens before closing the chat.
  - On: keep the same visible chat and durable Session, but start a fresh provider task context for each submitted model message without sharing previous tasks' conversation history. Task boundaries are persisted, so small tasks do not require manually creating new chats.
  - Switching from on to off: continue the latest task context for subsequent messages without importing earlier isolated tasks. Followups cannot overtake an independent submission still being prepared or awaiting promotion.

## Jev — Status, Model Selection, and Delegation

### Status and Draft Bugs

- [x] Fix the status label under a sent message remaining stuck on "Jev is selecting a model" after Jev has selected the model. Optimistic model updates are immutable and refresh Jev decision history immediately; manual UI verification remains pending.
- [x] Preserve the active draft when Stop is pressed during Jev preparation instead of losing the user's input. Abort preparation and restore the captured draft immediately; cancellation and late-result regressions pass.

### Model Routing and Efficiency

- [x] Review Jev's model and reasoning-effort selection by task complexity; simple tasks such as adding an item to a Markdown file should use low rather than medium effort. Routing distinguishes cosmetic edits, ordinary fixes, and complex reviews; confidently classified cosmetic tasks select an available none/minimal/low variant of the selected model. Explicit allowed-model restrictions remain respected. `packages/core/src/jev.ts` and the passing `jev-flow` fixture verify low-effort selection even when the routing response chooses high effort; live classification accuracy remains unverified.
- [x] Evaluate available published token, cost, quality, throughput, and latency evidence for newer ChatGPT models and use it in Jev routing. At the user's request, used Artificial Analysis rather than a live paid benchmark. [Comparison and source limits](specs/jev-model-efficiency.md) cover Luna, Sol, and Astra at max effort; Terra statistics were unavailable, and the user approved proceeding with available AA evidence. Jev receives deduplicated benchmark facts only when routing is requested; current provider capabilities/prices and task risk remain part of selection. Per-task-type ArezaCode savings and low-effort quality are not measured by these aggregate benchmarks.
- [x] Add cost-aware delegation in Jev. The existing delegate path now considers all user-allowed candidates with published benchmark evidence rather than silently forcing Astra. It favors economical suitable models for bounded discovery/reading/triage, rejects uncertain delegated routing for escalation, requests concise evidence and uncertainties, and honors explicit tool-level or configured subagent model/effort overrides. Focused routing and task execution regressions pass; live routing quality and actual savings remain unverified.
  - Have Jev automatically select the model and reasoning effort for each read-only subagent based on task complexity, required capabilities, and measured cost/quality; honor explicit user model overrides.
  - Use direct tools for trivial lookups and deterministic checks when delegation would add overhead.
  - Keep cross-cutting reasoning and high-risk review with a capable model; escalate ambiguous results and verify decision-critical evidence without repeating all delegated reading.
  - Measure total cost, tokens, latency, and quality including delegation overhead and retries; cheaper models do not automatically mean fewer tokens or lower total cost.
- [x] Reuse identical Jev context decisions rather than repeating auxiliary model work when the decision inputs are unchanged. `packages/core/src/jev.ts` coalesces in-flight requests and caches decisions with session, prompt, task, content, settings, credentials, and transport scoping. The passing `jev-context-cache` fixture covers reuse, invalidation, bounded storage, concurrent calls, and retrying failed/uncertain results.

## Performance — Context, Latency, Caching, and Cost

### Request Latency and Avoidable Model Work

- [ ] Instrument request dispatch, first response, retry reason, and backoff; recover stalls safely while preserving partial output and avoiding repeated completed actions.
  - [x] Native HTTP dispatch, response headers, retry reasons, and backoff are recorded with request correlation; V2 model usage retains timing and durable retry events. Existing pre-response retry limits remain in place; tests confirm response-stream failures are not retried.
  - Remaining: production stall diagnosis and a dedicated automatic stall-recovery policy. Other transports may lack timing; the dashboard labels this coverage explicitly.
  - Evidence: one Mesto record waited 18m24s before its first stored response step; existing records cannot identify the source of that wait.
- [ ] Reduce administrative model round trips by batching independent lookups and deriving deterministic progress updates from actual tool results.
  - Evidence: 151 assistant steps only executed `todowrite`, carrying 34.5 million cumulative input tokens. Their entire duration is not necessarily removable.
- [ ] Apply cheap deterministic output checks before auxiliary AI work; avoid model calls when deterministic checks can resolve the operation.
- [x] Bound Home's data loading instead of scanning the server's entire session history before displaying a small list. Home requests at most 64 active roots per visible scope using server-side directory filters and updated-time ordering; it no longer drains cursors. Search is debounced and uses at most two bounded requests for title/project-name matches. Collapsed project sections do not fetch sessions. Scoped caches remain bounded and preserve events across overlapping fetches. Index-only database migration and regenerated client are included; focused query/cache tests pass. Production performance and visual verification remain pending.

### Working Context and Reuse

- [ ] Reduce working context with validated checkpoints that preserve constraints, unfinished work, and test evidence, while keeping full history available for retrieval.
  - Implemented foundation: durable context limits and local handoffs in `packages/core/src/session/health.ts` and `packages/core/src/session/handoff.ts`. Handoffs include bounded instruction excerpts, pending work, and verification receipts linked to the original session; complete checkpoint preservation/validation is not established.
  - Evidence: Mesto context grew to 758,539 tokens per assistant record. Coordinate with the compaction correctness fix before relying on summaries.
- [ ] Add content-aware reuse for missing-path discovery and unchanged file excerpts; reuse check results only when their actual inputs remain unchanged.
  - Evidence: the missing `.ai/rules/index.md` was requested 35 times.
- [ ] Replace repeated unchanged preference instructions in every prompt with session-owned context updates when preferences change.
- [x] Measure compression benefit and transformation time, and cache no-benefit results. `packages/core/src/automatic-checks.ts` records accepted input/output character counts and actual processing timestamps, checks positive token savings, and persists unchanged/below-threshold results for reuse. The passing `headroom-cache` fixture covers timing, cross-process reuse, expiry, content/tool-version invalidation, cancellation, and failures. Production before/after savings remain unmeasured.
  - Evidence: 49 Headroom attempts reduced accepted output by only 1.01% overall.

### Provider Caching and Usage Accounting

- [x] Include compaction tokens, cache usage, and known costs in session totals, including rejected summaries. Dedicated durable accounting events preserve usage independently of summary acceptance; replay and totals regressions pass. Unreported costs remain unknown in usage records.
- [x] Fix OpenRouter cache hints lost in multimodal and certain assistant/tool placements. Cache markers are attached using source-message provenance during shared OpenAI-compatible lowering, preserving multipart text boundaries, assistant text, individual tool results, system blocks, and TTLs. Synthetic vision messages and chronological system updates retain their ordering without stealing another message's hints. Focused payload regressions pass; live-provider cache hits and billing remain unverified.
- [ ] Verify live-provider cache behavior and record actual billed costs; stored zero values do not establish zero primary-provider cost.
- [ ] Measure production performance and before/after optimization results while preserving relevant test coverage. Actual speedups and billed savings remain unmeasured.

## Maintainability — Consolidate Shared Owners

These tasks support the corresponding fixes above; extend existing implementations instead of creating parallel owners.

- [ ] Consolidate vendored, workspace-generated, and handwritten API calls; coordinate with the P1 V2 client/server compatibility fix.
- [x] Consolidate V1/V2 composer mention serialization and attachment capture; preserve resource identity and originating-chat ownership.
  - [x] Share mention serialization through `packages/session-ui/src/components/prompt-file-mention.ts`; both composers call the same reader/writer. Resource-identity regressions were recorded as passing in the implementation checks below.
  - [x] Consolidate attachment capture through `packages/session-ui/src/components/prompt-attachment-target.ts`; both composers use the same originating-prompt/cursor capture owner before asynchronous processing. Existing delayed-read, clipboard, batch, upload, native-picker, and file-input ownership regressions pass.
- [ ] Centralize provider cache-placement, TTL, and marker-limit rules; coordinate with OpenRouter cache-hint fixes.
- [ ] Consolidate current and legacy output-processing and automation policies, including deterministic checks before auxiliary AI work.
- [x] Share resize-handle behavior with Home's separate keyboard implementation; Home's duplicate Arrow-key handler and separator attributes now come from the shared `ResizeHandle` owner.

## Maintainability — Readable Code and UI Conventions

- [ ] Establish AI-enforced conventions or a mechanical formatting/checking tool for clean, readable, shadcn-style code and restrained UI output.
  - Standardize readable imports, exports, Tailwind class organization, and vanilla CSS declarations; reuse existing formatters, lint rules, and shared components where possible.
  - Use layout spacing rather than decorative dots, em dashes, or separator lines between unrelated items merely to create space.
  - Remove unsolicited explanatory text and redundant helper copy; keep labels and essential guidance concise.
  - Prefer recognizable icons over wordy buttons and triggers where the action remains clear; provide accessible names and concise tooltips for icon controls.
  - Mechanically enforce deterministic formatting rules and use focused AI review for readability and UI decisions that cannot be reliably autofixed.

## Verification and Audit Follow-Up

### Independent Tasks and Benchmark-Informed Jev — September 24, 2026

- Added persisted task-context boundaries to the existing V1/V2 history and admission owners; visible messages remain in the same chat. Independent inputs queue, implicit followups behind a pending boundary retain ordering, and exact retries preserve recorded delivery. Context limits reset on a new boundary, and the existing System Context epoch owner refreshes current mandatory project instructions rather than reviving an outdated baseline. Legacy independent admission is serialized and atomically persists the message, boundary, and context-limit reset; a failing boundary write rolls the message back. Late background results are conditionally admitted only into their originating task context.
- Added the Independent tasks control beside Browser, captured the preference before asynchronous submission work, and preserved it in queued drafts. A locked chat can enable independent mode from its context notice.
- Added the [dated Artificial Analysis comparison](specs/jev-model-efficiency.md) and benchmark-informed main/subagent selection. Removed forced Astra candidate filtering, preserved explicit overrides, and connected selected model/effort/agent to the current-server switch APIs before prompt admission.
- Regenerated the current client and legacy JavaScript SDK. Focused checks: 140 Core tests, 86 legacy prompt/task tests, and 33 app submission/compatibility tests passed; one pre-existing legacy V2-projector test remains skipped. Core, Opencode, App, Client, Schema, Protocol, and Server typechecks passed. Focused lint reported zero errors and 195 warnings across 31 files; the later four-file context-epoch/history check also reported zero errors, with nine warnings.
- Manual UI, live model decisions, actual provider billing, and production performance remain unverified. No browser verification, live paid model comparison, or production UI benchmark was run.

#### Manual Checks — Unverified

1. Enable Independent tasks, submit A, then B; expect both transcripts to remain visible while B receives no automatic conversation history from A.
2. Disable the switch and submit C; expect C to continue B's context, including when B was still queued, without importing A.
3. Reload the chat and repeat a followup; expect task boundaries and queued draft preferences to survive.
4. With Jev Auto enabled and economical models available, delegate a bounded lookup; expect an allowed model/effort and concise evidence. An explicit model override should be retained.
5. Tab to the Independent tasks control; expect keyboard activation and an announced pressed state without toolbar overflow.

### Concrete Fixes and English-Only Runtime — September 24, 2026

- Implemented shared keyboard resizing, OpenRouter cache-hint preservation, and shared composer attachment-target capture.
- At the user's request, English is the only supported app/desktop locale. Removed both language pickers and non-English app/UI/desktop bundle loading; old non-English preferences normalize to English. Existing English strings and typed translation owners are retained. Non-English dictionary source files remain in the repository but are no longer loaded by these runtimes.
- Focused checks passed: 3 resize-key tests; 6 OpenRouter, 28 OpenAI Chat, and 12 cache-policy tests; 11 English/native-i18n tests; 6 attachment ownership/deduplication tests; 9 V2 attachment/store tests. App, UI, session-ui, Desktop, and LLM package typechecks passed. Focused lint reported zero errors; existing warnings remain.
- Manual checks remain unverified: Tab to Home/sidebar/terminal resize handles and use Arrow/Home/End; expect bounded resizing and visible focus. Start an attachment in A and switch to B; expect it to remain in A. Reopen with an old non-English preference; expect English app/native UI and no language picker. Live-provider caching/billing and production performance were not measured; no browser or production benchmark was run under the manual-verification preference.

### Backlog Status Recheck — September 24, 2026

- Reviewed current source and implementation history at `374e76654`; marked three previously unchecked Jev/Headroom items complete and separated completed mention serialization from pending attachment-capture consolidation.
- Ran `bun test test/speed-cache.test.ts` from `packages/core`: **3 passed, 0 failed** (`headroom-cache`, `jev-context-cache`, `jev-flow`). These isolated fixtures exercise the implementation with controlled provider/Headroom responses; the optional real-Headroom fixture and live providers were not run.
- Existing implementation/test/build receipts below remain historical evidence, not new runs. Manual UI checks, production measurements, and other incomplete backlog items remain pending.

### Implementation Checks — September 24, 2026

- [x] Complete native-command cancellation cleanup, shared MCP mention serialization, plan scrollbar containment, subagent inspection, and per-message elapsed-time implementation.
- [x] Pass 53 focused tests: 48 app regressions and five real native-command process regressions. Pass app, Core, and session-ui package typechecks.
- [x] Build and package the macOS ARM64 desktop app, including the embedded backend, and verify its code signature. Bundle: `packages/desktop/dist/mac-arm64/ArezaCode.app`.
- [x] Record the user's confirmation that chat file references open correctly after updating the installed desktop app.
- New UI behavior, live MCP use, Windows cancellation, and production performance remain unverified. Browser checks were not run under the selected manual-verification preference.

#### Manual Checks — Unverified

1. Stop a native engine operation; expect its process tree to exit and the session to become idle.
2. Insert an MCP resource mention, edit surrounding text, and send; expect the originally selected server/resource to be used.
3. Expand and scroll a long plan, then collapse it; expect the scrollbar to remain inside the plan panel throughout.
4. Click an active subagent card; expect its live activity and progress in the Agents sidebar, with the parent chat retained and an option to open the full child conversation.
5. Send a message and watch its timer; expect it to tick while working, freeze after completion or Stop, and retain the recorded duration after reopening the chat.

### Home Loading and Lint Checks — September 24, 2026

- [x] Pass 74 focused app/Core/Protocol tests, including activity ordering, root/archive/project filtering, cursor decoding, bounded requests, concurrent cache reconciliation, header handling, and migrations.
- [x] Pass app, session-ui, Core, Protocol, Server, and Client package typechecks; regenerate the shared client and pass migration consistency checks.
- [x] Confirm the recent-session query uses its new index without a temporary ordering table. Only indexes are added; this migration does not change session records.
- [x] Pass repository lint with zero errors and focused lint with zero warnings in 15 affected files.
- [x] Build/package the desktop app and verify its code signature. Updated bundle: `packages/desktop/dist/mac-arm64/ArezaCode.app`.
- Manual checks remain unverified: Home ordering and project isolation, searching older chats, reconnect freshness, and caret/typing behavior in the empty composer. Production latency and memory improvements have not been measured.

### Completed Implementation Checks — September 23, 2026

- [x] Mark implemented attachment ownership, queued-image persistence, project draft preservation, Jev cancellation/status, Context dashboard, and compaction-accounting work above.
- [x] Run 187 focused regression tests and seven package typechecks for the implementation batch; regenerate the shared client contract.
- [x] Recheck the four existing P1 fixes with focused regressions before marking them complete.
- [x] Rebuild the web app and desktop app, including the embedded backend, using each package's `bun run build` script.
- Visual verification, live-provider billing, production performance, and automatic stall recovery remain pending as noted above.

### Remaining Audit Follow-Up

- [x] Investigate the four localization test failures reported by the audit. Reproduced the Punjabi `Aran`/`Arab` script mismatch, missing locale keys, missing plural variants, and the resulting placeholder-check crash. The user chose English-only support instead of completing translations. Removed unsupported-locale runtime loading/pickers and replaced obsolete multilingual parity checks with English/native-bundle and plural-family regressions; all 11 current i18n tests pass.
- [x] Resolve the reported lint error and triage warnings in affected files. Replaced the invalid empty-editor CSS escape, bound composer callbacks, removed unsafe fixture assertions/unused imports, and fixed tuple-form request headers being spread into numeric keys. Repository lint now exits successfully with zero errors; 15 affected source/test files report zero warnings. The latest full lint run still reports 5,044 warnings elsewhere.
- [ ] Assess application reachability of dependency advisory matches rather than treating advisory count as confirmed exploitable issues.
- [ ] Bring the remaining actionable findings from the full audit into this backlog. The source audit reported 20 actionable findings and five optimization opportunities; its summarized findings are not the complete set of 20.

### Manual Checks — Unverified

1. Start an attachment in chat A, then switch to B; expect the attachment to remain in A.
2. Disconnect during a run and reconnect after completion; expect history to recover, busy status to clear, and queued work to unblock.
3. Expand tool output and switch chats; expect content to remain reachable without a flash and the previous reading position to be preserved.
4. Repeat a small presentation edit and observe any slow request; expect focused work without repeated missing-file or bookkeeping loops, with timestamps and retry/wait status explaining delays.
5. Repeat a substantial feature change; expect the same relevant tests to remain in place while measuring fewer avoidable model steps.

## Evidence — Reported Baselines and Sources

### Source Reports

- [Full ArezaCode audit, evidence, coverage exclusions, and implementation order](file:///var/folders/tt/_33ntz395wbbs2flqd41ry_r0000gn/T/opencode/arezacode-audit-2026-09-23.md)
- [Detailed Mesto timing and optimization report](file:///var/folders/tt/_33ntz395wbbs2flqd41ry_r0000gn/T/opencode/mesto-chat-performance-2026-09-23.md)

The ArezaCode audit used four subagents. Application source was unchanged by the audit. Visual behavior, live-provider caching, and production performance were not verified; coverage exclusions are documented in the full report.

### Audit Verification Baseline

| Check | Reported result |
|---|---|
| Tests | 877 passed; 4 failed, all in localization |
| Package typechecks | Nine passed |
| Lint | Failed: 1 error and 5,045 warnings |
| Dependency audit | 274 advisory matches; application reachability unverified |

### Mesto Performance Baseline

Coverage: **131 user messages and 993 assistant records**, through **September 23, 2026, 17:12 UTC**. Measurements cover chat/model/tool requests, not Laravel SQL-query execution times.

| Metric | Recorded result | Interpretation or limit |
|---|---|---|
| Input-token cache reads | 94.6% | Caching already works heavily. |
| Largest reported context | 758,539 tokens per assistant record | Working context grew substantially. |
| Recognized checks | About 3 minutes within 11h38m of completed assistant intervals | Removing tests would save little and risk quality. |
| Standalone bookkeeping | 151 assistant steps executed only `todowrite`; 34.5 million cumulative input tokens | Administrative round trips are an optimization target; their entire duration is not necessarily removable. |
| Repeated failed discovery | Missing `.ai/rules/index.md` requested 35 times | Missing-path discovery was repeated unnecessarily. |
| Unexplained stall | 18m24s before the first stored response step | Records cannot distinguish provider waiting, transport, retries, local scheduling, or host suspension. |
| Headroom compression | 49 attempts; 1.01% overall reduction in accepted output | Benefit and transformation time need measurement. |
| Primary provider cost | Unknown despite stored zero values | Stored zeros are not evidence of zero billed cost. |

### Recorded Task Examples

| Request | Recorded duration | Assistant steps |
|---|---|---|
| Change sidebar heading from 11px to 13px | 10m11s | 9 |
| Add only a new-event button trigger | 15m15s | 17 |
| Participant-management feature work | 52m02s | 37 |

The first two requests already used **low reasoning effort**. Changing effort alone will not resolve the observed overhead.
