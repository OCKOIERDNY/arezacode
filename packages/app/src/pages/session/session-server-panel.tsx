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
          <Show when={services.store.failed || services.store.stopFailed || services.store.startFailed}>
            <p role="alert" class="mb-3 text-13-regular text-text-weak">
              {language.t(
                services.store.startFailed
                  ? "session.servers.startError"
                  : services.store.stopFailed
                    ? "session.servers.stopError"
                    : "session.servers.error",
              )}
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
          <For each={services.store.data?.launchers}>
            {(launcher) => (
              <div
                class="flex items-center gap-3 py-4 border-b border-border-weaker-base"
                data-service-launcher={launcher.id}
              >
                <Icon name={launcher.id === "launch:compose" ? "server" : "terminal"} size="small" />
                <div class="flex-1 min-w-0">
                  <div class="text-13-medium text-text-strong">
                    {language.t(launcher.id === "launch:compose" ? "session.servers.compose" : "session.servers.dev")}
                  </div>
                  <div class="text-12-regular text-text-weak truncate" title={launcher.command}>
                    {launcher.command}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={
                    !!services.store.starting ||
                    !!services.store.stopping ||
                    (launcher.id === "launch:compose" && services.store.data?.docker !== "available")
                  }
                  onClick={() => void services.start(launcher.id)}
                >
                  {language.t(
                    services.store.starting === launcher.id ? "session.servers.starting" : "session.servers.start",
                  )}
                </Button>
              </div>
            )}
          </For>
          <Show
            when={services.store.data && !services.store.data.services.length && !services.store.data.launchers?.length}
          >
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
                    disabled={!!services.store.stopping || !!services.store.starting}
                    onClick={() =>
                      void (service.running === false ? services.start(service.id) : services.stop(service.id))
                    }
                  >
                    {language.t(
                      services.store.starting === service.id
                        ? "session.servers.starting"
                        : services.store.stopping === service.id
                          ? "session.servers.stopping"
                          : service.running === false
                            ? "session.servers.start"
                            : "session.browser.stop",
                    )}
                  </Button>
                </div>
                <span class="text-12-regular text-text-weak">
                  {language.t(service.kind === "container" ? "session.servers.container" : "session.servers.process")}
                  {service.pid ? ` · ${language.t("session.servers.pid", { pid: service.pid })}` : ""}
                  {service.ports.length ? ` · ${service.ports.join(", ")}` : ""}
                  {service.running !== undefined
                    ? ` · ${language.t(service.running ? "session.servers.running" : "session.servers.stopped")}`
                    : ""}
                </span>
                <Show when={service.failed}>
                  <p role="alert" class="text-12-regular text-text-weak">
                    {language.t("session.servers.exited")}
                  </p>
                </Show>
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
