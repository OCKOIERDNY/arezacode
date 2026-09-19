# ArezaCode feature and implementation plan

## Repo Map — historical description

Repo Map was a separate local Bun/TypeScript project that indexed repositories and added a review workflow around coding-agent changes. It was not the ArezaCode chat engine. This description is retained for reference; the standalone project and its integrations were removed at the user's request on 2026-09-19.

### What it did

- **Repository inventory:** recorded file paths, file kinds, sizes, roles, descriptions, parser coverage, symbols, and static references. It distinguished source files from dependencies and generated output where its classification rules recognized them.
- **Dependency and reuse discovery:** resolved supported imports, listed consumers of files and components, and grouped files into features. Queries helped locate existing implementations before adding another one.
- **Duplicate candidates:** reported identical files and structurally similar code as review candidates. A match did not establish that deleting or merging those files was correct.
- **Development tooling discovery:** inspected package manifests, scripts, and lint configuration without executing repository configuration during indexing.
- **Project profiles:** stored command IDs, command arguments, working directories, timeouts, required checks, ownership rules, boundaries, documentation requirements, and simplification settings.
- **Task preflight and checks:** captured a repository revision and scoped subtasks, associated functionality with implementation and test paths, ran configured commands, and recorded results. Final checks could flag stale results, edits outside scope, broad rewrites, or missing configuration.
- **File review:** queued proposed new files with their exact path, purpose, content, and hash. Its browser interface let a person approve selected files. Existing-file edits used hashes and exact snippets to reject stale changes.
- **History and evidence:** retained repository snapshots/history, task records, edit baselines, command receipts, and reported usage in its own storage. These records were separate from ArezaCode's session history.
- **Agent integrations:** exposed CLI and MCP tools. Codex hooks injected project context at session/prompt boundaries and intercepted supported file-edit tools. A launch agent kept the local browser interface and repository watcher running.

### Former installation

| Item | Former location |
| --- | --- |
| Standalone project | `/Users/artiomsgibnev/Documents/Coding/my/repo-map` |
| Indexes, profiles, workflow database, history, logs and UI cache | `~/Library/Application Support/RepoMap` |
| Background service | `~/Library/LaunchAgents/local.repo-map.plist` |
| Browser interface | `http://127.0.0.1:47731/` |
| CLI launcher | `~/.local/bin/repo-map` |
| Codex skill | `~/.codex/skills/repo-map` |
| Codex integration | `mcp_servers.repo-map` in `~/.codex/config.toml`; Repo Map commands in `~/.codex/hooks.json` |

### Limits and ideas worth retaining

Static links could miss dynamic imports, runtime wiring, framework conventions, and unsupported languages. Sensitive files and unsupported content had limited or metadata-only coverage. No observed consumers did not prove a file was unused. A successful command exit did not prove that meaningful tests ran. Hook interception covered supported tool paths; it was not a filesystem sandbox and could not enforce every shell or external writer.

Useful ideas to revisit independently are a searchable file/dependency index, explicit check commands with their working directories, readable task/check receipts, and human review of exact proposed changes. They do not require restoring Repo Map's mandatory hooks or file-approval workflow.

Any JSON files already saved under `docs/repo-map-export/` are partial historical exports, not a complete backup. Uncreated proposals and the remaining standalone data are intentionally discarded during removal. The implementation plan below predates removal; references to the former Repo Map source are historical pointers, not available source files or installed dependencies.

[Delivery order](#delivery-order--smallest-slices-to-largest-systems) · [Feature requirements](#repository-understanding) · [Findings](#consolidated-findings-and-release-gates) · [Verification](#verification-receipt) · [Sources](#source-evidence)

47 planned features. Checkboxes mark completion requirements; implementation notes describe proposed work.

Order: smallest testable increment first, respecting dependencies. XS = existing-path extension; S = adapter/view; M = persistence or cross-layer work; L = protected acceptance or durable tasks; XL = multiple runtimes/frameworks. Size is an estimate. Complete all requirements before marking a feature done.

## G0 — prerequisites

1. Reuse upstream IDs; define server/project/workspace/task/candidate identities. Migrate Repo Map's path-hashed registration and root-bound history when repositories move.
2. Prove the macOS runtime: bundled Bun worker or tested SQLite adapter for Repo Map's `bun:sqlite`. Verify other platforms separately.
3. Isolation spike: in 15 minutes, test allowed candidate writes and denied accepted-file/Git-metadata writes, including shell children. Retain the adapter if the proof passes; otherwise revert it and revise the boundary.
4. Capture UI screenshots, keyboard behavior and production-build performance baselines; select existing UI components and state owners.
5. Start with Bun, TypeScript, SolidJS, Effect/Schema, Oxlint and existing runners. Define commands, working directories, result schemas, required checks and capabilities.

## Ownership

Use existing packages; these are domain responsibilities.

| Area | Features | Owner |
| --- | --- | --- |
| Repository | F01–F11 | One revisioned index shared by UI and tools; F08 owns durable file history. |
| Tasks | F14–F19, F29, F38–F40, F43–F44 | Session events plus task/queue/operation records; views query those records. |
| Acceptance | F20–F25, F33–F37 | One versioned profile, check-result contract and trusted acceptance owner. |
| Tools and docs | F12–F13, F26–F28, F30–F32, F41–F42, F46 | Canonical tools, one documentation contract and shared engine lifecycle. |
| Providers | F45, F47 | Existing provider/account owners; separate gateway and official-client adapters. |

F19 projects F38 events. F14–F17/F29 share invocation evidence. F22/F25/F33 share policy. F23/F31/F32 share catalog/recipe contracts. F12/F46 share source records. Session snapshots and Entire checkpoints do not replace F08.

## Data and runtime contracts

| Record | Required identity/data | Storage rule |
| --- | --- | --- |
| Index | Project/workspace, source hash, parser/config version, index revision, span, evidence kind | Rebuildable; invalidate affected edges and reconcile. |
| File revision/blob | Stable project/workspace, revision/previous IDs, captured path, hash, coverage | Durable; define retention/deletion/GC and preserve pinned evidence. |
| Task/input/operation | Task/session/project IDs, message revision, attempt/idempotency IDs, pre/post state, status | Persist before acknowledgement/mutation; revision-checked claims; reconcile crashes. |
| Candidate/check receipt | Candidate/base hashes, task/config/dependency/environment/rule/tool versions, check/artifact IDs | Store outside candidate authority; changed inputs invalidate receipts. |
| Tool/docs/context artifact | Producer version, arguments, source/freshness, scope, completeness, expiry, original reference | Cache reads only; exclude credentials; retain retrievable originals. |

Proposed Core modules: `repo-index.ts`, `file-history.ts`, `task.ts`, `checks.ts`, `acceptance.ts`, `documentation.ts`, `workflow.ts`. Add them only as needed. The trusted controller loads code outside candidate write authority.

Schema owns browser-safe contracts; Core/Protocol depend on Schema; Server composes them; Client runtime depends on Schema/Protocol; sdk-next composes runtime services. Keep filesystem/services out of Schema and Core/Server out of Client runtime. Use unversioned new public contracts and adapt current events explicitly for legacy app views. [E13], [E16]

## OpenCode implementation rules

- One canonical tool and output-settlement boundary; leaves own permissions and side effects. Preserve typed errors, defects and cancellation. [E04]
- One provider stream call per turn. Schedule tasks above Session; retain current execution semantics and reconcile before crash continuation. [E06]
- Bun APIs, inferred types, immutable values, early returns, lazy heavy imports and minimal helpers. No inline comments, import aliases/star imports or unrelated reformatting. [E13]
- Generate clients from changed contracts with `bun run generate` in `packages/client`; never edit generated files. Run focused tests and `bun typecheck` from package directories. [E16]
- Focused PRs, conventional titles and verification evidence; follow upstream contribution requirements when submitting upstream. [W01]

## UI implementation contract

Use existing SolidJS/Kobalte primitives and themes; keep legacy/V2 component boundaries consistent. [E11]

| Surface | Reuse | Placement |
| --- | --- | --- |
| Files/architecture | FileTreeV2, SessionFileBrowserTab, source/search | Virtualized tree and selected-file details. |
| Changes/history | ReviewPanelV2, SessionReviewV2, saved-source diffs | Revision controls in the existing review pane. |
| Task/context | Session context/usage and timeline | Queue, activity, usage and source drill-down. |
| Dependencies/checks | Settings/list/row controls | Project tables, Run check and evidence links. |
| Tools/providers | Settings/dialog patterns | Availability, versions, sources, storage and accounts. |

Package ownership: primitives/styles in UI; session presentation in session-ui; navigation/data in app; native operations in desktop. Use semantic charcoal/cream/muted-blue tokens, existing control states and typed translations for visible text/labels.

Use one store for related local state and existing server-query caching. Key queries by server/project/workspace/revision; reject stale responses; keep draft updates synchronous; dispose requests/observers; preserve scroll/selection.

Verify actual UI screenshots, loading/empty/stale/error states, keyboard/focus and behavior tests. Happy DOM tests do not verify rendering. Run production-build benchmarks serially; no machine-dependent timing gates. [E14]

## Delivery order — smallest slices to largest systems


### XS — Existing foundations

| Order | Feature | Start after | First useful slice |
| --- | --- | --- | --- |
| 1 | [F37](#37-minimum-necessary-implementation) — Minimum necessary implementation | G0 | Apply reuse-first, minimal-change development rules. |
| 2 | [F28](#28-compact-results-and-valid-caching) — Compact results and valid caching | G0 | Expose bounded output and retrievable originals. |
| 3 | [F40](#40-targeted-revision-aware-edits) — Targeted, revision-aware edits | G0 | Reuse exact edits with stale-source rejection and compact diffs. |
| 4 | [F16](#16-token-and-context-accounting) — Token and context accounting | G0 | Show reported usage without duplicate cumulative accounting. |

### S — Bounded adapters and views

| Order | Feature | Start after | First useful slice |
| --- | --- | --- | --- |
| 5 | [F15](#15-task-timing) — Task timing | G0 | Expose non-overlapping task/tool timing. |
| 6 | [F26](#26-prebuilt-reusable-tool-library) — Prebuilt reusable tool library | G0 | Expose a small set of canonical reusable operations. |
| 7 | [F01](#1-complete-repository-inventory-and-json-tree) — Complete repository inventory and JSON tree | [F26](#26-prebuilt-reusable-tool-library) | Integrate metadata inventory into the existing file browser. |
| 8 | [F04](#4-shared-and-unique-component-classification) — Shared and unique component classification | [F01](#1-complete-repository-inventory-and-json-tree) | Expose production-consumer classifications with evidence. |
| 9 | [F02](#2-architecture-map) — Architecture map | [F01](#1-complete-repository-inventory-and-json-tree), [F04](#4-shared-and-unique-component-classification) | Show role groups and revision-consistent related files. |
| 10 | [F03](#3-detailed-file-explanations) — Detailed file explanations | [F01](#1-complete-repository-inventory-and-json-tree), [F02](#2-architecture-map) | Show deterministic facts for the selected file. |
| 11 | [F06](#6-evidence-based-duplicate-detection) — Evidence-based duplicate detection | [F01](#1-complete-repository-inventory-and-json-tree), [F04](#4-shared-and-unique-component-classification) | Expose exact and substantive syntax duplicate candidates. |
| 12 | [F10](#10-dependency-dashboard-and-run-check) — Dependency dashboard and Run check | [F01](#1-complete-repository-inventory-and-json-tree) | Preserve dependency kinds and requested/locked/installed versions. |
| 13 | [F11](#11-project-checks-and-tooling) — Project checks and tooling | [F26](#26-prebuilt-reusable-tool-library) | Discover and execute actual project checks with typed outcomes. |
| 14 | [F23](#23-approved-components-and-operations) — Approved components and operations | [F04](#4-shared-and-unique-component-classification), [F37](#37-minimum-necessary-implementation) | Catalog existing component exports and operation ownership. |
| 15 | [F29](#29-tool-performance-and-improvement-tracking) — Tool performance and improvement tracking | [F15](#15-task-timing), [F16](#16-token-and-context-accounting), [F26](#26-prebuilt-reusable-tool-library) | Compare tool versions on duration, reliability and context cost. |

### M — Persistent services and cross-layer features

| Order | Feature | Start after | First useful slice |
| --- | --- | --- | --- |
| 16 | [F05](#5-feature-tracing) — Feature tracing | [F01](#1-complete-repository-inventory-and-json-tree), [F02](#2-architecture-map), [F03](#3-detailed-file-explanations) | Trace one current OpenCode operation end to end. |
| 17 | [F13](#13-skill-and-hook-management) — Skill and hook management | [F11](#11-project-checks-and-tooling) | Inventory skills/hooks and safely apply a reviewed source update. |
| 18 | [F14](#14-skill-and-hook-execution-audit) — Skill and hook execution audit | [F13](#13-skill-and-hook-management), [F15](#15-task-timing) | Record supplied versus executed skills/hooks. |
| 19 | [F12](#12-global-integrations-and-documentation-lookup) — Global integrations and documentation lookup | [F10](#10-dependency-dashboard-and-run-check), [F26](#26-prebuilt-reusable-tool-library), [F28](#28-compact-results-and-valid-caching) | Provide one version-aware documentation lookup path. |
| 20 | [F07](#7-continuous-indexing) — Continuous indexing | [F01](#1-complete-repository-inventory-and-json-tree), [F02](#2-architecture-map) | Update changed files and affected graph edges incrementally. |
| 21 | [F08](#8-persistent-file-revision-recording) — Persistent file revision recording | [F07](#7-continuous-indexing) | Port durable observed-save capture with explicit storage policy. |
| 22 | [F09](#9-file-timeline-and-line-by-line-diffs) — File timeline and line-by-line diffs | [F08](#8-persistent-file-revision-recording) | Open saved revisions and diffs in the existing review UI. |
| 23 | [F36](#36-real-performance-and-accessibility-checks) — Real performance and accessibility checks | [F11](#11-project-checks-and-tooling) | Run existing performance and accessibility scenarios. |
| 24 | [F22](#22-protected-architecture-rules) — Protected architecture rules | [F11](#11-project-checks-and-tooling), [F23](#23-approved-components-and-operations) | Run precise architecture rules as advisory findings first. |
| 25 | [F34](#34-framework-aware-behavioral-test-packs) — Framework-aware behavioral test packs | [F11](#11-project-checks-and-tooling), [F23](#23-approved-components-and-operations) | Attach real native-stack behavior checks to operations. |
| 26 | [F35](#35-test-integrity-and-automatic-gap-detection) — Test integrity and automatic gap detection | [F34](#34-framework-aware-behavioral-test-packs), [F11](#11-project-checks-and-tooling) | Detect missing/disabled required checks and vacuous fixtures. |
| 27 | [F17](#17-accessible-prompt-and-context-audit) — Accessible prompt and context audit | [F14](#14-skill-and-hook-execution-audit), [F16](#16-token-and-context-accounting), [F28](#28-compact-results-and-valid-caching) | Capture an inspectable, redacted request-source envelope. |
| 28 | [F30](#30-versioned-protected-tool-implementations) — Versioned, protected tool implementations | [F26](#26-prebuilt-reusable-tool-library), [F11](#11-project-checks-and-tooling) | Version tool implementations and pin their provenance. |
| 29 | [F27](#27-automatic-tool-discovery-and-reuse) — Automatic tool discovery and reuse | [F26](#26-prebuilt-reusable-tool-library), [F30](#30-versioned-protected-tool-implementations) | Discover and materialize only relevant native tools. |

### L — Protected changes and durable tasks

| Order | Feature | Start after | First useful slice |
| --- | --- | --- | --- |
| 30 | [F25](#25-one-versioned-enforcement-system) — One versioned enforcement system | [F11](#11-project-checks-and-tooling), [F22](#22-protected-architecture-rules), [F30](#30-versioned-protected-tool-implementations) | Introduce the trusted policy, task IDs and receipt owner. |
| 31 | [F20](#20-isolated-agent-workspace) — Isolated agent workspace | [F25](#25-one-versioned-enforcement-system) | Enforce candidate isolation on one supported OS. |
| 32 | [F21](#21-controlled-change-acceptance) — Controlled change acceptance | [F20](#20-isolated-agent-workspace), [F11](#11-project-checks-and-tooling), [F22](#22-protected-architecture-rules), [F30](#30-versioned-protected-tool-implementations) | Accept exactly a checked candidate and reconcile materialization. |
| 33 | [F38](#38-durable-message-queue-instead-of-live-steering) — Durable message queue instead of live steering | [F21](#21-controlled-change-acceptance), [F25](#25-one-versioned-enforcement-system) | Persist and claim separate tasks after acceptance/reconciliation. |
| 34 | [F19](#19-queued-message-and-historical-steering-audit) — Queued-message and historical steering audit | [F38](#38-durable-message-queue-instead-of-live-steering) | Project queue events into an auditable message timeline. |
| 35 | [F39](#39-interruption-recovery-and-unfinished-file-tracking) — Interruption recovery and unfinished-file tracking | [F38](#38-durable-message-queue-instead-of-live-steering), [F40](#40-targeted-revision-aware-edits), [F08](#8-persistent-file-revision-recording) | Reconcile interrupted operations from durable evidence. |
| 36 | [F18](#18-task-interpretation-drift-and-recurring-corrections) — Task interpretation, drift, and recurring corrections | [F19](#19-queued-message-and-historical-steering-audit), [F23](#23-approved-components-and-operations), [F39](#39-interruption-recovery-and-unfinished-file-tracking) | Compare declared scope with observed changes. |
| 37 | [F24](#24-reviewed-extensions-for-new-behavior) — Reviewed extensions for new behavior | [F21](#21-controlled-change-acceptance), [F23](#23-approved-components-and-operations), [F34](#34-framework-aware-behavioral-test-packs) | Review one shared-contract extension and its consumers. |
| 38 | [F33](#33-enforced-drift-detection-and-pause) — Enforced drift detection and pause | [F18](#18-task-interpretation-drift-and-recurring-corrections), [F20](#20-isolated-agent-workspace), [F21](#21-controlled-change-acceptance), [F22](#22-protected-architecture-rules), [F25](#25-one-versioned-enforcement-system), [F39](#39-interruption-recovery-and-unfinished-file-tracking) | Pause mutations on confirmed protected-rule violations. |
| 39 | [F42](#42-deterministic-workflows-with-minimal-model-involvement) — Deterministic workflows with minimal model involvement | [F21](#21-controlled-change-acceptance), [F26](#26-prebuilt-reusable-tool-library), [F35](#35-test-integrity-and-automatic-gap-detection), [F38](#38-durable-message-queue-instead-of-live-steering), [F39](#39-interruption-recovery-and-unfinished-file-tracking) | Execute one deterministic protected workflow. |

### XL — Frameworks, workers and external runtimes

| Order | Feature | Start after | First useful slice |
| --- | --- | --- | --- |
| 40 | [F31](#31-versioned-framework-documentation-and-executable-recipes) — Versioned framework documentation and executable recipes | [F12](#12-global-integrations-and-documentation-lookup), [F24](#24-reviewed-extensions-for-new-behavior), [F34](#34-framework-aware-behavioral-test-packs), [F42](#42-deterministic-workflows-with-minimal-model-involvement) | Ship one compatible framework recipe with real tests. |
| 41 | [F32](#32-installable-component-and-feature-registry) — Installable component and feature registry | [F23](#23-approved-components-and-operations), [F24](#24-reviewed-extensions-for-new-behavior), [F31](#31-versioned-framework-documentation-and-executable-recipes) | Install/update one target-project module without losing edits. |
| 42 | [F43](#43-automatic-routing-by-task-capability-and-total-cost) — Automatic routing by task, capability, and total cost | [F16](#16-token-and-context-accounting), [F29](#29-tool-performance-and-improvement-tracking), [F42](#42-deterministic-workflows-with-minimal-model-involvement) | Route one bounded task class using measured capability/cost. |
| 43 | [F44](#44-main-orchestrator-with-bounded-subagents) — Main orchestrator with bounded subagents | [F20](#20-isolated-agent-workspace), [F21](#21-controlled-change-acceptance), [F38](#38-durable-message-queue-instead-of-live-steering), [F39](#39-interruption-recovery-and-unfinished-file-tracking), [F43](#43-automatic-routing-by-task-capability-and-total-cost) | Delegate one independent child task with bounded authority. |
| 44 | [F46](#46-app-managed-web-retrieval-with-source-evidence) — App-managed web retrieval with source evidence | [F12](#12-global-integrations-and-documentation-lookup), [F26](#26-prebuilt-reusable-tool-library), [F28](#28-compact-results-and-valid-caching), [F20](#20-isolated-agent-workspace) | Add source/freshness evidence to native retrieval. |
| 45 | [F41](#41-app-managed-local-engines) — App-managed local engines | [F20](#20-isolated-agent-workspace), [F25](#25-one-versioned-enforcement-system), [F26](#26-prebuilt-reusable-tool-library), [F30](#30-versioned-protected-tool-implementations), [F42](#42-deterministic-workflows-with-minimal-model-involvement) | Package and manage one verified engine capability. |
| 46 | [F45](#45-provider-gateway-and-evaluated-free-model-pool) — Provider gateway and evaluated free-model pool | [F43](#43-automatic-routing-by-task-capability-and-total-cost), [F41](#41-app-managed-local-engines) | Evaluate one optional gateway and approved free-model pool. |
| 47 | [F47](#47-claude-subscription-access-through-the-official-claude-code-client) — Claude subscription access through the official Claude Code client | [F20](#20-isolated-agent-workspace), [F21](#21-controlled-change-acceptance), [F38](#38-durable-message-queue-instead-of-live-steering), [F39](#39-interruption-recovery-and-unfinished-file-tracking), [F41](#41-app-managed-local-engines) | Integrate one official-client run through documented boundaries. |

## Product-wide execution policy

- [ ] Make deterministic application code the default execution path. Reuse existing code, approved recipes, framework commands, parsers, indexes, and cached results before invoking a model. Routine operations must not require an AI planner, regenerated scripts, or an AI reviewer to function.
- [ ] Define one opinionated, versioned project profile covering folder structure, allowed dependencies, approved primitives and operations, backend contracts, edit scope, formatting, types, tests, and acceptance rules. Enforce supported constraints mechanically through the protected supervisor; prose instructions supplement those checks.
- [ ] Give the model only the context necessary for the current decision: relevant source regions, symbols, contracts, version-matched documentation excerpts, and actionable failures. Discover tools on demand, preserve access to original evidence, and avoid repeatedly transmitting whole repositories, files, logs, or documentation sets.
- [ ] Use measurable per-workflow budgets for model calls, input/output tokens, context size, tool output, retries, and elapsed work. Record actual usage and estimates separately. A budget limit produces a visible incomplete or paused state; it must not remove mandatory checks, hide evidence, or mark unfinished work complete.
- [ ] Optimize for the smallest correct, maintainable implementation and the lowest measured model overhead. Preserve necessary security, validation, readability, and test coverage. Treat suspected drift and semantic duplication as reviewable findings unless a precise protected rule establishes a violation.

## Existing local tools

Recorded local inventory: September 14, 2026. Installation does not establish ArezaCode integration.

| Tool | Version | Recorded setup | Integration |
| --- | --- | --- | --- |
| MarkItDown | 0.1.7 | Local converter | Managed conversion worker; cache output. |
| MarkItDown MCP | 0.0.1a4 | Codex connector | Optional external connector. |
| Headroom | 0.37.0 | Healthy local Codex proxy at audit time | Optional managed transform; prove retrieval/savings; retain bypass. |
| Semgrep | 1.176.0 | Local runner and Codex MCP configuration | Managed checks; validate engine/rule licenses. |
| Entire | 0.10.6 | Installed; not enabled in ArezaCode | Managed session/checkpoint adapter; separate file history. |

## Repository understanding

### 1. Complete repository inventory and JSON tree

- **Reuse:** Repo Map inventory/parsers [E01]; Location-scoped Core service, Schema contracts, generated Client and existing file browser [E11].
- **Build:** Register stable project/workspace IDs; migrate moved roots; scan metadata into one index revision; paginate directory queries; stream full JSON exports. Report unsupported parsers.
- **UI:** Virtualized Files tree with filters, coverage, exclusions and scan status.
- **Verify:** Hidden/ignored/dependency entries, unreadable paths, symlink escape, root moves, nested worktrees, pagination and secret exclusion.

- [ ] List every file and directory under the selected repository, including hidden, ignored, generated, dependency, and configuration entries, with explicit classifications and visibility filters.
- [ ] Export the inventory as a structured JSON tree that both the user and agents can query.
- [ ] Include paths, file types, sizes, modification times, indexing status, and architectural classifications.
- [ ] Show unreadable paths, exclusions, symlinks, and incomplete scans explicitly; do not silently present a partial scan as complete.
- [ ] Separate file inventory from content capture: listing a file does not require storing or exposing its contents, especially secrets, binaries, and generated files.

### 2. Architecture map

- **Reuse:** F01 index definitions, imports, consumers and classifications [E01].
- **Build:** Query role groups and adjacency at one revision. Resolve exports/aliases with project TypeScript configuration; retain unresolved-edge reasons.
- **UI:** Directory filters, counts and related files. Add a bounded graph only after measuring its need.
- **Verify:** Aliases, re-exports, dynamic/type-only imports, cycles, stale revisions and exact-file navigation.

- [ ] Group files into backend, UI, shared components, business logic, APIs, libraries, configuration, tests, and generated code.
- [ ] Connect the architecture view to the real directory tree so every item opens its actual file.
- [ ] Show imports, dependencies, and consumers where analysis can resolve them.
- [ ] Keep unresolved, dynamic, and inferred relationships visibly distinct from verified static relationships.
- [ ] Provide a simple directory-oriented view and an optional relationship map instead of forcing users through a dense graph.

### 3. Detailed file explanations

- **Reuse:** Repo Map descriptions and symbols [E01].
- **Build:** Verify source hash; render exports/imports/consumers. Cache optional generated explanations by source, dependency, parser, model and prompt versions. F05 supplies framework adapters.
- **UI:** Source, Relationships and History; label generated, unsupported and stale content.
- **Verify:** Symbol line accuracy, separately exported declarations, dependency invalidation and model-free inspection.

- [ ] Show what each file does, its architectural role, exported symbols, dependencies, and consumers.
- [ ] Link symbols and relationships to exact line numbers and the source revision used to generate them.
- [ ] Explain libraries, API endpoints, configuration files, and their usage in the project.
- [ ] Distinguish parser evidence from generated explanations; invalidate explanations when their source changes.
- [ ] Open source, related files, and history from the same file detail view.

### 4. Shared and unique component classification

- **Reuse:** Repo Map productionConsumers; keep test/type-only references separate [E01].
- **Build:** Classify observed consumers. Record reviewed overrides with author, reason and invalidation criteria. F23 defines intended ownership.
- **UI:** Shared, Single observed consumer, Unused candidate or Unknown; link actual consumers.
- **Verify:** Multiple, test-only, type-only, re-exported and framework-discovered consumers. Missing imports must not trigger deletion.

- [ ] Mark components and modules as shared, single-use, unused candidates, or unknown based on observed usage.
- [ ] List every detected consumer and the evidence behind the classification.
- [ ] Separate intended shared ownership from the current number of consumers.
- [ ] Allow reviewed classifications where framework conventions or dynamic imports cannot be resolved automatically.

### 5. Feature tracing

- **Reuse:** Repo Map traversal/PSR-4/Inertia links [E01]; current Protocol groups and Server handlers [E16].
- **Build:** Implement one trace: control → handler → generated Client → API → Core → SQL/event. Store source span and evidence kind per edge; add tested framework adapters.
- **UI:** Linear trace with validation/error branches and explicit unresolved links.
- **Verify:** Trace a supported route in both directions; compare with an isolated runtime test. Static reachability alone is insufficient.

- [ ] Trace a feature from its page and components through event handlers, application operations, API routes, services, and persistence where supported.
- [ ] Show where shared filtering, pagination, URL state, authorization, validation, and submission behavior lives.
- [ ] Let users start from a button, file, endpoint, or feature and inspect the connected implementation.
- [ ] Expose unknown links instead of inventing a complete execution path from incomplete static evidence.

### 6. Evidence-based duplicate detection

- **Reuse:** Repo Map exact-file/function fingerprints preserve identifiers/literals and exclude tiny matches [E01].
- **Build:** Update affected fingerprints; store dismissals/exceptions by content hash and rule version. Start with exact/syntax matches; measure semantic matching separately.
- **UI:** Side-by-side code, differences, consumers and match reason.
- **Verify:** Duplicates, tiny wrappers, differing authorization literals, generated copies, changed dismissals and false positives.

- [ ] Surface candidate duplicates in UI components, handlers, backend operations, filters, utilities, and configuration.
- [ ] Show the matching code, locations, similarity evidence, relevant differences, and existing consumers.
- [ ] Separate exact copies, structural similarities, and possible overlapping responsibilities.
- [ ] Support review, dismissal, intentional-duplication exceptions, and re-evaluation when code changes.
- [ ] Track false positives so rules improve; never present a similarity score as proof of duplicated business behavior or automatically merge unrelated implementations.

## Live indexing, history, and maintenance

### 7. Continuous indexing

- **Reuse:** Native watcher [E07], Repo Map parser cache [E01] and reconciliation [E03].
- **Build:** Coalesce changed paths; reparse affected content/edges; publish one coherent revision. Reconcile overflow, missing filenames, restart and root moves. F08 capture runs independently of index debounce.
- **UI:** Keep previous results during rebuild; show current state and last successful revision.
- **Verify:** Rapid saves, atomic renames, deletions, missed events, unsupported watchers, large installs, cancellation and update latency.

- [ ] Watch repository changes and incrementally update the inventory, relationships, classifications, and affected explanations.
- [ ] Show whether the index is scanning, live, stale, incomplete, or failing, with its last successful update.
- [ ] Reconcile after restarts or missed events and expose what coverage was lost.
- [ ] Keep indexing responsive in large repositories without repeatedly rescanning everything after each edit.

### 8. Persistent file revision recording

- **Reuse:** FileHistory SQLite/WAL, compressed hash-addressed blobs, deduplication and restart reconciliation [E02].
- **Build:** Snapshot observed saves; append blob/revision/head transactionally. Migrate root-bound stores; use a Bun worker or tested SQLite adapter. Define deletion, retention and GC before rollout.
- **UI:** Coverage, pauses, storage and missing snapshots; link renames only with evidence.
- **Verify:** Root moves, crash between writes, full disk, rapid saves, invalid UTF-8, symlink replacement, restart and migration.

- [ ] Preserve successive observed file saves, additions, deletions, and detected renames rather than overwriting the previous snapshot.
- [ ] Record timestamps, content hashes, paths, and links to tasks or tools when that attribution is available.
- [ ] Persist history across application and service restarts independently of Git commits.
- [ ] Store source snapshots for eligible text files and explicit metadata-only records for sensitive, binary, oversized, or excluded content.
- [ ] State the recording boundary honestly: filesystem watchers may coalesce writes, and intermediate saves made while recording is stopped cannot be reconstructed.

### 9. File timeline and line-by-line diffs

- **Reuse:** Prototype revision paging/diff parsing [E02]; existing review renderer [E11].
- **Build:** Load immutable revision IDs; diff saved text with exact line coordinates. Report missing or metadata-only source explicitly.
- **UI:** History in the file pane; fixed revision selection; repository activity queries the same records.
- **Verify:** Empty/deleted/new files, missing final newline, CRLF/BOM, large diffs, arbitrary comparisons and paging.

- [ ] Show a chronological history for each file, including creation, edits, deletion, and available rename evidence.
- [ ] Compare consecutive or selected revisions with added and removed lines and exact old/new line numbers.
- [ ] Open the saved source for any recorded text revision.
- [ ] Keep an older selected revision fixed while new changes arrive in real time.
- [ ] Provide a repository-wide activity feed with file, time, task, and change-type filters where data is available.

### 10. Dependency dashboard and Run check

- **Reuse:** DependencyCheck and manifest discovery [E03]; Bun lockfile/catalog support is incomplete.
- **Build:** Resolve manifest kind/range, workspace/catalog, lockfile and installed versions; query the configured registry on request. Use package-manager range semantics. Apply upgrades through acceptance.
- **UI:** Separate requested, locked, installed and available versions; distinguish range satisfaction from tested compatibility.
- **Verify:** Catalog/workspace ranges, multiple versions, dev/peer/optional kinds, Composer, prereleases, private/offline registries and stale results. Checking must not install.

- [ ] List direct dependencies and development dependencies, their manifests, requested ranges, installed versions, and lockfile versions where available.
- [ ] Show each dependency's purpose and detected usage, distinguishing evidence from inferred descriptions.
- [ ] Add a Run check button to fetch available versions and record when the check ran.
- [ ] Display current, outdated, unknown, local, and unsupported states; separate patch, minor, major, and allowed-range updates.
- [ ] Keep version checks separate from installation: show failures and missing information, and never equate the latest version with a verified compatible upgrade.

### 11. Project checks and tooling

- **Reuse:** Project scripts, Oxlint, package typechecks and test workflows [E13]; ESLint adapter where configured.
- **Build:** Discover statically; record command/working directory; execute on request; normalize CheckRun results. Executing effective configuration is a separate operation. Trusted enforcement requires F20/F21/F25.
- **UI:** Not configured, Not run, Passed, Failed, Skipped or Infrastructure error; link failures to source.
- **Verify:** Wrong directory, zero tests, nonzero exit, malformed report, timeout, modified scripts and missing engine.

- [ ] Discover the project's actual check scripts and configuration, including Oxlint or ESLint where applicable; show presets, plugins, declared rules, overrides, and relevant package working directories.
- [ ] Show the effective rules for a selected file where the project's tooling can resolve them.
- [ ] Explain which checks cover style, types, architecture, tests, and security, including checks outside ESLint.
- [ ] Link failures to files and lines and distinguish configured checks from checks actually executed successfully.
- [ ] Integrate check results into change review without allowing the agent to redefine trusted acceptance checks.

## Integrations, documentation, and task observability

### 12. Global integrations and documentation lookup

- **Reuse:** Core Integration/Reference [E09], [E10]; evaluate Grounded Docs as the index backend [W03].
- **Build:** Resolve versioned official sources; fetch/revalidate; index version/hash/freshness; return bounded excerpts. Context7 uses the same contract. F41 manages engines; embeddings/OCR require explicit resource/data settings.
- **UI:** Source settings and cited context excerpts; label offline, stale and version mismatch.
- **Verify:** Version match, unavailable version, expiry, failed fetch, source replacement, redaction and keyword lookup without a model.

- [ ] Provide centrally managed Context7, Semgrep, and Entire integrations, with visible availability, versions, configuration, and per-project overrides.
- [ ] Reuse integrations where available instead of building another implementation of the same capability.
- [ ] Retrieve official framework and library documentation relevant to the project's installed versions.
- [ ] Cache and index documentation in a compact searchable form with source URLs, versions, retrieval dates, and links back to complete sections.
- [ ] Return only relevant documentation excerpts to the agent; show stale, missing, or mismatched documentation and preserve requirements that a lossy summary could omit.

### 13. Skill and hook management

- **Reuse:** SkillV2 discovery/precedence and plugin/reference metadata [E10].
- **Build:** Inventory each supported host format; compare pinned hashes; preview updates; apply atomically with backup; invalidate the source-keyed skill cache. Version external hook adapters separately.
- **UI:** Scope, version, source, local edits, unavailable paths and update diff. Inventory does not execute hooks.
- **Verify:** Name/source precedence, removed files, local edits, failed update, invalid metadata and cache refresh.

- [ ] Inventory installed skills and hooks, their scope, source, enabled state, and version.
- [ ] Compare tracked skills against their upstream sources, including Emil Kowalski's skills.
- [ ] Show available updates and changes before applying them, preserving intentional local customizations.
- [ ] Detect duplicate registrations, broken paths, and hooks referring to removed tools.
- [ ] Keep a versioned record of configuration changes so task behavior can be traced to the configuration active at the time.

### 14. Skill and hook execution audit

- **Reuse:** Skill loading, tool settlement and plugin/hook execution events [E04], [E10].
- **Build:** Record supplied/invoked/started/settled separately with invocation ID, source/version and duration. Deduplicate replay. F39/F47 extend recovery and external-runner events.
- **UI:** Task Activity links source and input/output artifacts; label unavailable host capture.
- **Verify:** Unused supplied skills, failed/cancelled hooks, duplicate events, missing telemetry and version changes.

- [ ] Record which skills were supplied or explicitly invoked and which hooks actually executed during each task.
- [ ] Capture versions, timestamps, duration, result, and failures where exposed by the integration.
- [ ] Distinguish being available in context from demonstrated execution or compliance.
- [ ] Link hook output and resulting actions to the task timeline.

### 15. Task timing

- **Reuse:** Session/tool timestamps and event publishing [E06], [E08].
- **Build:** Use monotonic durations and persisted UTC timestamps. Calculate wall time, active interval union and summed worker time separately. F39 supplies recovery gaps.
- **UI:** Model request, tool and wait durations; label unavailable provider-internal timing.
- **Verify:** Overlap, clock changes, cancellation, retries, interrupted spans and resume.

- [ ] Track task start, completion, cancellation, interruption, and resumption.
- [ ] Separate total elapsed time, observed model request time, tool execution, and waiting where telemetry permits.
- [ ] Account for parallel operations without adding overlapping durations into a misleading elapsed total.
- [ ] Compare tasks, models, tools, and repositories and show unavailable timing data explicitly.

### 16. Token and context accounting

- **Reuse:** Session token fields, context metrics and provider usage normalization [E08].
- **Build:** Persist terminal usage per request/attempt; deduplicate cumulative events; aggregate by task/session/model. Keep missing values null and pricing estimates versioned. F17 enables source attribution.
- **UI:** Separate token categories, context estimates, billing estimates and subscription limits.
- **Verify:** Missing/cumulative/duplicate usage, cache hits, retries, fallback, zero pricing and parallel workers.

- [ ] Track reported input, cached input, output, reasoning, and total token usage where providers expose them, preserving provider-specific accounting definitions.
- [ ] Break usage down by task, turn, model, and provider; attribute it to context sources or tool results only when supported by evidence.
- [ ] Distinguish measured usage from estimates and avoid double-counting cumulative usage events.
- [ ] Show the space used by instructions, skills, documentation, tool schemas, messages, and tool outputs when the accessible request payload allows estimation or measurement.
- [ ] Measure whether caching and reusable tools reduce usage; separate token totals, subscription limits, and estimated monetary cost.

### 17. Accessible prompt and context audit

- **Reuse:** SystemContext and SessionContextEpoch source snapshots [E08].
- **Build:** Capture a redacted request envelope linking history, instructions, skills, schemas, docs and outputs. Apply retention/deletion limits. Invalidate context-presence records when retained content is unknown.
- **UI:** Extend Context with per-request sources, transformations and capture coverage.
- **Verify:** Redact before persistence; test deletion, original retrieval, model switch, compaction, truncated history and tool changes. External runners expose documented telemetry only.

- [ ] Show the user request, application-generated instructions, injected skills, documentation excerpts, and tool definitions available to the integration.
- [ ] Preserve an inspectable record of the accessible context sent for each request, with secret redaction and clear capture limits.
- [ ] Distinguish application-visible prompts from provider-side instructions or transformations that are not exposed.
- [ ] Show summaries or context reductions performed by the application and preserve access to their original source when appropriate.
- [ ] Do not claim to expose hidden chain-of-thought or reconstruct the model's private internal interpretation.

### 18. Task interpretation, drift, and recurring corrections

- **Reuse:** Task contract, operation journal and component/operation catalog.
- **Build:** Persist scope, required checks and intended reuse; compare observed changes against rules. Link recurring-correction proposals to original messages. F33 handles blocking.
- **UI:** Scope and deviations in Task Details; review policy proposals without extra routine approvals.
- **Verify:** Visual-only scope, exceptions, ambiguity, false positives and deleted conversations. Never promote suggestions to global policy automatically.

- [ ] Have the agent state a short explicit task interpretation, allowed scope, acceptance criteria, and intended reuse before substantial changes.
- [ ] Compare edits and tool activity against that declared scope and surface observable deviations, such as backend changes during a visual-only task.
- [ ] Track recurring user corrections, repeated phrases, reopened bugs, and repeated requests to reuse components across accessible conversations.
- [ ] Group correction patterns with links to the original messages and affected changes so the user can verify the grouping.
- [ ] Turn reviewed recurring problems into proposed checks, shared operations, or reusable tools; inferred patterns must not silently become global rules.

### 19. Queued-message and historical steering audit

- **Reuse:** F38 queue and event journal.
- **Build:** Store arrival order and versioned message text once; project queue/delivery states and task/session links. Keep historical steering as import metadata.
- **UI:** Arrival/delivery times and previous-task status; label imported steering.
- **Verify:** Import/replay deduplication, edited-message history, delayed delivery and clarification linked to the correct task.

- [ ] Record each follow-up message verbatim with its timestamp, task, queue position, and delivery state.
- [ ] Keep ordinary follow-up messages queued until the active task finishes; do not inject them into the running task as steering.
- [ ] Show what was running when a message arrived and when the next task actually received it.
- [ ] Preserve steering events imported from older or external conversations as historical evidence without enabling live steering in ArezaCode.
- [ ] Link delivered messages to subsequent task interpretations and changes without claiming causation that cannot be established; keep explicit pause, stop, and cancel controls immediately available.

## Protected implementation and acceptance

### 20. Isolated agent workspace

- **Reuse:** LocationMutation/permissions for placement and tool policy [E05]; OS isolation is new.
- **Build:** Launch candidates with restricted filesystem/network/process capabilities. Protect accepted files, policy, tools, credentials and Git metadata across every execution path. Prove one OS first.
- **UI:** Actual isolation mode, allowed roots and unsupported capabilities.
- **Verify:** File/shell/child/symlink/Git/connector escape, candidate-controlled tests, cancellation cleanup and resource limits.

- [ ] Give agents an isolated working copy while protecting the accepted checkout, Git metadata, and enforcement configuration.
- [ ] Cover file tools, shell commands, subprocesses, and external write-capable integrations; a plugin convention alone is insufficient.
- [ ] Make access boundaries visible and test that direct writes to protected paths fail.
- [ ] Treat worktrees as a workflow convenience, not a complete isolation boundary, because they share repository metadata.

### 21. Controlled change acceptance

- **Reuse:** Git/snapshot/diff operations [E02], [E07]; add trusted acceptance receipts.
- **Build:** Freeze candidate/base hashes; run protected checks; bind results to tree/config/dependency/rule/tool versions; accept immutable identity; journal checkout application. Changed inputs invalidate receipts.
- **UI:** Candidate, evidence, conflicts and separate Accepted/Applied/Uncertain states; preserve user edits.
- **Verify:** Tampering, changed base, concurrent edits, forged reports, failures, partial application and retries. Never roll back later user edits.

- [ ] Route proposed changes through a trusted supervisor that validates the candidate against the current accepted development state.
- [ ] Apply exactly the state that passed the checks, with a record of the candidate revision, rule versions, and results.
- [ ] Recompute and recheck if the accepted checkout changes before application.
- [ ] Preserve existing user edits and report conflicts rather than silently overwriting them.
- [ ] Run candidate code and tests without write access to protected state; changed test scripts must not gain the supervisor's privileges.

### 22. Protected architecture rules

- **Reuse:** Import-boundary tests [E16], project linters and source/manifest checks.
- **Build:** Assign stable rule IDs to paths/imports/dependencies/operations; check a pinned baseline; report source, expectation and reusable implementation. F25 owns policy; F21 owns acceptance.
- **UI:** One Checks list; deterministic blocking after F20/F21; separate heuristic findings.
- **Verify:** Allowed/forbidden imports, constrained handler copies, dependencies, suppressions, invalid output and scoped/expiring exceptions.

- [ ] Enforce specific rules over imports, exports, component usage, operations, dependencies, and allowed change scope.
- [ ] Reject task-scoped violations such as adding another button implementation, inventing a duplicate publishing handler, or changing backend filtering during a visual-only task.
- [ ] Keep enforcement rules, baselines, required checks, and acceptance configuration outside the agent's write authority.
- [ ] Return structured failures with stable rule identifiers, affected paths and lines, expected behavior, and the existing implementation to reuse. Required checks that fail, cannot run, or produce invalid results block acceptance; the agent cannot turn them into warnings or success.
- [ ] Support reviewed exceptions and measure false positives; arbitrary semantic duplication cannot be detected with a universal guarantee.

### 23. Approved components and operations

- **Reuse:** Workspace exports, UI variants, Storybook and observed operations [E11].
- **Build:** Catalog stable ID, import/export, inputs, variants, consumers and contract; point to canonical code. F32 adds target-project composition.
- **UI:** Lookup in file details/command search with source, usage and examples.
- **Verify:** Real exports, duplicate IDs, moved/removed source, valid variants and an actual consumer fixture.

- [ ] Maintain registries of approved components, variants, and business operations that agents can discover and reuse.
- [ ] Route equivalent buttons to the same operation instead of recreating handlers in each page.
- [ ] Give shared filters one owner for selection behavior, operators, URL state, pagination, and backend contracts.
- [ ] For tightly controlled surfaces, allow declarative composition using approved component and action identifiers.
- [ ] Make the boundary explicit: declarative restrictions prevent alternative implementations only when arbitrary executable handlers cannot be added alongside them.

### 24. Reviewed extensions for new behavior

- **Reuse:** Existing acceptance diff/checks and versioned shared contracts.
- **Build:** Inspect affected consumers; propose the smallest public change; update implementation/tests; validate old/new behavior; accept the checked candidate.
- **UI:** Normal review with contract impact and affected consumers.
- **Verify:** Stable existing behavior, invalid inputs, explicit migrations and protected checks. Local edits require extension review only when they change the shared contract.

- [ ] Separate changes to existing screens from extensions to shared components and business operations.
- [ ] Require an explicit new behavior contract and appropriate tests when the approved registry lacks the necessary capability.
- [ ] Show affected consumers before changing a shared implementation.
- [ ] Preserve existing behavior unless the requested change intentionally updates it.

### 25. One versioned enforcement system

- **Reuse:** Core/Schema/Server boundaries [E16].
- **Build:** Load a host-controlled profile and immutable tools/rules; resolve task contract; schedule checks; issue receipts. Introduce task/candidate/check IDs; F38/F39 add queue/recovery. Complete protection with F20/F21.
- **UI:** Project profile, supported stack and missing requirements; one policy version across views.
- **Verify:** Invalid/old profile, rule drift, unauthorized overrides, missing checks, restart and reproducible receipts.

- [ ] Centralize the supervisor, rule distribution, results, and acceptance workflow rather than maintaining disconnected copies in each repository.
- [ ] Use framework and language adapters for project-specific conventions and checks.
- [ ] Provide a project setup checklist covering dependencies, documentation versions, architecture boundaries, shared operations, and required verification.
- [ ] Keep approved rule and tool versions reproducible for each accepted change.
- [ ] Validate the boundary first with one protected checkout and one button operation: a permitted visual edit passes, a prohibited copied handler fails, and a direct protected write is blocked.

## Reusable tools and lower token overhead

### 26. Prebuilt reusable tool library

- **Reuse:** Canonical Tool.make and Tools/ApplicationTools [E04].
- **Build:** Expose existing read/search/diff, then F01 queries. UI and agents call the same domain code; bound output only at settlement. Keep permission checks in tool leaves; adapt MCP/plugins explicitly.
- **UI:** Operation, input schema, version and last outcome.
- **Verify:** Schema errors, stale identity, cancellation, scope and equivalent UI/agent results.

- [ ] Replace recurring generated Python or shell scripts with named, tested operations implemented once.
- [ ] Cover repeated repository searches, file inspection, dependency checks, revision comparisons, documentation lookup, and task usage analysis.
- [ ] Give each operation a stable input schema, output schema, error format, and bounded execution behavior.
- [ ] Call existing project tooling or established command-line utilities where suitable rather than duplicating their implementation.
- [ ] Keep the agent's request small: supply arguments instead of regenerating the tool's implementation on every task.

Illustrative operations, not implemented APIs:

```text
repo.search(query, scope)
repo.file_details(path)
repo.dependencies(check_latest)
repo.diff(before, after)
docs.lookup(package, version, query)
task.usage(task_id)
```

### 27. Automatic tool discovery and reuse

- **Reuse:** Canonical registry materialization [E04].
- **Build:** Discover bounded metadata; materialize selected schemas; execute the captured registration. Track schema cost; invalidate discovery after registry/version changes.
- **UI:** Selected tools and fallback reason; external adapters advertise supported capabilities.
- **Verify:** Collisions, replaced registration, stale cache, permission filtering, unavailable adapters and unsupported operation matching.

- [ ] Expose the same reusable operations through ArezaCode and compatible Codex and Claude integrations using appropriate tool or protocol adapters.
- [ ] Make relevant operations discoverable before the agent writes a replacement script.
- [ ] Route known standard operations through the registered implementation where the host can enforce that route.
- [ ] Load relevant tool descriptions on demand instead of placing every possible schema in every request.
- [ ] Keep a visible fallback for unsupported work; matching arbitrary generated code to an existing tool is not assumed to be perfect.

### 28. Compact results and valid caching

- **Reuse:** ToolOutputStore bounding and retained originals [E04].
- **Build:** Expose originals/pagination; cache read operations by scope, revisions, arguments and producer version. F07 supplies incremental invalidation; F17 tracks context presence. Benchmark Headroom before enabling it.
- **UI:** Original/page links with partial, stale, unavailable and expired states.
- **Verify:** Exact retrieval, multibyte limits, incomplete capture, invalidation, permission changes, expiry and sensitive output. Never cache mutation success.

- [ ] Return requested fields, relevant lines, bounded matches, and paginated results with a way to retrieve the remainder.
- [ ] Cache repeatable read operations using repository state, arguments, tool version, and source freshness as appropriate.
- [ ] Invalidate affected cache entries when files, dependencies, configuration, or documentation change.
- [ ] Preserve exact source and complete error evidence behind compact results; do not hide failures in an optimistic summary.
- [ ] Track which source revisions and excerpts are already present in the current model context and send necessary updates rather than duplicates. Invalidate that context inventory after truncation, compaction, or provider/session changes unless retained content is known; never assume the model still has omitted evidence.
- [ ] Treat mutations separately: never silently replay a cached success for an operation that must execute again.

### 29. Tool performance and improvement tracking

- **Reuse:** Invocation events and retained-output metadata [E04], [E08].
- **Build:** Record duration, attempts, bytes, cache hits and measured/estimated tokens by operation version; compare tools/scripts on identical fixtures.
- **UI:** Comparable runs, sample size and failures; include discovery/retries in task totals.
- **Verify:** Concurrency, cancellation/failure, cache hits, missing usage and comparable before/after runs. Tool changes require F30/F21.

- [ ] Record tool duration, failures, retries, cache hits, output size, and token measurements or clearly labeled estimates.
- [ ] Identify scripts that agents repeatedly regenerate and group them as candidates for a reusable operation.
- [ ] Preserve examples of the recurring request, generated script, result, and correction needed to make it work.
- [ ] Compare the reusable implementation with the previous workflow for correctness, time, and context usage.
- [ ] Promote a candidate only after review and appropriate tests, rather than automatically trusting arbitrary generated code as a global tool.

### 30. Versioned, protected tool implementations

- **Reuse:** Canonical registrations and packaged releases [E04], [E12].
- **Build:** Pin digest, schemas, tests and supported profile versions in immutable release manifests; bind each invocation to its release. F20/F25 protect approved tools outside candidate-controlled dependencies.
- **UI:** Active version, provenance, update diff and rollback.
- **Verify:** Altered/unapproved code, schema mismatch, shadow registration, failed update and reproducible rollback.

- [ ] Store reusable tool implementations, schemas, tests, and release versions in one maintained package or service.
- [ ] Record the exact implementation version used by each invocation.
- [ ] Prevent agents from silently modifying trusted tools or their checks to bypass restrictions.
- [ ] Let agents propose improvements through the same review and acceptance mechanism used for other protected changes.
- [ ] Make measured savings visible: avoiding repeated script generation reduces that generation overhead, while tool arguments, schemas, and returned results still consume context.

## Framework recipes, component installation, and drift control

### 31. Versioned framework documentation and executable recipes

- **Reuse:** F23 components, F26 operations, official docs and F34 tests.
- **Build:** Detect stack/version; select recipe; validate prerequisites; preview files/config/migrations; run through F42; record version/checks. Start with one native-stack recipe.
- **UI:** Compatibility and patch impact; stop unsupported recipes.
- **Verify:** Repeat execution, partial failure, incompatible dependency, customization, migration and denied/invalid inputs. Certify each framework adapter separately.

- [ ] Package official documentation references together with reviewed, prewritten implementations and executable rules for recurring features such as authentication, authorization, sessions, password resets, validation, forms, uploads, and pagination.
- [ ] Detect the project's framework, runtime, installed dependencies, and versions before selecting a recipe; record supported combinations and reject incompatible or unverified combinations.
- [ ] Prefer the framework's maintained authentication and security mechanisms. Recipes configure and compose those mechanisms instead of inventing parallel password, session, or token implementations.
- [ ] Give each recipe explicit inputs, prerequisites, owned files, public contracts, configuration steps, migrations where needed, and matching tests. Retrieve only the necessary documentation and recipe metadata during a task.
- [ ] Track the recipe version and authoritative documentation sections used in each project; revalidate recipes when relevant documentation or dependencies change. Prose guidance becomes enforced behavior only where an executable check exists.

### 32. Installable component and feature registry

- **Reuse:** F31 manifests, F23 entries and compatible registry schema [W09].
- **Build:** Find existing equivalents; resolve stack/dependencies; calculate revision-bound patches using base/installed/current source; preserve edits; apply through acceptance.
- **UI:** File/import/dependency changes and conflicts.
- **Verify:** Existing install, aliases, edits, renames, shared dependencies, interruption, unsupported primitives and upgrade conflicts. Native UI retains workspace imports.

- [ ] Provide prebuilt primitives, shared components, and complete feature modules that agents can locate and install with a small structured request instead of regenerating their source.
- [ ] Follow a shadcn-style registry and component organization: discoverable component entries, declared dependencies, predictable source locations, configured import aliases, and composable primitives. Honor the official structure and schema for the selected compatible implementation.
- [ ] Supply framework-specific adapters for supported projects. A React primitive is not assumed to work unchanged in SolidJS, Svelte, or every other project; display the compatibility boundary before installation.
- [ ] Detect equivalent existing components and operations first, reuse them, and install each missing implementation once. Track installed versions and local changes so repeat installation is idempotent and updates do not overwrite customizations.
- [ ] Assemble features from approved components and operations, generating only the necessary project-specific wiring. Preview the resulting patch and required tests; unsupported behavior needs a reviewed extension rather than an invented fallback.

### 33. Enforced drift detection and pause

- **Reuse:** F22 rules, F25 task contract, F21 acceptance and F39 recovery.
- **Build:** Validate supported tools before writes; inspect other candidate changes before acceptance. Confirmed violations revoke mutation authority while allowing authorized correction. F20 restricts side effects.
- **UI:** Violated rule, source and approved operation; retain inspection and user controls.
- **Verify:** Shell bypass, repeated edits, rule changes, stale scope, false positives, correction and authorized resume. No agent self-dismissal.

- [ ] Turn the active task's permitted files, public contracts, approved recipes, shared operations, and required checks into a protected, machine-readable task contract.
- [ ] Inspect proposed mutations before applying them where possible and check the candidate workspace after writes from other permitted tools. Cover every write-capable path described in the isolation requirements.
- [ ] When an executable rule detects drift, reject the prohibited action or pause further mutations, preserve the candidate state, and show the violated rule, affected lines, and approved implementation to reuse.
- [ ] Require a compliant correction or an explicit authorized change to the contract before continuing; the agent cannot dismiss the failure, weaken the rule, or repeatedly retry an equivalent prohibited edit.
- [ ] Separate confirmed rule violations from heuristic suspicions that require review. Test the detector against known valid and invalid edits and track false positives; no system can reliably infer every possible deviation from arbitrary user intent.

## Behavioral tests, performance, and code quality

### 34. Framework-aware behavioral test packs

- **Reuse:** Project Bun/Effect tests, HTTP contracts, Playwright and fixtures [E14], [E16].
- **Build:** Map operation/criterion to the project runner; provision isolated data; execute positive/negative paths; store results/artifacts. Add other framework packs with F31.
- **UI:** Behavior/failure links; distinguish unit, integration, browser and external-service checks.
- **Verify:** Persistence, denied access, invalid input, retry/concurrency and real backend browser actions. Label doubles; exclude production data/actions.

- [ ] Select test tools and conventions from the project's actual framework and installed versions: Pest for compatible PHP projects, Playwright for browser workflows, and the appropriate native or existing test runner elsewhere.
- [ ] Attach executable test packs to approved recipes and components and supplement them with the application's explicit acceptance criteria. Framework documentation alone cannot define the application's correct business behavior.
- [ ] Exercise real application routes, middleware, validation, authorization, persistence, and service behavior in isolated test environments, including denied access, invalid inputs, persistence failures, and relevant concurrency cases.
- [ ] Run browser tests against the actual built or running application and its backend, verifying user actions and resulting persisted state instead of replacing the feature under test with mocked responses.
- [ ] Use external-service sandboxes or contract tests where appropriate and label test doubles and unverified boundaries. Do not make real payments, send client messages, or mutate production data simply to claim an end-to-end test passed.

### 35. Test integrity and automatic gap detection

- **Reuse:** Test discovery and normalized results.
- **Build:** Map changed contracts to required tests; detect zero tests, skipped cases and removed assertions. Use selected fault/mutation fixtures for critical protections.
- **UI:** Executed evidence, missing checks, heuristic gaps, unsupported analysis, flakes and retries.
- **Verify:** Remove a critical assertion and break a protection in fixtures; verify detection. Separate assertion failures from environment failures.

- [ ] Map changed features, operations, routes, and acceptance criteria to their tests and flag missing negative paths, assertions, integration coverage, and supported dependency combinations.
- [ ] Reject vacuous checks that only assert a mock was called, duplicate the implementation as the expected result, skip required cases, or claim success when no relevant tests ran. Allow legitimate isolated unit tests while labeling what they prove.
- [ ] For bug fixes, preserve a regression test that reproduces the failure before the fix when practical. Use selected mutation or fault-injection checks to establish whether important assertions catch broken behavior.
- [ ] Protect required checks and expected outcomes from being weakened to make a change pass. Review changes to tests and snapshots alongside the implementation and retain failures, skips, flaky retries, and unavailable environments in the report.
- [ ] Record the exact source revision, environment, dependency versions, commands, results, and evidence for each run. Report detected gaps and unsupported coverage explicitly; passing tests and high coverage do not prove all defects are absent.

### 36. Real performance and accessibility checks

- **Reuse:** Timeline/review/navigation benchmarks [E14], Playwright and Electron tracing.
- **Build:** Measure production-build baselines; run comparable serial scenarios; retain traces/raw samples; audit real accessibility interactions. Add Unlighthouse only for compatible target sites.
- **UI:** Build, scenario/device, measurements and coverage gaps.
- **Verify:** Large trees/diffs/timelines, input latency, scroll/selection, keyboard/focus and error states. Repeat noisy samples; no machine-dependent CI timing gates.

- [ ] Start with the existing production-build Playwright and Electron performance harness; add an Unlighthouse-based route audit only for compatible target websites, with representative public/authenticated pages and reproducible test data.
- [ ] Capture performance, accessibility, and related audit results with the tested URLs, source revision, browser, device profile, environment, and raw reports.
- [ ] Define project-specific budgets and compare regressions against a known baseline; repeat noisy measurements when needed rather than declaring a single score definitive.
- [ ] Pair page audits with real workflow checks for slow filters, large lists, navigation, loading behavior, keyboard access, and server/database bottlenecks relevant to the feature.
- [ ] Show functional tests and performance audits separately: an inaccessible route, failed login, or unaudited page remains a coverage gap, and a successful page audit does not prove business logic works.

### 37. Minimum necessary implementation

- **Reuse:** Repo Map, package exports and project style rules [E01], [E13].
- **Build:** Inspect ownership/consumers before adding code; minimize unrelated changes and dependencies; extract helpers for reuse or a named complex boundary. F22/F33 add enforcement.
- **UI:** Reuse evidence in existing task/review details.
- **Verify:** Reuse a real component/operation and pass behavior tests; retain validation, error handling and accessibility.

- [ ] Search the repository map, approved registry, framework APIs, and existing utilities before creating a new component, helper, dependency, or backend operation.
- [ ] Prefer composition, configuration, direct framework APIs, and existing abstractions; add only the code necessary to satisfy the requested behavior and tests.
- [ ] Flag unnecessary wrappers, duplicate state, unused exports, speculative abstractions, redundant dependencies, dead code, and unrelated changes using evidence-based checks.
- [ ] Optimize for readable, maintainable behavior rather than the fewest characters or lines. Do not remove validation, authorization, meaningful tests, or necessary error handling to satisfy a size or token target.
- [ ] Track changed lines, reused modules, new dependencies, complexity indicators, test results, and measured token usage together. Do not treat a smaller diff as proof of better quality or promise an unmeasured token reduction.

## Queued work, interruption recovery, and precise editing

### 38. Durable message queue instead of live steering

- **Reuse:** SessionInput admission/retry and SessionRunner serialization [E06].
- **Build:** Persist versioned messages/task IDs before acknowledgement; atomically claim after prior acceptance/reconciliation. Start with one task per Session. Add durable ownership; BackgroundJob remains process-local [E17].
- **UI:** Revision-checked edit/reorder/cancel; immediate pause/stop; task-linked clarification; explicit resolution for blocked/cancelled work.
- **Verify:** Enqueue/claim/admit crashes, duplicates, edit/claim races, competing schedulers, cancellation, order and conflicting retries.

- [ ] Queue ordinary messages submitted during an active task without changing that task's prompt or interrupting an in-flight model or tool operation; retain immediate user-controlled pause, stop, and cancel actions.
- [ ] Persist messages with stable IDs, exact text, attachment references, order, target project, and status before acknowledging that they were queued.
- [ ] Let users inspect, edit, reorder, or remove pending messages. Admit the next message as a separate task only after the active task finishes and its workspace state is reconciled, not after each model turn or tool call.
- [ ] Keep messages pending when the active task is blocked or cancelled until the user chooses how to proceed. Requests for necessary clarification remain visible and their explicitly linked answers can unblock the task without admitting unrelated queued work.
- [ ] Recover the queue after crashes or disconnections, deduplicate retried submissions, and distinguish queued, admitted, running, completed, cancelled, and uncertain states so work is not silently lost or executed twice.

### 39. Interruption recovery and unfinished-file tracking

- **Reuse:** F25/F21/F38 task records, session events and F08 revisions.
- **Build:** Journal intent/start/outcome/checks/reconciliation with pre/post hashes and idempotency keys. Compare actual state before replay; recover separately from model continuation.
- **UI:** Unverified files, pending checks, uncertain operations and source-linked resume data.
- **Verify:** Write/acknowledgement crash, partial edits, external edits, failed writes, intentional stop and non-repeatable side effects.

- [ ] Maintain a durable task journal with the task contract, intended operations, applied patches, source hashes, touched files, completed steps, pending checks, queue position, and tool outcomes.
- [ ] Track task-specific file states such as planned, editing, changed but unverified, validated, and unresolved. A saved file is not automatically a finished feature, and a multi-file operation can remain incomplete even when individual files parse.
- [ ] Detect disconnects, process exits, cancellations, failed writes, and missing tool acknowledgments. On recovery, compare the journal with the actual workspace and surface partial changes, external edits, and uncertain outcomes.
- [ ] Supply a compact recovery record to the agent showing what changed, which files and checks remain unfinished, and where to resume. Recover from recorded evidence instead of asking the model to reconstruct work from memory.
- [ ] Preserve intentional stops until the user resumes. Retry recoverable connectivity failures only under the configured policy, and reconcile uncertain mutations before retrying; never blindly repeat migrations, publishing, payments, or other side effects.

### 40. Targeted, revision-aware edits

- **Reuse:** Exact edits and conditional byte comparison [E05].
- **Build:** Read expected source; preview bounded patch; conditionally write; return diff. Preserve explicit replacement/formatter/generated-file workflows. Add F39 journal/F21 protection; current locks are process-local.
- **UI:** Existing Changes view with stale-source conflicts and task/revision links.
- **Verify:** Ambiguous/repeated text, stale bytes, CRLF/BOM, cooperating/external writers, large replacement and multi-file interruption.

- [ ] Provide first-class patch and structured edit tools that update the necessary lines or syntax nodes in existing files instead of asking the model to emit a complete replacement file.
- [ ] Bind edits to expected source hashes or precise matching context. Reject stale or ambiguous patches, reread the changed region, and preserve concurrent user edits instead of guessing the target.
- [ ] Preview and journal each patch with line changes and its result; use atomic file replacement where supported and reconcile interrupted multi-file edits through the task journal.
- [ ] Guard against accidental whole-file rewrites and unrelated formatting churn. Permit explicitly requested replacements, formatter changes, or generated outputs through an identified workflow, retaining the actual diff for review.
- [ ] Return compact success or failure details and only the changed or required source regions to the agent. Verify parsing, formatting, types, and behavior as appropriate without regenerating unchanged code or rerunning unrelated work without cause.

## One local application with automatic tool execution

### 41. App-managed local engines

- **Reuse:** Electron sidecar/preload/IPC [E12]; AppProcess/BackgroundJob execution and cancellation [E17].
- **Build:** Manifest: artifact/checksum, runtime/platform, health, storage, limits, cancellation, upgrade/rollback. Bundle a Bun worker for Bun-only code. Validate each engine independently.
- **UI:** Tools settings with lazy downloads, availability and storage; missing optional engines do not block other work.
- **Verify:** Packaged startup, offline mode, checksum/runtime errors, corrupt cache, crash, process cleanup, rollback and restricted IPC.

- [ ] Deliver supported MarkItDown, Semgrep, Headroom, Entire, and Grounded Docs capabilities incrementally inside ArezaCode after their individual compatibility and distribution gates pass. Users operate one application without configuring MCP servers, terminals, global packages, or separate services; an unavailable optional capability does not block unrelated work.
- [ ] Run compatible engines as internal libraries or isolated, app-managed child processes. Bundle approved binaries and required runtimes for supported platforms; use explicit versioned app-managed downloads for optional large assets. One application does not require forcing Python, JavaScript, and native engines into one process.
- [ ] Let ArezaCode own startup, shutdown, health checks, bounded concurrency, cancellation, version compatibility, upgrades, and rollback. Store indexes, journals, caches, and logs under the application's managed data directory rather than scattering generated files through projects.
- [ ] Expose one Tools view showing engine versions, availability, active jobs, recent results, storage usage, and failures. Prefer private IPC; bind any required HTTP service to loopback with restricted access. Keep existing external Codex or Claude configurations independent.
- [ ] Use licensed, reviewed engine builds and rule packs. Keep engine code and acceptance rules protected from agent edits, prevent package-manager downloads during routine model turns, and validate the bundled app without assuming the developer's globally installed tools exist.

| Engine | Automatic responsibility inside ArezaCode |
| --- | --- |
| MarkItDown | Convert supported attachments, reuse cached extraction, and return readable content or an explicit conversion failure. |
| Semgrep | Run relevant protected rules against candidate changes and return evidence used by the acceptance gate. |
| Headroom | Apply approved local context-reduction policies before provider requests while preserving retrievable originals and required evidence. |
| Entire | Capture supported session events and associate them with Git checkpoints without asking the model to manage capture commands. |
| Grounded Docs | Ingest approved official sources, preserve version/source metadata, refresh changed documentation, and serve a local index through internal calls or its CLI. MCP is optional for external clients. |

### 42. Deterministic workflows with minimal model involvement

- **Reuse:** Domain operations, task journal, checks and acceptance.
- **Build:** Validate input/permission; execute maintained operations; checkpoint; run checks; accept/pause. Deduplicate reads; reconcile mutations. Start with one application-owned workflow.
- **UI:** Step status, blockers and evidence; deterministic operations require no planning-model turn.
- **Verify:** Repeated triggers, interruption at each side effect, invalid inputs, failed steps and bounded retries.

- [ ] Implement routine workflows as maintained application code: attachment added triggers conversion; project registration or dependency changes trigger documentation/version reconciliation; relevant edits trigger indexing and checks; session events trigger capture; provider requests trigger validated context preparation.
- [ ] Use fixed schemas, explicit task types, project manifests, dependency versions, and protected policies to choose routine operations. The model must not regenerate conversion scripts, choose whether required checks run, or decide whether a failed acceptance gate can be ignored.
- [ ] Execute supported task types through predefined workflows: inspect current state, locate approved implementations, resolve required inputs, preview a bounded patch, apply it to the isolated candidate, run required checks, and submit the exact checked state for acceptance. Use model interpretation for ambiguous requests without treating an inferred task type as permission for unrelated changes.
- [ ] Cache work against content hashes, tool/rule versions, and dependency state. Schedule incremental refreshes, deduplicate jobs, preserve results through interruptions, and avoid launching a new worker or full scan for every small edit. Do not automatically publish, deploy, update dependencies, or perform unrelated external writes.
- [ ] Keep document normalization and keyword lookup non-generative by default. Keep model-based OCR, embeddings, reranking, or compression transforms explicitly configurable, with their resource use visible. Missing extraction or unavailable engines produce an honest incomplete state; required failures block acceptance rather than being hidden by an AI-generated replacement.
- [ ] Reserve model calls for understanding user intent and work that has no approved implementation. Serve compact local results and pretested recipes; let maintained code install compatible modules and apply validated patches. Prove routine conversion, lookup, checking, and capture with deterministic fixtures and observable operation logs without extra model calls.
- [ ] Retry only recoverable failures under a bounded policy. Detect repeated identical failures or patches and pause the failing workflow rather than burning tokens in a repair loop. Mechanical checks choose pass/fail for their defined constraints; an optional model review cannot override their results.

## Model routing, delegation, and verified retrieval

### 43. Automatic routing by task, capability, and total cost

- **Reuse:** Catalog.model.small/default/available, Integration and current model resolver [E09].
- **Build:** Use deterministic code where supported; otherwise select approved models by capability/budget. Bound escalation, preserve explicit model selection and keep auth/transport with existing owners.
- **UI:** Model/provider, routing reason, attempt cost and escalation.
- **Verify:** Unsupported tools/output, insufficient context, missing model, quota/budget failure, user override and total cost including routing/retries.

- [ ] Route supported mechanical requests to maintained workflows without a model call. Use a cheaper capable model for bounded interpretation, short answers, or commit-message drafting when generation is actually necessary; avoid invoking the premium orchestrator merely to select a worker.
- [ ] Classify requests through protected task definitions, repository state, affected operations, and risk. Use a small classifier only for unresolved ambiguity; a short prompt does not automatically mean an easy or low-risk task.
- [ ] Reserve strong models for complex implementation, architecture, merging, rebasing, conflict resolution, and failed or ambiguous work. Support the user's selected strong model, such as Astra when available through an authorized provider, without hard-coding an unavailable model or entitlement.
- [ ] Define per-task model allowlists, capability requirements, context limits, retry limits, escalation conditions, and spending budgets. Allow a user override within their permissions; workers cannot raise their own budgets or weaken required checks.
- [ ] Measure total task cost and time, including classification, delegation, repeated context, retries, and review. Show the chosen model, provider, routing reason, actual usage where available, and any escalation; validate savings against a fixed task set rather than assuming cheaper tokens mean cheaper completion.

### 44. Main orchestrator with bounded subagents

- **Reuse:** Current Sessions and parent/child metadata [E06]; legacy task behavior is reference only [E18].
- **Build:** Assign child scope, files, tools, context, budget and required evidence. Parallelize independent work; serialize overlapping writes/Git; reconcile results. Keep authorized Git operations deterministic.
- **UI:** Child ownership, status, cost and artifacts; cancellation reaches all active children.
- **Verify:** Conflicting writes, lost acknowledgement, cancellation/failure, budget escalation, parent retry and merged-state checks.

- [ ] Keep the main agent responsible for interpreting complex goals, dividing work, reconciling results, and checking acceptance evidence. Delegate routine bounded work to suitable cheaper workers instead of making the main agent execute every operation.
- [ ] Give each worker a task contract, owned paths or operations, required inputs, scoped tools, acceptance criteria, and a compact result schema. Send only necessary context and evidence, not the entire parent conversation by default.
- [ ] Execute authorized clean commit, tag, and push requests through app-controlled Git workflows with explicit target refs, state checks, and recorded outcomes. A cheap worker may prepare text; it does not decide what unrelated files to include or gain permission to force-push, replace tags, or overwrite user changes.
- [ ] Assign merge, rebase, and conflict reasoning to a strong agent while retaining the protected workspace and acceptance checks. Revalidate the exact resulting state before applying it; successful Git commands alone are not proof of correct behavior.
- [ ] Parallelize independent work within resource limits and serialize overlapping file writes and shared Git mutations. Worker delegation must not escape workspace isolation or grant broader access than the parent task.
- [ ] Link worker runs to the durable task journal, queue, cancellation state, token accounting, and unfinished-file records. Reconcile uncertain mutations before retrying and return concise results with retrievable evidence for orchestration.

### 45. Provider gateway and evaluated free-model pool

- **Reuse:** Native providers/catalog [E09]; optional OmniRoute adapter [W06]; refreshed OpenRouter metadata [W07].
- **Build:** Add a gateway only for a measured transport gap. Validate streaming/cancellation/usage/redaction; explicitly approve tested free models. Keep gateway UI and unsupported subscription credentials out.
- **UI:** Actual engine/model, quotas, availability and allowed fallback.
- **Verify:** Malformed/duplicate events, uncertain retries, exhausted capacity, gateway outage, double compression and unauthorized paid fallback.

- [ ] Evaluate OmniRoute as an optional app-managed provider gateway before building equivalent routing infrastructure. Keep task policy, permissions, budgets, and acceptance decisions inside ArezaCode; a gateway does not replace the supervisor.
- [ ] Before adoption, run a bounded integration spike proving authenticated tool calls, streaming, cancellation, rate-limit fallback, usage reporting, and credential redaction. Remove the adapter if it fails; do not transplant the entire gateway application merely to obtain routing.
- [ ] Refresh OpenRouter's model catalog automatically and identify currently zero-priced options from pricing metadata. Filter by required tools, structured output, context size, provider/data policy, and measured reliability; promote only tested models into the task allowlist.
- [ ] Treat free availability, quotas, and supported capabilities as changing data. Use bounded retries, circuit breakers, and explicit unavailable states; do not silently switch to a paid or unapproved provider when free capacity runs out.
- [ ] Keep credentials in protected application storage, redact logs, and send only task-necessary data to approved providers. Never use a gateway to disguise a client, reuse unsupported subscription credentials, or bypass provider access restrictions.
- [ ] Coordinate gateway transforms with Headroom so requests are not repeatedly compressed or stripped of required tool/schema evidence. Attribute tokens, latency, failures, and estimates to the actual provider/model used after fallback.

Research checked September 14, 2026: [OmniRoute](https://github.com/diegosouzapw/OmniRoute) is an MIT-licensed gateway candidate, not an integrated or benchmarked component. OpenRouter documents [free model variants](https://openrouter.ai/docs/guides/routing/model-variants/free) and a [free router](https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground) that selects randomly among compatible free models; ArezaCode still needs its own evaluated task allowlist.

### 46. App-managed web retrieval with source evidence

- **Reuse:** Native webfetch/websearch [E15]; shared source contract with F12.
- **Build:** Reuse fresh sources; otherwise fetch/search, extract and record final URL/time/hash/version/excerpt. Enforce proxy/DNS/redirect policy per hop. Use isolated rendering only when required.
- **UI:** Citations, retained source and freshness; distinguish blocked, authenticated and unavailable results.
- **Verify:** Internal redirects, DNS changes, size/decompression limits, missing proxy, stale cache, extraction failure, prompt injection and cancellation. Native localhost access requires a separate remote-fetch boundary.

- [ ] Require retrieved evidence for claims that depend on external web facts, current releases, pricing, availability, or official documentation. Do not present model recollection as a checked source; explicitly mark an answer unverified when retrieval fails.
- [ ] Use the local versioned documentation index when it satisfies the task's freshness requirement. Fetch or revalidate missing and stale sources, recording the URL, retrieval time, content hash, version, and useful excerpts so every task does not download the same site again.
- [ ] Provide maintained fetch, extraction, search, and browser operations rather than asking the model to generate scripts each time. Prefer direct official pages, repositories, and structured endpoints for static content; use an app-managed Camoufox worker when rendering or browser interaction is required.
- [ ] Support a configured proxy underneath retrieval and browser workers, with health checks, explicit routing status, and protected credentials. If required proxy routing is unavailable, report it and stop that operation rather than silently using a different route or claiming a proxy was used.
- [ ] Treat retrieved text as untrusted evidence, preserve source attribution, and keep website instructions from changing tool permissions or task policy. Respect access controls and surface blocked or authenticated sources instead of automatically attempting to bypass them.
- [ ] Return compact cited excerpts to workers and retain originals locally with bounded storage. Use freshness rules and cache revalidation to minimize network and model calls without claiming cached information is live.

[Camoufox's official usage documentation](https://camoufox.com/python/usage/) describes its browser interface and proxy configuration. This requirement adds managed retrieval to the backlog; it does not configure a proxy or install a browser now.

## Provider accounts and subscription-backed execution

### 47. Claude subscription access through the official Claude Code client

- **Reuse:** Account UI and task contracts; official Claude Code is a separate execution engine.
- **Build:** Run the unmodified published client with its own authentication in a scoped workspace; map run IDs; expose supported telemetry. Recheck distribution/auth terms [W10]; SDK access is not a subscription substitute.
- **UI:** Official-client versus API execution; direct user authentication and separate billing/limits.
- **Verify:** Client identity/version, login/logout, interactive prompts, process-tree cancellation, resume, escape attempts, missing telemetry and unauthorized API fallback.

- [ ] Add a Claude connection option alongside the Codex connection, with separate account state, sign-out, availability, and usage information. Clearly identify which execution engine handles each task.
- [ ] For subscription use, run the unmodified, published Claude Code client and launch Anthropic's own sign-in flow. Follow the applicable commercial terms and leave the client's authentication options intact; users authenticate and are billed directly under their own agreements.
- [ ] Do not implement a custom Claude.ai OAuth login, collect Claude session tokens, or route subscription credentials through ArezaCode's native model loop or OmniRoute. Direct provider integration uses supported API authentication unless Anthropic explicitly approves another arrangement.
- [ ] Integrate the official runner with scoped workspaces, task journals, cancellation, and recorded outputs through documented interfaces. Verify these boundaries in an integration spike before treating it as compatible with protected acceptance or the durable queue.
- [ ] Show subscription use and API billing separately, including any distinct limits for interactive and programmatic execution. Do not promise that a subscription is API credit or silently fall back to paid API usage.

Checked September 14, 2026: Anthropic distinguishes [running Claude Code in another product](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products) from [offering custom Claude.ai login](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use). The [Agent SDK documentation](https://code.claude.com/docs/en/agent-sdk/overview) also requires approved authentication for third-party products. This is a planned runner integration, not a working login feature.

## Shared interface requirements

- [ ] Use a simple repository selector and clear views for overview, files, changes, dependencies, tasks, and checks.
- [ ] Follow the requested charcoal, cream, and muted-blue visual direction with clear hierarchy, aligned chevrons, readable source text, and consistent controls.
- [ ] Reuse ArezaCode's existing SolidJS-compatible primitives. The earlier Base UI request applied to the standalone React interface; do not introduce a second UI framework solely to copy those controls.
- [ ] Keep live updates responsive through incremental work, lazy loading, pagination, and virtualization where needed; preserve selections and scroll position.
- [ ] Provide keyboard access, visible focus, understandable errors, and explicit live, stale, unknown, and incomplete states.


## Consolidated findings and release gates

### Execution and protection findings

| ID | Priority and evidence | Finding and implementation consequence | Features |
| --- | --- | --- | --- |
| R01 | High; [E05] | Path approval is not OS isolation. Restrict shell, subprocess, Git and connector capabilities. | F20–F25, F33 |
| R02 | High; [E06] | Native queued inputs remain in one Session. Separate tasks need a scheduler, task IDs and atomic claims. | F19, F38–F39 |
| R03 | High; [E17] | BackgroundJob and SessionRunCoordinator are process-local. Add durable task ownership and crash reconciliation. | F38–F44 |
| R04 | High; [E05] | Conditional writes use process-local locks. External edits and partial multi-file writes require reconciliation. | F21, F39–F40 |

### Repository data findings

| ID | Priority and evidence | Finding and implementation consequence | Features |
| --- | --- | --- | --- |
| R05 | High; [E02], [E12] | Repo Map uses bun:sqlite; Electron's server uses Node. Add a tested Bun worker or SQLite adapter. | F08, F41 |
| R06 | High; [E01], [E02] | Registration hashes the root; history rejects changed roots. Repository moves require identity/history migration. | F01, F07–F09 |
| R07 | High; [E02] | History triggers reject deletion. Define user deletion, retention, pinned evidence and blob GC. | F08–F09, F17 |
| R08 | Medium; [E01], [E03] | Parser caching still leads to watcher-triggered scans. Implement affected-file/edge updates with coherent revisions. | F01–F07 |

### Compatibility and source-of-truth findings

| ID | Priority and evidence | Finding and implementation consequence | Features |
| --- | --- | --- | --- |
| R09 | Medium; [E03] | Dependency discovery merges kinds and lacks complete lock/catalog semantics. Preserve kind and requested/locked/installed versions. | F10–F11 |
| R10 | High; [E04], [E16] | Current tools and legacy task/MCP/app paths coexist. Use current contracts with explicit adapters. | F05, F26–F27, F44–F47 |
| R11 | Medium; [E10] | SkillV2 caches by source key; local-file invalidation is unresolved. Invalidate after source updates. | F13–F14, F17 |
| R12 | Medium; [E04], [E08] | Output retention, context, usage and review already have owners. Extend their records/views. | F14–F17, F26–F30 |

### Integrations and UI findings

| ID | Priority and evidence | Finding and implementation consequence | Features |
| --- | --- | --- | --- |
| R13 | High; [E09] | Credential values use JSON storage; OS-keychain protection is unverified. Use secret references and redact captures/logs. | F17, F20, F41, F45, F47 |
| R14 | Medium; [W03], [W04], [E15] | Docs indexing, conversion and retrieval overlap. Share source contracts; make embeddings/model OCR optional. | F12, F28, F41, F46 |
| R15 | High; [W05] | Semgrep engine/rule licenses differ. Covered rules prohibit redistribution/service availability; ship licensed or self-authored rules. | F11, F22, F41 |
| R16 | Medium; [E11], [E14] | Solid/Kobalte, theme tokens, virtualization and benchmark infrastructure exist. Reuse them and follow benchmark rules. | F01–F11, F23, F32, F36 |
| R17 | Low; [E13] | Oxlint has three identical top-level `options` blocks. Remove duplicate declarations. | F11 |

### Integration checks

| Adapter | Required proof |
| --- | --- |
| MarkItDown / Grounded Docs | Bounded conversion, keyword lookup, source metadata, cancellation and pinned runtime. Limit archive/parser resources; verify optional embedding network use. [W03], [W04] |
| Semgrep | Pass/fail/error parsing; reviewed project rules; separate engine/rule license checks. [W05] |
| Headroom | Exact original retrieval, preserved errors/schemas, no repeated compression; compare total tokens, latency and correctness with unchanged output. [W11] |
| Entire | Fork-compatible session/checkpoint mapping; no duplicate capture or unrequested transcript push; independent save history. [W12] |
| Browser / gateway / Claude client | Permissions, cancellation, limits, redaction, restart and packaging. No unauthorized paid fallback or credential reuse. [W08], [W06], [W10] |

## Verification receipt

Reviewed September 14, 2026: local macOS, Bun `1.3.14`, OpenCode `1.18.30`, `dev` revision `228e9095ba3988a02664c3816cb51f98584e86c2`. Repo Map `0.1.0` was inspected from local source without Git history.

### Executed checks

| Working directory | Command | Result and boundary |
| --- | --- | --- |
| packages/core | `bun test --only-failures test/session-prompt.test.ts test/session-runner.test.ts test/tool-edit.test.ts test/file-mutation.test.ts test/tool-output-store.test.ts` | 144 passed / 5 files; declared provider/execution/permission doubles. |
| packages/client | `bun test test/import-boundaries.test.ts` | 1 passed / 1 file; Client runtime imports. |
| local repo-map prototype | `bun test tests/history.test.ts tests/indexer.test.ts` | 15 passed / 2 files; temporary filesystem/SQLite fixtures. |
| packages/core | `bun test --only-failures test/catalog.test.ts test/integration.test.ts test/credential.test.ts test/skill.test.ts test/background-job.test.ts test/snapshot.test.ts test/location-mutation.test.ts test/tool-webfetch.test.ts test/tool-websearch.test.ts test/system-context` | 96 passed / 12 files; isolated filesystem/database and HTTP doubles/loopback. |
| packages/app | `bun test --conditions=solid --only-failures --preload ./happydom.ts ./src/components/file-tree-v2-model.test.ts ./src/components/session/session-context-metrics.test.ts ./src/components/session/session-context-breakdown.test.ts ./src/pages/session/v2/review-diff-kinds.test.ts ./src/pages/session/session-panel-layout.test.ts` | 19 passed / 5 files; UI unit tests. |
| packages/app | `bun run test:browser` | 41 passed / 14 files; Happy DOM/browser-condition tests. |
| packages/core and packages/app, separately | `bun typecheck` | Both passed. |

**316 passed, 0 failed across 39 files; Core/App typechecks passed.** Results cover existing implementations across two review passes. Planned features remain unverified.

Not run: packaged UI/E2E, accessibility/performance measurements, OS-isolation tests, live providers/subscriptions, packaging, CI or production checks.

## Source evidence

### Repository and execution evidence

- [E01] — Repo Map inventory, parser caching, static edges and duplicate fingerprints; also inspect [parsers](/Users/artiomsgibnev/Documents/Coding/my/repo-map/src/parsers.ts:27) and [path-based registration](/Users/artiomsgibnev/Documents/Coding/my/repo-map/src/store.ts:15).
- [E02] — SQLite source revisions, compressed blobs and immutable-history triggers; [saved-text diff](/Users/artiomsgibnev/Documents/Coding/my/repo-map/src/file-diff.ts:24).
- [E03] — Dependency collection/checking; [merged dependency kinds](/Users/artiomsgibnev/Documents/Coding/my/repo-map/src/indexer.ts:138) and [watch/rescan scheduling](/Users/artiomsgibnev/Documents/Coding/my/repo-map/src/service.ts:40).
- [E04] — Canonical tool settlement; [tool architecture rules](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/tool/AGENTS.md:1) and [retained output](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/tool-output-store.ts:138).
- [E05] — Conditional file mutations; [exact edit](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/tool/edit.ts:24) and [path authority boundary](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/location-mutation.ts:10).
- [E06] — Current runner promotion/continuation; [durable input schema](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/session/sql.ts:143), [admission](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/session.ts:366) and [process-local coordinator](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/session/run-coordinator.ts:1).
- [E07] — Filesystem observation; [Git-backed snapshots](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/snapshot.ts:84).
- [E08] — Usage/event publication; [SystemContext](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/system-context/index.ts:197), [context epochs](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/session/context-epoch.ts:1) and [usage UI](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/app/src/components/session/session-context-tab.tsx:97).
- [E09] — Provider/model catalog; [integration/account handling](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/integration.ts:143), [credential storage](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/credential/sql.ts:6) and [model resolver](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/session/runner/model.ts:182).
- [E10] — Skills and source cache; [reference sources](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/reference.ts:39) and [plugin host](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/plugin/host.ts:21).

### UI, runtime and development evidence

- [E11] — Existing review composition; [virtualized file tree](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/app/src/components/file-tree-v2.tsx:146), [file-browser queries](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/app/src/pages/session/v2/session-file-browser-tab.tsx:33), [ButtonV2](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/ui/src/v2/components/button-v2.tsx:1) and [themes](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/ui/src/theme/context.tsx:1).
- [E12] — Electron utility-process server; [preload bridge](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/desktop/src/preload/index.ts:1) and [IPC owner](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/desktop/src/main/ipc.ts:65).
- [E13] — Root development and runtime direction; [app rules](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/app/AGENTS.md:1), [Oxlint](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/.oxlintrc.json:1) and [package scripts](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/package.json:1).
- [E14] — Performance methodology; [review scaling benchmark](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/app/e2e/performance/timeline/review-pane-scaling-benchmark.spec.ts:1) and [test workflow](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/.github/workflows/test.yml:1).
- [E15] — Native bounded web fetch; [web search](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/tool/websearch.ts:18).
- [E16] — Schema/current-contract boundaries; [Protocol session routes](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/protocol/src/groups/session.ts:106), [generated-client scripts](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/client/package.json:1), [import-boundary test](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/client/test/import-boundaries.test.ts:13) and [app event compatibility](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/app/src/context/server-sdk.tsx:29).
- [E17] — Explicitly process-local job registry; [process execution](/Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/process.ts:22).
- [E18] — Legacy task/subagent implementation, retained only as behavior reference; new orchestration must follow current Session ownership.

### Official integration references

Checked September 14, 2026. Pin and test shipped adapter versions.

- [W01] — OpenCode contribution expectations; [current development rules](https://github.com/anomalyco/opencode/blob/dev/AGENTS.md).
- [W02] — OpenCode canonical tool architecture and explicitly listed migration gaps.
- [W03] — Grounded Docs source/CLI, versioned documentation and optional embeddings.
- [W04] — MarkItDown formats, conversion architecture and optional integrations.
- [W05] — Semgrep Rules License; [engine and rule-license distinction](https://semgrep.dev/blog/2024/important-updates-to-semgrep-oss/).
- [W06] — OmniRoute candidate source; no integration or advertised savings validated here.
- [W07] — OpenRouter free-model behavior; refresh availability/pricing/capabilities rather than hardcoding a free pool.
- [W08] — Camoufox browser/proxy interface; managed browser packaging remains untested.
- [W09] — shadcn registry contract for compatible target-project adapters.
- [W10] — Claude Code product/authentication conditions; [Agent SDK authentication restrictions](https://code.claude.com/docs/en/agent-sdk/overview) must be checked separately.
- [W11] — Headroom compression/cache/retrieval design; ArezaCode still requires its own retrieval/correctness benchmark.
- [W12] — Entire session/checkpoint tooling; not a substitute for observed file-save history.

[E01]: /Users/artiomsgibnev/Documents/Coding/my/repo-map/src/indexer.ts:87
[E02]: /Users/artiomsgibnev/Documents/Coding/my/repo-map/src/history.ts:43
[E03]: /Users/artiomsgibnev/Documents/Coding/my/repo-map/src/dependencies.ts:11
[E04]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/tool/registry.ts:43
[E05]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/file-mutation.ts:144
[E06]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/session/runner/llm.ts:390
[E07]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/filesystem/watcher.ts:92
[E08]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/session/runner/publish-llm-event.ts:18
[E09]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/catalog.ts:47
[E10]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/skill.ts:108
[E11]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/app/src/pages/session/v2/review-panel-v2.tsx:57
[E12]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/desktop/src/main/server.ts:57
[E13]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/AGENTS.md:1
[E14]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/app/e2e/performance/AGENTS.md:1
[E15]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/tool/webfetch.ts:17
[E16]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/schema/AGENTS.md:1
[E17]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/core/src/background-job.ts:116
[E18]: /Users/artiomsgibnev/Documents/Coding/Areza/areza-code/packages/opencode/src/tool/task.ts:1
[W01]: https://github.com/anomalyco/opencode/blob/dev/CONTRIBUTING.md
[W02]: https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/core/src/tool/AGENTS.md
[W03]: https://github.com/arabold/docs-mcp-server
[W04]: https://github.com/microsoft/markitdown
[W05]: https://semgrep.dev/legal/rules-license/
[W06]: https://github.com/diegosouzapw/OmniRoute
[W07]: https://openrouter.ai/docs/guides/routing/model-variants/free
[W08]: https://camoufox.com/python/usage/
[W09]: https://ui.shadcn.com/docs/registry
[W10]: https://code.claude.com/docs/en/legal-and-compliance
[W11]: https://github.com/headroomlabs-ai/headroom/blob/main/docs/content/docs/ccr.mdx
[W12]: https://github.com/entireio/cli
