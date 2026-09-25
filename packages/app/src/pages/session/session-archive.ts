import { useNavigate } from "@solidjs/router"
import { produce } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useTabs } from "@/context/tabs"
import { errorMessage } from "@/pages/layout/helpers"
import { useSessionKey } from "@/pages/session/session-layout"
import { legacySessionHref, requireServerKey, sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"

export function useSessionArchive() {
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const tabs = useTabs()
  const { params } = useSessionKey()

  const navigateAfterRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    const href = (id: string) =>
      params.serverKey ? sessionHref(requireServerKey(params.serverKey), id) : legacySessionHref(sdk().directory, id)
    if (parentID) {
      navigate(href(parentID))
      return
    }
    if (nextSessionID) {
      navigate(href(nextSessionID))
      return
    }
    if (params.serverKey) {
      tabs.newDraft({ server: requireServerKey(params.serverKey), directory: sdk().directory })
      return
    }
    navigate(`/${params.dir}/session`)
  }

  const archive = async (sessionID: string) => {
    const target = {
      sdk: sdk(),
      sync: sync(),
      serverSync: serverSync(),
      server: ServerConnection.key(serverSDK().server),
    }
    const session = target.sync.session.get(sessionID)
    if (!session) return
    if ((await target.sdk.protocol) !== "v1") return

    const sessions = target.sync.data.session ?? []
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await target.sdk.client.session
      .update({ sessionID, directory: target.sdk.directory, time: { archived: Date.now() } })
      .then(() => {
        target.sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === sessionID)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        target.sync.session.evict(sessionID)
        target.serverSync.homeSessions.remove(sessionID)
        const open = tabs.store.some(
          (tab) => tab.type === "session" && tab.server === target.server && tab.sessionId === sessionID,
        )
        tabs.removeSessions({ server: target.server, directory: target.sdk.directory, sessionIDs: [sessionID] })
        if (!open && sdk() === target.sdk) navigateAfterRemoval(sessionID, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
  }

  return { archive, navigateAfterRemoval }
}
