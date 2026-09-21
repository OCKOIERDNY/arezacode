import { For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { EmptyState } from "@opencode-ai/ui/empty-state"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { useProjectServices } from "@/hooks/use-project-services"

export function SessionServerPanel(props: { active: boolean; onPreview: (url: string) => void }) {
  const language = useLanguage()
  const services = useProjectServices(() => props.active)
  return (
    <div class="flex flex-col h-full min-h-0" data-component="session-servers">
      <div class="flex items-center justify-between gap-2 p-4 shrink-0">
        <span class="text-14-medium text-text-strong">{language.t("session.servers.title")}</span>
        <Button
          variant="ghost"
          size="small"
          disabled={!services.available() || services.store.loading}
          onClick={() => void services.refresh()}
        >
          {language.t(services.store.loading ? "common.loading" : "session.panel.refresh")}
        </Button>
      </div>
      <ScrollView class="flex-1 min-h-0" viewportClass="flex flex-col px-4 pb-4">
        <Show
          when={services.available()}
          fallback={
            <EmptyState
              icon={<Icon name="server" />}
              title={language.t("session.servers.title")}
              description={language.t("session.servers.desktop")}
            />
          }
        >
          <Show when={services.store.failed || services.store.stopFailed}>
            <p role="alert" class="mb-3 text-13-regular text-text-weak">
              {language.t(services.store.stopFailed ? "session.servers.stopError" : "session.servers.error")}
            </p>
          </Show>
          <Show when={services.store.data?.processes === "unavailable"}>
            <p class="mb-3 text-13-regular text-text-weak">{language.t("session.servers.processUnavailable")}</p>
          </Show>
          <Show when={services.store.data && services.store.data.docker !== "available"}>
            <p class="mb-3 text-13-regular text-text-weak">
              {language.t(
                services.store.data?.docker === "remote"
                  ? "session.servers.dockerRemote"
                  : "session.servers.dockerUnavailable",
              )}
            </p>
          </Show>
          <Show when={services.store.data && !services.store.data.services.length}>
            <EmptyState
              icon={<Icon name="server" />}
              title={language.t("session.servers.empty.title")}
              description={language.t("session.servers.empty")}
            />
          </Show>
          <For each={services.store.data?.services}>
            {(service) => (
              <div
                class="flex flex-col gap-2 py-4 border-b border-border-weaker-base last:border-0"
                data-service-kind={service.kind}
              >
                <div class="flex items-center gap-2 min-w-0">
                  <Icon name={service.kind === "container" ? "server" : "terminal"} size="small" />
                  <span class="text-13-medium text-text-strong flex-1 truncate" title={service.name}>
                    {service.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={!!services.store.stopping}
                    onClick={() => void services.stop(service.id)}
                  >
                    {language.t(
                      services.store.stopping === service.id ? "session.servers.stopping" : "session.browser.stop",
                    )}
                  </Button>
                </div>
                <span class="text-12-regular text-text-weak">
                  {language.t(service.kind === "container" ? "session.servers.container" : "session.servers.process")}
                  {service.pid ? ` · ${language.t("session.servers.pid", { pid: service.pid })}` : ""}
                  {service.ports.length ? ` · ${service.ports.join(", ")}` : ""}
                </span>
                <For each={service.urls}>
                  {(url) => (
                    <button
                      class="flex items-center gap-2 text-13-regular text-text-interactive-base hover:underline text-left"
                      onClick={() => props.onPreview(url)}
                    >
                      <Icon name="window-cursor" size="small" />
                      <span class="truncate">{url.replace(/\/$/, "")}</span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </ScrollView>
    </div>
  )
}
