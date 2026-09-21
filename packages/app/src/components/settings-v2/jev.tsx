import { For, onMount, onCleanup, createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
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
  const engines = () => engineResource.error ? [] : engineResource.latest
  const [state, setState] = createStore({ error: "" })
  const timer = setInterval(() => { if (engines().some((engine) => engine.running)) void Promise.resolve(refresh.refetch()).catch(() => {}) }, 2000)
  onCleanup(() => clearInterval(timer))
  const action = async (engineID: typeof Integration.EngineID.Type, action: typeof Integration.EngineAction.Type["action"]) => {
    setState("error", "")
    await sdk().tools.toolsAction({ engineID, action })
      .then((value) => refresh.mutate(value))
      .catch(() => setState("error", language.t("tools.failed")))
  }
  return (
    <div data-testid="tools-settings" aria-busy={engineResource.loading}>
      <div class="settings-v2-tab-header"><h2 class="settings-v2-tab-title">{language.t("tools.title")}</h2></div>
      <div class="settings-v2-tab-body">
      <section class="settings-v2-section">
      <p class="mb-4 text-13 text-text-weak">{language.t("tools.description")}</p>
      <Show when={engineResource.loading && !engines().length}><p role="status" class="text-13 text-text-weak">{language.t("common.loading")}</p></Show>
      <Show when={engineResource.error || state.error}><p role="alert" class="text-13 text-text-danger-base mb-3">{state.error || language.t("tools.unavailable")}</p></Show>
      <SettingsListV2>
        <For each={engines()}>{(engine) => (
          <SettingsRowV2 title={language.t(`tools.${engine.id}`)} description={
            <span>{engine.version} · {language.t("tools.storage", { size: Math.round(engine.storageBytes / 1024 / 1024) })} · {language.t(engine.running ? "tools.running" : engine.managed ? "tools.managed" : engine.installed ? "tools.external" : "tools.missing")}
              <Show when={engine.error}><span role="alert" class="block text-text-danger-base">{engine.error}</span></Show>
              <Show when={engine.lastResult}><span class="block">{language.t("tools.lastAction")}: {engine.lastResult}</span></Show>
            </span>
          }>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <Show when={engine.id !== "ponytail" && engine.id !== "context7"}>
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
