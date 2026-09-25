# Mesto Chat Offline Measurement Addendum

## Scope and source window

This addendum extends [`mesto-chat-performance-2026-09-23.md`](./mesto-chat-performance-2026-09-23.md), not its historical window. It uses a local read-only session database snapshot captured at **2026-09-23 17:12:48.088 UTC**. The primary window is September 21–23 through that snapshot; one incomplete assistant record is excluded from elapsed-time totals. The source database and extracted session data are local and are not included in the repository.

No live provider, production service, or browser was accessed. The local database was queried read-only by a temporary analytics script that enabled SQLite `query_only` and wrapped transcript reads in a transaction. That script and the extracted session data are not checked in, so the historical dataset-specific metrics cannot be independently reproduced from this report alone. Provider replay tests read checked-in cassettes by default.

## Additional reproducible metrics

| Metric                                           |                                        Value | Definition / limitation                                                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Response-reported cache-read share               |                                   **94.59%** | `228,318,144 / 241,365,740` input tokens. Denominator is recorded uncached input + cache-read + cache-write tokens. Cache write is zero in the aggregate here; it is not inferred from a cache-hit policy. |
| Assistant records / provider-turn proxy          |                                      **993** | 992 completed and 1 incomplete at snapshot. These records are not exact HTTP attempts: retries can reuse/overwrite a record.                                                                               |
| Completed assistant-record lifetimes, cumulative |               **41,894 seconds** (11h38m14s) | Sum of each completed assistant's created-to-completed interval; unlike the prior report's 41,894-second union, this is a sum and can double-count overlap.                                                |
| Completed assistant-record lifetimes, union      |               **41,894 seconds** (11h38m14s) | Union-based result already in the primary report. In this snapshot the rounded sum matches the union; timestamps still define message lifetime, not provider compute.                                      |
| Recorded primary assistant cost                  |                           **$0.00 reported** | Transcript cost field is recorded as zero; this does not establish free service or actual bill.                                                                                                            |
| Primary assistant cost known vs unknown          |             **Unknown actual billed amount** | A numeric zero stored in the product transcript is not an invoice. Provider billing export / invoice is required for billed cost.                                                                          |
| JEV auxiliary receipts                           | **$0.04024629 reported; 2/499 without cost** | Existing report's recorded auxiliary cost; not main-chat provider cost. Missing receipt costs remain unknown.                                                                                              |
| Steps per user turn                              |                                   **Varies** | Saved snapshot has per-turn `steps`; 131 turns. Highest: turn 2, 42 steps; turn 121, 37; turn 5, 35. This is assistant-record count under a parent user record, not an attempt count.                      |

The apparent equality between lifetime sum and lifetime union is only to the precision saved (0.1 seconds in the source output); raw records may overlap by sub-rounding amounts. `assistantOtherSeconds` / residual elapsed time is not equivalent to model compute.

## Recorded cache fixtures and replay

Three checked-in two-interaction recordings demonstrate cache usage reported in provider response payloads:

| Fixture                                                                                                                        | Recorded evidence                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/llm/test/fixtures/recordings/anthropic-messages-cache/writes-then-reads-cache-control-on-identical-second-call.json` | First interaction: `cache_creation_input_tokens: 5752`, cache read `0`. Second: cache read `5752`, cache creation `0`.                                                     |
| `packages/llm/test/fixtures/recordings/openai-responses-cache/reports-cached-tokens-on-identical-second-call.json`             | Two ordered identical requests; recorded test asserts the second response has nonzero `cacheReadInputTokens`.                                                              |
| `packages/llm/test/fixtures/recordings/gemini-cache/reports-cachedcontenttokencount-on-identical-second-call.json`             | Second response reports `cachedContentTokenCount: 1100` of `promptTokenCount: 1200` (91.67% of that reported prompt count). First interaction has no cached-content count. |

Local replay command, run in `packages/llm`:

```sh
bun test --timeout 30000 test/provider/openai-responses-cache.recorded.test.ts test/provider/anthropic-messages-cache.recorded.test.ts test/provider/gemini-cache.recorded.test.ts
```

Result: **3 passed, 0 failed; 6 expectations**. No `RECORD=true` was used; this was fixture replay, not a provider request. Fixture ratios and values are independent test examples, not measurements of the Mesto conversation's provider cache.

## Reproduction commands

The historical output recorded 993 assistant records at the snapshot. The database and temporary analysis script are unavailable to other contributors, so this section records evidence and limitations rather than a portable reproduction command. Re-running against a later local database would require pinning the same source records and as-of time before comparing results.

## Evidence still required

- Provider billing export or invoice for actual Mesto-session dollar cost and any credits, discounts, retries, or intermediary charges.
- Provider-side request/attempt IDs and transport logs to convert assistant records into exact HTTP calls, distinguish retries, and attribute provider latency.
- Historically effective model price catalog/config for request-level estimates; the installed revision/config for every historical request is not known.
- Provider-side cache accounting if validating billing/cache discount rather than the response-reported token counts stored by the app.

No before/after performance or cost savings can be concluded from these offline transcript and fixture measurements.
