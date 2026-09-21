import { onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels, type ModelKey } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"

export function useSettingsModels() {
  const models = useModels()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const jev = () => serverSDK().jev
  const isJev = (key: ModelKey) => key.providerID === "openrouter" && key.modelID === "~typesafe/jev-latest"
  onMount(() => void jev().refresh())

  return {
    list: () => [
      ...models.list().filter((item) => !isJev({ providerID: item.provider.id, modelID: item.id })),
      ...(jev().state.configured
        ? [{ id: "~typesafe/jev-latest", name: language.t("jev.model"), provider: { id: "openrouter", name: "OpenRouter" } }]
        : []),
    ],
    visible: (key: ModelKey) => isJev(key) ? jev().state.enabled : models.visible(key),
    disabled: (key: ModelKey) => isJev(key) && (!jev().state.loaded || jev().state.saving || jev().state.error),
    setVisibility(key: ModelKey, enabled: boolean) {
      if (isJev(key)) return void jev().update({ enabled })
      models.setVisibility(key, enabled)
    },
  }
}
