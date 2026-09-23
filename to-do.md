# To-do

Consolidated feature, bug, and optimization backlog. Audit baseline: September 23, 2026.

## How to Use This Backlog

- Unchecked items are pending work, not verified fixes. Audit findings and measurements below are reported evidence, not independently reverified during consolidation.
- Address the explicitly marked P1 bugs first, then the P2 attachment bug. Other items are grouped by owner/area without an assigned severity.
- Inspect the existing implementation before changing it, reuse shared owners, and verify the affected behavior. Historical file/line references may have moved.
- Measure optimization results against the baseline below; preserve relevant checks and output quality rather than assuming fewer tokens or cheaper models guarantee savings.

## Features — Chat UI and File Previews

- [ ] Allow clicking a subagent to view its current activity and progress.
- [ ] Add an elapsed-time counter for each message.
- [ ] Open an in-app file preview when clicking blue file references in chat (for example, `to-do.md`).
  - For Markdown files, provide two tabs: **Preview** for rendered Markdown and **Code** for the raw Markdown source.

## Features — Context and Usage Dashboard

- [ ] Redesign the Context details page as one compact, understandable dashboard. The current page is excessively long and confusing, with repeated provider-attempt groups and original-prompt/request lists obscuring useful information.
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

- [ ] **P1 — Align the app's V2 client with the current server.** The vendored client disagrees with server prompt payloads and catalog routes; the wire mismatch was reproduced.
  - Evidence: `packages/app/package.json:59`, `packages/protocol/src/groups/session.ts:215`.
  - Expected: the app uses compatible prompt payloads and catalog routes through the shared API client owner.
- [ ] **P1 — Enforce external-directory authorization in Core search.** Grep and glob can access paths that Read would require permission to access.
  - Evidence: `packages/core/src/tool/grep.ts:112`, `packages/core/src/tool/glob.ts:62`.
  - Expected: external-directory searches honor the same authorization boundary as Read.
- [ ] **P1 — Reject truncated compaction summaries.** Incomplete summaries can replace the model's working history; reproduced with a scripted stream.
  - Evidence: `packages/core/src/session/compaction.ts:199`.
  - Expected: an incomplete summary cannot replace valid working history.
- [ ] **P1 — Reconcile existing V2 sessions after reconnecting.** Status/history can remain stale, leaving finished sessions busy and incomplete and blocking queued work.
  - Evidence: `packages/app/src/context/server-sync.tsx:547`.
  - Expected: reconnect restores history and current status, clears completed runs' busy state, and unblocks queued work.
- [ ] Ensure native processes terminate after cancellation; investigate processes that continue running after their owning operation is cancelled.

### Composer, Attachments, and Chat Layout

- [ ] **P2 — Keep pending attachments in their originating chat.** Switching chats during processing changes the attachment target; reproduced.
  - Evidence: `packages/session-ui/src/v2/components/prompt-input/interaction.ts:88`.
  - Expected: starting an attachment in A and switching to B never attaches it to B.
- [ ] Fix queued images breaking after reload; queued image inputs must remain usable when the session is restored.
- [ ] Preserve resource identity when serializing MCP mentions so mentions continue to refer to the intended resource.
- [ ] Preserve each project's unsent new-chat draft when navigating away or clicking New Chat for that project again, instead of clearing the typed text.
- [ ] Fix the plan panel's scrollbar overflowing over the chat; keep it contained within the plan panel.
- [ ] Make resizing accessible by keyboard, including Home's resize controls.

## Features — Task Context

- [ ] Add an "Independent tasks" switch next to the Browser control in chat:
  - Click to turn on or off, like the Jev and Browser controls; the user controls isolation explicitly rather than Jev detecting task boundaries.
  - Off: use normal shared conversation context, accumulating up to 250k tokens before closing the chat.
  - On: keep the same visible chat window, but start a fresh underlying chat for each submitted message without sharing previous tasks' conversation context, so small tasks do not require manually creating new chats.
  - Switching from on to off: continue the latest underlying chat with shared context for subsequent messages, so the user can follow up on the latest task without starting over or importing earlier isolated tasks.

## Jev — Status, Model Selection, and Delegation

### Status and Draft Bugs

- [ ] Fix the status label under a sent message remaining stuck on "Jev is selecting a model" after Jev has selected the model.
- [ ] Preserve the active draft when Stop is pressed during Jev preparation instead of losing the user's input.

### Model Routing and Efficiency

- [ ] Review Jev's model and reasoning-effort selection by task complexity; simple tasks such as adding an item to a Markdown file should use low rather than medium effort.
- [ ] Evaluate token-usage efficiency by task type across newer ChatGPT models, including Luna, Terra, and Sol, compared with Astra; update Jev's model selection to use the most token-efficient suitable model based on measured results and output quality.
- [ ] Add cost-aware delegation in Jev: route bounded discovery, reading, and routine check-result triage to cheaper subagent models with minimal task-specific context; return concise evidence with file/line references and uncertainties to the orchestrator.
  - Have Jev automatically select the model and reasoning effort for each read-only subagent based on task complexity, required capabilities, and measured cost/quality; honor explicit user model overrides.
  - Use direct tools for trivial lookups and deterministic checks when delegation would add overhead.
  - Keep cross-cutting reasoning and high-risk review with a capable model; escalate ambiguous results and verify decision-critical evidence without repeating all delegated reading.
  - Measure total cost, tokens, latency, and quality including delegation overhead and retries; cheaper models do not automatically mean fewer tokens or lower total cost.
- [ ] Reuse identical Jev context decisions rather than repeating auxiliary model work when the decision inputs are unchanged.

## Performance — Context, Latency, Caching, and Cost

### Request Latency and Avoidable Model Work

- [ ] Instrument request dispatch, first response, retry reason, and backoff; recover stalls safely while preserving partial output and avoiding repeated completed actions.
  - Evidence: one Mesto record waited 18m24s before its first stored response step; existing records cannot identify the source of that wait.
- [ ] Reduce administrative model round trips by batching independent lookups and deriving deterministic progress updates from actual tool results.
  - Evidence: 151 assistant steps only executed `todowrite`, carrying 34.5 million cumulative input tokens. Their entire duration is not necessarily removable.
- [ ] Apply cheap deterministic output checks before auxiliary AI work; avoid model calls when deterministic checks can resolve the operation.
- [ ] Bound Home's data loading instead of scanning the server's entire session history before displaying a small list.

### Working Context and Reuse

- [ ] Reduce working context with validated checkpoints that preserve constraints, unfinished work, and test evidence, while keeping full history available for retrieval.
  - Evidence: Mesto context grew to 758,539 tokens per assistant record. Coordinate with the compaction correctness fix before relying on summaries.
- [ ] Add content-aware reuse for missing-path discovery and unchanged file excerpts; reuse check results only when their actual inputs remain unchanged.
  - Evidence: the missing `.ai/rules/index.md` was requested 35 times.
- [ ] Replace repeated unchanged preference instructions in every prompt with session-owned context updates when preferences change.
- [ ] Measure compression benefit and transformation time, and cache no-benefit results.
  - Evidence: 49 Headroom attempts reduced accepted output by only 1.01% overall.

### Provider Caching and Usage Accounting

- [ ] Include compaction tokens, cache usage, and costs in session totals; these calls currently disappear from totals.
- [ ] Fix OpenRouter cache hints lost in multimodal and certain assistant/tool placements.
- [ ] Verify live-provider cache behavior and record actual billed costs; stored zero values do not establish zero primary-provider cost.
- [ ] Measure production performance and before/after optimization results while preserving relevant test coverage. Actual speedups and billed savings remain unmeasured.

## Maintainability — Consolidate Shared Owners

These tasks support the corresponding fixes above; extend existing implementations instead of creating parallel owners.

- [ ] Consolidate vendored, workspace-generated, and handwritten API calls; coordinate with the P1 V2 client/server compatibility fix.
- [ ] Consolidate V1/V2 composer mention serialization and attachment capture; preserve resource identity and originating-chat ownership.
- [ ] Centralize provider cache-placement, TTL, and marker-limit rules; coordinate with OpenRouter cache-hint fixes.
- [ ] Consolidate current and legacy output-processing and automation policies, including deterministic checks before auxiliary AI work.
- [ ] Share resize-handle behavior with Home's separate keyboard implementation; coordinate with keyboard accessibility fixes.

## Verification and Audit Follow-Up

- [ ] Investigate the four localization test failures reported by the audit.
- [ ] Resolve the reported lint error and triage warnings.
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
