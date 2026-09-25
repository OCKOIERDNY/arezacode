# Mesto Chat Performance Audit

[Measurements](#measurements) · [Slow requests](#slow-requests) · [Findings](#findings) · [Improvement order](#improvement-order) · [Quality safeguards](#quality-safeguards) · [Evidence and limits](#evidence-and-limits) · [Manual checks](#manual-checks-unverified)

## Scope

This is an analysis of **ArezaCode's conversation, model requests, tool calls and recorded timings for `mesto-crm-laravel`**. Laravel endpoint latency, SQL execution plans, frontend frame rate and production database performance were not profiled.

- Main chat: `Laravel magic link review: validation, tests, UI`.
- Session: `ses_f3bf02cedffew6vzOdTLc64Rfk`.
- Project: `/Users/artiomsgibnev/Documents/Coding/Clients/Mesto/mesto-crm-laravel`.
- Database: `/Users/artiomsgibnev/.local/share/opencode/opencode-dev.db`, opened read-only with a consistent read transaction.
- Primary snapshot: **2026-09-23 17:12:48 UTC**. The session was still running; one assistant record was incomplete and its unfinished duration is excluded.
- Two additional Mesto sessions were found, but they contained no message records in the queried current/legacy transcript tables. No child sessions linked to the three roots were found.
- JEV/automation receipts were read through the existing `Jev.usage` owner, filtered to the snapshot time. Their files are a separate store and not part of the SQLite read transaction.
- Source semantics were checked against ArezaCode `afcea0103`. The exact installed revision/configuration used for every historical request is unknown.
- No application source, conversation records, credentials, project database records or running services were changed. No browser automation or live provider request was performed.

## Measurements

### Conversation and recorded usage

| Metric | Recorded value |
| --- | ---: |
| User message records | 131 |
| Assistant records | 993 |
| Completed assistant records | 992 |
| Summary assistant records | 4 |
| Sum of recorded inclusive input tokens | 241,365,740 |
| Cache-read input tokens | 228,318,144 |
| Uncached input tokens | 13,047,596 |
| Cache-read share of recorded input | **94.59%** |
| Output tokens including reasoning | 712,005 |
| Reasoning tokens included in that output | 333,092 |

The input total sums repeated model context across assistant records; it is not 241 million unique tokens of conversation. Assistant-record counts are not exact HTTP request counts. Retries can reuse a record and overwrite its latest token totals. Primary recorded costs were zero, which does not establish free execution or a billable dollar total.

### Where recorded elapsed time went

The union of completed assistant lifetimes is **41,894 seconds, approximately 11h38m14s**, across the September 21–23 conversation. Idle gaps outside those records are excluded. Overlapping intervals are counted once.

| Exclusive category | Seconds | Approximate duration | Share |
| --- | ---: | ---: | ---: |
| Question-tool intervals | 6,353.3 | 1h45m53s | 15.17% |
| Recognized checks | 180.1 | 3m00s | 0.43% |
| Other recorded tools | 343.2 | 5m43s | 0.82% |
| Remaining assistant lifetime | 35,017.3 | 9h43m37s | 83.59% |

**The remainder is not measured model compute.** It includes provider/transport waiting, local preparation, retries, scheduling and any unclassified intervals inside assistant lifetimes. The recorded reasoning spans separately total 14,139.1 seconds, approximately 3h55m39s; these are elapsed stream intervals, not processor time and not an extra amount to add to the table.

Check classification recognizes test, typecheck, lint/static, build and HTTP-check command patterns. Combined commands receive one category; this is a bounded classification, not a complete profiler of every process launched inside a shell.

### Model mix

| Model/effort | Records | Cache-read share | Median completed record | P90 completed record |
| --- | ---: | ---: | ---: | ---: |
| GPT-6 Astra high | 144 | 96.02% | 20.3s | 110.0s |
| GPT-6 Astra low | 340 | 93.57% | 14.4s | 56.6s |
| GPT-6 Astra medium | 495, one incomplete | 94.99% | 22.3s | 101.3s |
| MiMo V2.6 Flash free | 13 | 31.81% | 5.8s | 29.9s |
| Nemotron 3.5 Lightning free | 1 | No usage recorded | 1.7s | 1.7s |

These cohorts contain different task complexities and context sizes. They do not establish a causal quality/speed comparison between models or effort levels.

### Context growth

Completed assistant records by UTC day:

| Day | Records | Mean inclusive input | Largest recorded input |
| --- | ---: | ---: | ---: |
| September 21 | 187 | 192,550 tokens | 289,690 tokens |
| September 22 | 512 | 158,860 tokens | 390,695 tokens |
| September 23 through the snapshot | 293 | 423,285 tokens | **758,539 tokens** |

Caching is already heavily used. A high cache ratio does not make an extremely large repeatedly processed context free or establish low latency. The next optimization should target request count and the useful working set, while measuring actual provider behavior.

## Slow requests

Prompt excerpts remain verbatim. Durations are from the parent user record to the latest recorded assistant completion, not an independent network trace.

| Turn | User request | Effort | Assistant records | Elapsed | Recognized checks |
| --- | --- | --- | ---: | ---: | ---: |
| 16 | “make sidebar content header 13px not 11px font size” | low | 9 | **10m11s** | 9.6s |
| 24 | “add another button to create a new event to the left of the profile icon in sidebar header For now just add the trigger” | low | 17 | **15m15s** | 2.0s |
| 2 | “fix all of this” | high | 42 | **35m43s** | 15.5s |
| 121 | “ok start adding P1 Participant management…” | high | 37 | **52m02s** | 19.4s |
| 130 | “did you lag out?” | medium | 20 | **61m07s** | 9.6s |

Turn 130 continued existing implementation work, so its entire hour must not be characterized as time spent merely answering a status question. It nevertheless documents an extremely slow continuation.

Waiting also materially changes some displayed durations: the turn starting “add those routes keep empty for now just create them in sidebar” lasted **37m18s**, including **32m59.7s inside a question tool**. A different failed/aborted question occupied **35m18s**. Those portions are not test execution or model generation.

## Findings

### 1. Long stalls are real, but their cause is not observable enough

One assistant record, `msg_0cf0dc8b0001KwPf6tEGxIEo4l`, was created at **16:16:22 UTC** and has its first stored step-start at **16:34:45 UTC**: **1,103.7 seconds, or 18m23.7s**, before the first stored response step. It completed at 16:35:14 with 706,059 inclusive input tokens and 603 recorded reasoning tokens.

Another record has step-starts at 17:44:46 and 17:57:47 on September 21, with an unfinished intervening reasoning block. Six records in the inspected cohort have multiple step-starts. This is consistent with repeated attempts but does not identify their reasons or exact count.

**Improvement:** persist attempt IDs and phase times for preparation, dispatch, headers, first chunk, last chunk, finish, retry reason and backoff. Surface a stalled/retrying state rather than an undifferentiated busy indicator. Make recovery conditional on whether provider output or tool side effects may already exist.

**Owners:** `packages/opencode/src/session/llm.ts:95–113,280–353`, `provider/provider.ts:1798–1828`, `session/processor.ts:649–690`, `session/retry.ts:183–203`.

**Quality safeguard:** do not blindly replay an ambiguous request, discard partial output, shorten all reasoning, or retry completed side effects. Current timeout configuration is not proof of which timeout occurred historically.

### 2. Administrative-only model turns are a substantial request-count target

There are **151 assistant records whose only executed tool was `todowrite`**. Together their records carry **34,535,104 inclusive input tokens** and **6,403.3 seconds, or 1h46m43s, of assistant-lifetime elapsed time**. The actual `todowrite` calls across the chat total approximately **2 seconds**.

This does not prove all of those assistant lifetimes are removable: planning, retries or necessary reasoning may occur in the same record. It does establish that metadata maintenance repeatedly triggers full-context model round trips.

The simple font-size turn alone contains four todo calls, three reads, one patch and six shell calls. It was already routed to low effort. Lowering effort alone will not remove these interaction costs.

**Improvement:** avoid standalone planning/status-update rounds for narrow edits. Co-issue independent reads and bookkeeping where safe; derive deterministic progress updates from actual tool/check receipts. Retain model-authored planning where the task genuinely needs it.

**Quality safeguard:** never mark a check or task complete before its result is known. Preserve the visible to-do list and user-requested plans. The existing four-turn Quick Edit checkpoint should trigger scope/stall diagnosis, not force premature completion.

### 3. Keep the working context bounded without losing ongoing work

By September 23, mean recorded input was **423k tokens**, with a maximum of **758.5k**. Several small corrections repeatedly process hundreds of thousands of context tokens even with cache hits.

**Improvement:** at safe task/phase boundaries, keep the current objective, constraints, unfinished changes, affected files, test receipts and unknown outcomes in a compact working checkpoint; retain full history and managed outputs for retrieval. Preserve same-task follow-ups instead of restarting the whole investigation.

**Quality safeguard:** validate checkpoint completeness before using it, retain source references and security requirements, and keep recent tool evidence lossless. The broader audit's compaction-integrity findings should be addressed before more aggressive automatic compaction. This chat used legacy transcript records; current-Core compaction findings cannot automatically be attributed to its historical runtime.

### 4. Repeated failed discovery is demonstrably wasteful; repeated checks require input-aware evidence

The same missing `.ai/rules/index.md` was read **35 times**, all returning file-not-found. The project instructions explicitly permit continuing when `.ai/rules` is absent (`mesto-crm-laravel/AGENTS.md:75`, repeated in `CLAUDE.md:75`).

Other repeated requests include the same typecheck input **38 times across 36 turns**, the same build input **24 times**, `package.json` reads **10 times**, and one `info-card.tsx` read request **11 times**.

**Improvement:** remember nonexistent instruction paths for the current workspace/revision and invalidate that knowledge when files appear. Reuse file excerpts by content hash and source range. Reuse check results only when source, dependencies, configuration and execution options match their receipt.

**Quality safeguard:** repeated command text does not establish an unnecessary check. Files changed between many turns, so suppressing all repeated builds/typechecks would be incorrect. Prefer bundling necessary checks into one execution and one result review rather than removing them.

### 5. Measure compression return before spending work on every output

The snapshot has **49 Headroom receipts** covering **908,654 input characters** and **899,474 accepted output characters**: **9,180 characters, or 1.01%, net reduction** across recorded attempts. Only **one receipt was a cache reuse**. Rejected/unchanged compression is recorded with original length, so these totals include attempts that produced no accepted reduction.

The timing receipts cannot establish Headroom's CPU/elapsed cost: `packages/core/src/jev.ts:38–45` records creation and completion together after the operation. Compression itself can spawn a Python environment (`automatic-checks.ts:238–271`).

**Improvement:** record real transformation duration; cache no-benefit decisions by content/tool/settings identity, not just successful compression. Skip known low-yield transformations until inputs change, while keeping full originals and retrieval references.

**Quality safeguard:** no additional lossy truncation solely to improve a token metric. Measure avoided downstream tokens, latency and retrieval/rework costs together.

### JEV is measurable, but not the dominant elapsed-time bucket here

The snapshot contains **499 JEV records**, **771,212 input tokens**, **31,558 output tokens**, and approximately **317.2 seconds of cumulative recorded duration**. Recorded JEV cost totals about **$0.04025**, with two records missing a cost. This is JEV-only reporting, not the cost of the main chat.

| Purpose | Recorded calls | Cumulative seconds |
| --- | ---: | ---: |
| Context selection | 345 | 208.4 |
| Routing, scope and skills | 104 | 75.6 |
| Skill selection | 26 | 17.6 |
| Older/unclassified receipts | 24 | 15.6 |

These timings can overlap assistant lifetimes and must not be added to the exclusive timing table. Removing JEV wholesale is not supported by these measurements. Reuse identical decisions and evaluate its downstream benefit, especially the many context-selection calls.

## Improvement order

1. **Make stalls diagnosable and recoverable:** per-attempt phase/retry records, visible elapsed categories and safe recovery. Investigate the 18-minute pre-stored-step case without guessing its cause.
2. **Reduce avoidable round trips:** missing-path caching, no standalone todo loops for tiny edits, parallel independent lookups and one combined check receipt.
3. **Reduce unnecessary context growth:** quality-checked task checkpoints, bounded retrieval and reuse of already established evidence.
4. **Tune effort and compression from measured outcomes:** keep low effort for localized work and stronger reasoning for security/cross-cutting changes; measure no-op compression and JEV reuse before changing defaults.

No savings percentage is promised. Representative before/after tasks should include a font/spacing edit, an interaction bug and a participant-management/security change, rather than comparing unlike historical tasks.

## Quality safeguards

- Preserve meaningful tests. Recorded checks occupy only **0.43%** of completed assistant-lifetime intervals; removing them is a poor primary speed strategy.
- Keep required security, authorization, concurrency, migration and type checks for the affected behavior. Do not infer correctness from a zero process exit alone.
- Preserve unsent drafts, partial work, tool receipts and ambiguous outcomes across cancellation/retry.
- Keep manual browser refusal explicit and inherited by subagents. Visual checks remain manual; no automation was launched for this analysis.
- Compare completion quality, regressions, retries and rework alongside elapsed time and tokens. Fast incomplete work is not an improvement.

## Evidence and limits

### Sources

- Read-only SQLite transcript and part tables in `opencode-dev.db`.
- JEV receipts under the session's hashed directory, read using the existing application service.
- Analysis script: `/var/folders/tt/_33ntz395wbbs2flqd41ry_r0000gn/T/opencode/mesto-chat-audit.ts`.
- Full sanitized measurement output: `/Users/artiomsgibnev/.local/share/opencode/tool-output/tool_0cf417be3001r6RACDPKRqMt73`.
- Selected stored-part timing evidence: `/Users/artiomsgibnev/.local/share/opencode/tool-output/tool_0cf430f5b001rDrCRx18FrJ6hb`.
- A bounded source reviewer checked legacy processor/retry/accounting semantics independently of the main database analysis.

### Timing semantics

`executionTiming` at `packages/app/src/components/session/session-context-metrics.ts:47–65` assigns overlaps by category priority. This analysis reused that implementation and supplied merged completed-assistant windows plus tool spans. It labels the residual explicitly rather than claiming model compute.

Legacy assistant creation precedes local preparation; completion follows cleanup (`packages/opencode/src/session/prompt.ts:1187–1275`; `session/processor.ts:553–610,649–690`). A stored step-start is processed after stream activity begins, not at dispatch. Reasoning boundaries are local timestamps and may include stalls or synthesized ends (`processor.ts:207–213,280–312,435–437,576–583`). Retry status is not durably attached to attempts (`session/status.ts:26–47`). Tokens are overwritten at step settlement while costs accumulate (`processor.ts:452–470`).

Accordingly, provider queueing, actual inference compute, transport stalls, local scheduling and host suspension cannot be reliably separated from this transcript alone. The 18-minute gap is demonstrated; its cause remains unknown.

### Tool outcomes

The snapshot has 599 Read calls, 303 Bash calls, 228 Apply Patch calls, 153 Todo writes, 80 Grep calls, 54 Glob calls, 29 Question calls, 29 historical Browser calls, 26 Skill calls, 10 Webfetch calls and four Edit calls.

Historical browser calls were inspected as records only; none were rerun. Ten had error status. Read had 40 errors, of which 35 were the same missing instruction file. Bash tool status was completed for all 303 calls, but process metadata distinguishes **285 exit-zero and 18 nonzero exits**. Thus completed tool status must not be interpreted as a passing command.

The command categories include 89 test-related invocations, 61 typechecks, 11 lint/static checks and 28 build-classified invocations. Those counts are classifications of shell commands, not independent test-case counts. Some commands combine operations.

### Coverage limits

The conversation remained active during inspection; later work is outside the primary snapshot. The SQL query and receipt store do not create a shared historical transaction. No transport-level request log, provider billing export or Laravel SQL profiler was examined. No claims are made about exact request count, monetary cost of the main provider, production FPS, database bottlenecks or measured before/after savings.

## Manual checks — unverified

1. Repeat a narrow presentation edit in the updated app. Expected: a focused owner lookup, patch and applicable check receipt, with no repeated missing-file discovery or independent bookkeeping loop.
2. Observe a deliberately slow request without resubmitting it. Expected after instrumentation: distinct preparing, waiting/streaming, retrying and tool phases; safe cancellation preserves unfinished work.
3. Compare a representative participant-management change before and after optimization. Expected: the same relevant authorization, validation, concurrency and regression checks pass, with fewer avoidable model round trips and a smaller useful context.
