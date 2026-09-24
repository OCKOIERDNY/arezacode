# Jev Model Efficiency Evidence

Retrieved September 24, 2026. Source: Artificial Analysis, Intelligence Index v4.3.2. All three published evaluations below use **max reasoning effort**.

| Model | Intelligence Index | Full-index output tokens | Cost per weighted index task | Input / output USD per million tokens | Output tokens/s | Time to first token |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [Luna](https://artificialanalysis.ai/models/gpt-6-luna) | 37 | 150M | $0.07 | $0.10 / $0.50 | 141.4 | 106.86s |
| [Sol](https://artificialanalysis.ai/models/gpt-6-sol) | 48 | 77M | $1.06 | $2 / $10 | 115.9 | 136.12s |
| [Astra](https://artificialanalysis.ai/models/gpt-6-astra) | 53 | 60M | $3.26 | $10 / $50 | 52.5 | 352.15s |
| Terra | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |

Terra's model and release URLs returned 404. BridgeBench's `.ai` URLs returned 403; `.com` showed a launching-soon page. The user approved proceeding with available Artificial Analysis evidence.

## Interpretation

- Luna has the lowest published dollar cost here, but uses the most output tokens. Cheap is not the same as token-efficient.
- Astra uses the fewest output tokens and has the highest aggregate intelligence score here, with higher cost and latency.
- Sol lies between Luna and Astra on the reported intelligence, token volume, and cost metrics.
- These are published aggregate benchmark measurements, not measured ArezaCode performance, coding-task success rates, or low/medium/high-effort scores. Full-index token totals and per-task costs have different denominators.
- Provider catalog prices take precedence for an actual route. Unknown or unreported billing stays unknown. No live paid comparison or new production speed/cost measurement was performed.

## Routing Policy

Jev receives the source URL, retrieval date, evaluated effort, quality index, token use, task cost, throughput, and latency alongside each available candidate's actual catalog capabilities and prices. Models absent from the evidence retain unknown benchmark statistics.

Main and delegated routing consider the complete user-allowed candidate set instead of silently forcing Astra. The decision chooses the lowest-total-cost suitable candidate, keeping task quality and risk first. Bounded discovery, reading, and check-result triage favor economical candidates; ambiguous or high-risk work calls for stronger reasoning. These task mappings are routing heuristics, not benchmark-proven per-task outcomes.

Delegation starts with the supplied task-specific prompt, not a copy of parent conversation history, and requests concise evidence, file/line references, actual checks, and uncertainties. Explicit tool-level or configured subagent model/effort overrides bypass automatic routing. Existing session-tree usage records continue accounting for actual execution and routing overhead separately from published benchmark estimates.
