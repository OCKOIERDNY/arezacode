import { For, onMount, onCleanup, createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import type { Integration } from "@opencode-ai/schema/integration"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export function SettingsTools() {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [engineResource, refresh] = createResource(() => sdk().scope, () => sdk().tools.toolsList(), { initialValue: [] })
  const [sourceResource, sourceActions] = createResource(() => sdk().scope, () => sdk().tools.docsList(), { initialValue: [] })
  const engines = () => engineResource.error ? [] : engineResource.latest
  const sources = () => sourceResource.error ? [] : sourceResource.latest
  const [state, setState] = createStore({ library: "", version: "", url: "", query: "", busy: false, error: "", result: "" })
  let operation: AbortController | undefined
  const timer = setInterval(() => { if (engines().some((engine) => engine.running)) void Promise.resolve(refresh.refetch()).catch(() => {}) }, 2000)
  onCleanup(() => { clearInterval(timer); operation?.abort() })
  const action = async (engineID: typeof Integration.EngineID.Type, action: typeof Integration.EngineAction.Type["action"]) => {
    setState("error", "")
    await sdk().tools.toolsAction({ engineID, action })
      .then((value) => refresh.mutate(value))
      .catch(() => setState("error", language.t("tools.failed")))
  }
  const docs = async (kind: "index" | "search" | "remove", source = { library: state.library, version: state.version, url: state.url }) => {
    if (state.busy) return
    operation = new AbortController()
    setState({ busy: true, error: "", result: "" })
    const api = sdk().tools
    const options = { signal: operation.signal }
    await (kind === "index" ? api.docsIndex(source, options) : kind === "remove" ? api.docsRemove(source, options)
      : api.docsSearch({ library: source.library, version: source.version, query: state.query }, options))
      .then((result) => setState("result", result))
      .catch(() => setState("error", language.t(operation?.signal.aborted ? "tools.cancelled" : "tools.docsFailed")))
    await Promise.resolve(sourceActions.refetch()).catch(() => {})
    setState("busy", false)
  }
  return (
    <div data-testid="tools-settings" aria-busy={engineResource.loading || sourceResource.loading}>
      <div class="settings-v2-tab-header"><h2 class="settings-v2-tab-title">{language.t("tools.title")}</h2></div>
      <div class="settings-v2-tab-body">
      <section class="settings-v2-section">
      <p class="mb-4 text-13 text-text-weak">{language.t("tools.description")}</p>
      <Show when={engineResource.loading && !engines().length}><p role="status" class="text-13 text-text-weak">{language.t("common.loading")}</p></Show>
      <Show when={engineResource.error || sourceResource.error || state.error}><p role="alert" class="text-13 text-text-danger-base mb-3">{state.error || language.t("tools.unavailable")}</p></Show>
      <SettingsListV2>
        <For each={engines()}>{(engine) => (
          <SettingsRowV2 title={language.t(`tools.${engine.id}`)} description={
            <span>{engine.version} · {language.t("tools.storage", { size: Math.round(engine.storageBytes / 1024 / 1024) })} · {language.t(engine.running ? "tools.running" : engine.managed ? "tools.managed" : engine.installed ? "tools.external" : "tools.missing")}
              <Show when={engine.error}><span role="alert" class="block text-text-danger-base">{engine.error}</span></Show>
              <Show when={engine.lastResult}><span class="block">{language.t("tools.lastAction")}: {engine.lastResult}</span></Show>
            </span>
          }>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <Show when={engine.id !== "ponytail"}>
                <ButtonV2 size="small" variant="ghost" disabled={engine.running} onClick={() => void action(engine.id, "install")}>{language.t(engine.managed ? "tools.reinstall" : "tools.install")}</ButtonV2>
                <Show when={engine.installed}><ButtonV2 size="small" variant="ghost" disabled={engine.running} onClick={() => void action(engine.id, "check")}>{language.t("tools.check")}</ButtonV2></Show>
                <Show when={engine.rollback}><ButtonV2 size="small" variant="ghost" disabled={engine.running} onClick={() => void action(engine.id, "rollback")}>{language.t("tools.rollback")}</ButtonV2></Show>
                <Show when={engine.running}><ButtonV2 size="small" variant="ghost" onClick={() => void action(engine.id, "cancel")}>{language.t("common.cancel")}</ButtonV2></Show>
              </Show>
              <Switch hideLabel checked={engine.enabled} disabled={!engine.installed} onChange={(value) => void action(engine.id, value ? "enable" : "disable")}>{language.t(`tools.${engine.id}`)}</Switch>
            </div>
          </SettingsRowV2>
        )}</For>
      </SettingsListV2>
      </section>
      <Show when={engines()?.some((engine) => engine.id === "grounded" && engine.installed && engine.enabled)}>
        <section class="settings-v2-section mt-6" data-testid="grounded-docs-settings">
          <h3 class="settings-v2-section-title">{language.t("tools.docsTitle")}</h3>
          <p class="text-13 text-text-weak mb-3">{language.t("tools.docsDescription")}</p>
          <form class="flex flex-col gap-2 [&_[data-component=text-input-v2]]:w-full" onSubmit={(event) => { event.preventDefault(); void docs("index") }}>
            <TextInputV2 required aria-label={language.t("tools.library")} placeholder={language.t("tools.library")} value={state.library} onInput={(event) => setState("library", event.currentTarget.value)} />
            <TextInputV2 required aria-label={language.t("tools.version")} placeholder={language.t("tools.version")} value={state.version} onInput={(event) => setState("version", event.currentTarget.value)} />
            <TextInputV2 required type="url" aria-label={language.t("tools.url")} placeholder={language.t("tools.url")} value={state.url} onInput={(event) => setState("url", event.currentTarget.value)} />
            <div class="flex gap-2"><ButtonV2 type="submit" size="small" disabled={state.busy}>{language.t("tools.index")}</ButtonV2>
              <Show when={state.busy}><ButtonV2 type="button" size="small" variant="ghost" onClick={() => operation?.abort()}>{language.t("common.cancel")}</ButtonV2></Show>
            </div>
          </form>
          <Show when={sources()?.length}><SettingsListV2><For each={sources()}>{(source) => <SettingsRowV2 title={`${source.library} ${source.version}`} description={<span>{source.url}<Show when={source.error}><span role="alert" class="block text-text-danger-base">{source.error}</span></Show></span>}>
            <div class="flex gap-2"><ButtonV2 size="small" variant="ghost" disabled={state.busy} onClick={() => { setState({ library: source.library, version: source.version, url: source.url }); void docs("index", source) }}>{language.t("tools.refresh")}</ButtonV2>
              <ButtonV2 size="small" variant="ghost" disabled={state.busy} onClick={() => void docs("remove", source)}>{language.t("tools.remove")}</ButtonV2></div>
          </SettingsRowV2>}</For></SettingsListV2></Show>
          <form class="flex gap-2 mt-3" onSubmit={(event) => { event.preventDefault(); void docs("search") }}>
            <TextInputV2 required aria-label={language.t("tools.query")} placeholder={language.t("tools.query")} value={state.query} onInput={(event) => setState("query", event.currentTarget.value)} />
            <ButtonV2 type="submit" size="small" disabled={state.busy || !state.library || !state.version}>{language.t("tools.search")}</ButtonV2>
          </form>
          <Show when={state.result}><pre class="whitespace-pre-wrap break-all text-12 mt-3" role="status">{state.result}</pre></Show>
        </section>
      </Show>
      <SettingsJev />
      </div>
    </div>
  )
}

export function SettingsJev() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const jev = () => serverSDK().jev
  onMount(() => void jev().refresh())
  return (
    <Show when={jev().available()}>
    <div class="settings-v2-section" data-testid="jev-settings">
      <h3 class="settings-v2-section-title">{language.t("jev.title")}</h3>
      <SettingsListV2>
        <SettingsRowV2 title={language.t("jev.name")} description={language.t("jev.description")}>
          <Switch
            hideLabel
            checked={jev().state.enabled}
            disabled={!jev().state.loaded || jev().state.saving || jev().state.error}
            onChange={(enabled) => void jev().update({ enabled })}
          >
            {language.t("jev.enable")}
          </Switch>
        </SettingsRowV2>
        <SettingsRowV2
          title={language.t("jev.provider")}
          children={null}
          description={language.t(
            jev().state.error ? "jev.unavailable" : jev().state.configured ? "jev.configured" : "jev.missingKey",
          )}
        />
        <SettingsRowV2 title={language.t("jev.model")} description={language.t("jev.modelDescription")} children={null} />
        <For each={["skills", "context", "findings", "routing"] as const}>
          {(feature) => (
            <SettingsRowV2 title={language.t(`jev.${feature}`)} description={language.t(`jev.${feature}Description`)}>
              <Switch
                hideLabel
                checked={jev().state[feature]}
                disabled={!jev().state.loaded || jev().state.saving || jev().state.error}
                onChange={(enabled) => void jev().update({ [feature]: enabled })}
              >
                {language.t(`jev.${feature}`)}
              </Switch>
            </SettingsRowV2>
          )}
        </For>
      </SettingsListV2>
    </div>
    </Show>
  )
}
