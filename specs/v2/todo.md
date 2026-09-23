# TODO

ok we need to work towards a launch of v2 so we can get out of this rebuild phase

## Post-Hono cleanup - Kit

The opencode server has moved to the Effect HttpApi backend. Remaining work is
mostly cleanup: delete compatibility shims, shrink Zod surfaces, and simplify
test harnesses that used to compare Hono and HttpApi behavior.

## New Data Mode - Dax

This is mostly done. I'm working through modeling subagents, skill invocations
and shell commands.

## Rework agent loop - Kit?

The first Effect-native local runner slice is implemented without bridging
through legacy `SessionPrompt.loop(...)`:

- process-global `SessionExecution.resume(sessionID)` discovers Location from
  the Session read model
- cached Location-scoped `SessionRunner` resolves one supported catalog model
  and issues one explicit `llm.stream(request)` provider turn at a time
- durable V2 projections record text, reasoning, provider failures, tool calls,
  tool results, and assistant output
- a scoped `ToolRegistry` advertises definitions and the first permission-checked
  `read` built-in
- local continuation reloads projected history, and promoting new user input resets the selected agent's configured provider-turn allowance
- concurrent resumes for one Session join one process-local run while different
  Sessions remain concurrent

Prompt admission now uses a durable `session_input` inbox rather than immediate
transcript projection. `steer` inputs promote at the next safe provider-turn
boundary while the current drain requires continuation. `queue` inputs remain in
a FIFO until the Session would otherwise become idle and then promote one at a time.

Next reviewed slices:

- preserve eager structured local-tool settlement: durably record each complete
  call, start its child execution immediately, await every settlement after the
  provider turn closes, then reload projected history once
- revisit per-turn tool-call limits, output truncation, and operational
  backpressure before broadening exposure; eager local execution is deliberately
  unbounded in the current local slice while SQLite publication stays serialized
- remove the public in-memory `@opencode-ai/llm` tool loop after replacing its
  remaining one-turn native-adapter use with a narrow typed dispatcher
- batch streamed deltas and add covering context indexes
- expose replayable Session event cursors over HTTP and the generated SDK where remote consumers need them
- integrate the new BackgroundJob service with V2 tool execution: support background
  bash jobs and background agent dispatch with durable status observation,
  completion delivery, and explicit cancellation / continuation semantics
- add durable/clustered interruption, retries, and stale-owner fencing only as
  their slices become concrete

### Deferred durable continuation recovery

Do not infer that ambiguous provider work is safe to retry from an advisory wake.
The first inbox-driven runner intentionally omits outer provider-attempt markers
until they have a concrete consumer and a complete recovery policy.

Design post-crash continuation recovery as one explicit slice. It should model:

- promoted input and projected-history state
- queued-input promotion and steering assignment
- provider-attempt preparation versus provider-dispatch ambiguity
- required post-tool continuation across process loss
- explicit `retry` and `abandon` decisions for unknown outcomes
- bounded automatic retry only where provider and tool idempotency make it safe
- retry budget, backoff, visible recovery status, startup discovery, and future
  clustered ownership fencing

Do not introduce an enclosing durable execution identity solely to group these
facts; a process-local Session drain has no durable transcript boundary.

## Plugin API design - James?

We need to figure out how we want server plugins to work and what hooks are useful.

Some ideas:

- plugins get immer drafts so bad mutations can be thrown away
- plugins get global "opencode" instance like in that post i showed
- opencode instance has stuff like `opencode.session.prompt()` or
  `opencode.tool.register({...})`

## Rework Config - ???

We should do another pass on config to clean up any mistakes we made with it and
simplify as much as possible. Old configs should get auto-converted to new

## Auth - ???

I have a basic auth system that can track any kind of auth, not just providers

## Model Database - ???

I have a basic model service that allows for models to be registered dynamically

## Provider - ???

Providers should register as plugins and autoload based on whatever logic they
want / config. They should register models into model database

## Event - Kit

The self-contained durable `EventV2` core service is implemented. It owns
sync-versioned persistence, transactional sequencing, pub/sub, replay, and
replay-owner claims without relying on the old bus system.

Remaining slices:

- expose the embedded consumer-facing Session cursor API over HTTP and the
  generated SDK where remote consumers need it
- keep replay-owner claims distinct from future clustered Session execution
  ownership and stale-runtime fencing

## Deferred hardening cleanup

Keep these visible, but do not block functionality slices on them unless a concrete
failure appears during canary work:

- serialize database migration claiming across processes; current migration
  application is protected only by an in-process semaphore, so two processes
  starting against one SQLite database can still race
- simplify process-local durable-tail wake lifecycle with Effect `RcMap` and one
  shared `PubSub.sliding<void>(1)` per active aggregate; keep SQLite cursor replay
  and subscribe-before-history semantics unchanged
- page large durable aggregate replay reads instead of loading every row after a
  stale cursor into one array
- decide whether connected tails need a periodic polling fallback for
  cross-process SQLite writers; current advisory wakes are intentionally
  process-local
- stream-cap websearch body collection before parsing
- add ripgrep execution timeout and bounded line framing
- materialize or consistently reject unresolved URL and file attachment sources
- decide stateless OpenAI Responses hosted-tool continuation behavior; reconstructed hosted output can replay as a stored `item_reference` when `store !== false`, while `store: false` intentionally omits the unavailable reference path
- decide whether to preserve deprecated `@opencode-ai/llm` orchestration exports
- preserve or alias renamed filesystem SDK generated type names if compatibility
  consumers require them
- revisit syscall-level mutation confinement for hostile external processes
  (`openat`, `O_NOFOLLOW`, and descriptor-relative mutation where supported)

## Everything is hotreloadable - ???

Instead of needing to tear down things when something changes every service should emit granular events so services can react to them and reconfigure themselves. Allows frontend to receive these too, eg model.added. also prevents startup from blocking

## ArezaCode product backlog

- [ ] Project-level shared components: let the agent create and maintain reusable components within a project. Discover and reuse existing components before creating new ones.
- [ ] Project overview dashboard: provide a central overview of each project's work and current status.
- [ ] Compacting message display: stop rendering the full internal compaction summary as a normal chat reply. Show a compact, collapsed entry with details available on demand while retaining the summary for model context.
- [ ] Cross-project component library: let users ask the agent to create a reusable component, such as a React component, and save it in a persistent library for use in any project. Keep it distinct from project-local components and record its framework, dependencies, and usage so the agent can find and reuse it appropriately.
- [ ] Fix expanded file-diff scrolling: keep the diff within the available panel height and allow wheel/trackpad scrolling so content below the viewport remains reachable.
- [ ] Fix the OpenCode Zen accordion in Models settings opening and immediately closing when entering the page.
- [ ] Right-side Markdown editor and preview: create, open, edit, save, and preview project `.md` files, including to-do lists, in the existing right-side tabs. Make Markdown file links in chat open the corresponding file there; support editing checklist items and switching between source and rendered preview using shared file-panel components.
- [ ] Multi-agent view and request scheduling: show up to four simultaneous agent chats and their running/queued status. Requests sent while an agent is working should queue automatically and start after its current request finishes. Add a button beside each queued message to move it into a new chat and run separately, removing it from the original queue so it executes only once. Enforce the four-chat concurrency limit and preserve queued requests when capacity is full.
- [ ] Accurate connection errors: when sending a message without internet, show a clear offline/connection error instead of reporting that JEV could not identify a model. Distinguish network failures from model-selection failures and preserve the unsent message for retry.
- [ ] Interrupted-run recovery: persist the transcript and execution progress incrementally so manual stops, timeouts, provider failures, and app crashes retain the last known state. Show where the run stopped, completed and pending work, and any tool action with an unknown outcome. Let the user resume with that context without blindly repeating actions that may already have completed.
- [ ] Reusable implementation guides: add browsable, editable documentation in the app that the agent retrieves when building a matching feature, such as magic-link authentication. Cover the complete flow, validation, security, error/loading/success states, layout, accessibility, animations, and relevant tests. Adapt guides to the project's installed framework versions and existing components/backend logic, reuse what exists, and ask for missing product decisions instead of guessing. Support shared guides with project-specific overrides and keep their sources and version applicability visible.
- [ ] Fix chat composer lag and freezing when pasting large amounts of text. Reproduce with large pastes, identify expensive input/rendering work, and keep typing, scrolling, and submission responsive without losing or silently truncating content.
- [ ] Shared AI writing rules: instruct agents to avoid em dashes unless explicitly requested and reduce stock AI phrasing, repetitive summaries, unnecessary headings, and filler. Apply the rules to generated prose and support safe mechanical cleanup where appropriate, preserving meaning and leaving code, commands, URLs, verbatim quotes, and user-provided text unchanged. Honor explicit user style overrides.

## Commit workflow

- Group commits by logical feature, bug fix, or independently useful change, not by file, package, or everything edited in one session.
- Keep the implementation, its regression tests, required generated files, and directly related documentation together. A feature spanning Schema, Core, Protocol, Server, Client, and App belongs in one coherent commit when those changes must ship together.
- Separate unrelated fixes, formatting, refactors, dependency upgrades, and backlog updates. For example, a large-paste fix, a file-diff scrolling fix, and general backlog documentation should be separate commits.
- Put shared prerequisites before dependent features. Each commit should leave the repository coherent, pass the relevant checks, and be understandable and reversible on its own.
- Inspect `git status`, the complete diff, and recent commit messages before staging. Stage only the files or changes belonging to the current group; preserve unrelated work and exclude secrets and local artifacts.
- Use conventional messages in the form `type(scope): summary`, such as `fix(app): preserve large pasted drafts` or `feat(core): add queued request recovery`. Describe the behavior changed, not just the files touched.
- Review the staged diff and run focused checks for that group before committing. Record any checks that were not performed, including manual visual verification.
- Commit, push, and tag only when requested. Push the completed commit sequence to the requested branches without rewriting published history. Tag the final intended release commit after its constituent changes and checks are complete.
