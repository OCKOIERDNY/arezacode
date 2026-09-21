import { BrowserWindow, ipcMain, session, WebContentsView } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { BrowserState, BrowserUpdate } from "@opencode-ai/app/browser"

export function browserURL(value: unknown) {
  if (typeof value !== "string" || value.length > 8192 || !URL.canParse(value)) return
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return
  return url.href
}

export function registerBrowserHandlers() {
  const views = new Map<string, { win: BrowserWindow; view: WebContentsView; state: BrowserState }>()
  const isolated = session.fromPartition("persist:areza-browser")
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.on("will-download", (event) => event.preventDefault())

  const owner = (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Invalid browser sender")
    }
    return win
  }
  const key = (win: BrowserWindow, id: unknown) => {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid browser ID")
    return `${win.webContents.id}:${id}`
  }
  const close = (id: string) => {
    const entry = views.get(id)
    if (!entry) return
    views.delete(id)
    if (!entry.win.isDestroyed()) entry.win.contentView.removeChildView(entry.view)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }

  ipcMain.handle("browser-close", (event, id: unknown) => close(key(owner(event), id)))
  ipcMain.handle("browser-update", (event, input: BrowserUpdate) => {
    const win = owner(event)
    if (!input || typeof input !== "object") throw new Error("Invalid browser update")
    const id = key(win, input.id)
    const url = input.url === undefined ? undefined : browserURL(input.url)
    if (input.url !== undefined && !url) throw new Error("Invalid browser URL")
    if (input.action !== undefined && !["back", "forward", "reload", "stop"].includes(input.action))
      throw new Error("Invalid browser action")
    if (input.visible !== undefined && typeof input.visible !== "boolean") throw new Error("Invalid browser visibility")
    if (
      input.bounds &&
      ![input.bounds.x, input.bounds.y, input.bounds.width, input.bounds.height].every(Number.isFinite)
    )
      throw new Error("Invalid browser bounds")
    if (!views.has(id)) {
      const sender = win.webContents
      const view = new WebContentsView({
        webPreferences: {
          session: isolated,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      })
      const state: BrowserState = { id: input.id, url: "", title: "", loading: false, back: false, forward: false }
      views.set(id, { win, view, state })
      view.setBackgroundColor("#ffffff")
      view.setVisible(false)
      win.contentView.addChildView(view)
      const send = () => {
        if (view.webContents.isDestroyed() || win.isDestroyed()) return
        Object.assign(state, {
          url: view.webContents.getURL(),
          title: view.webContents.getTitle(),
          loading: view.webContents.isLoading(),
          back: view.webContents.navigationHistory.canGoBack(),
          forward: view.webContents.navigationHistory.canGoForward(),
        })
        win.webContents.send("browser-state", state)
      }
      view.webContents.on("will-frame-navigate", (navigation) => {
        if (!browserURL(navigation.url)) navigation.preventDefault()
      })
      view.webContents.on("will-redirect", (navigation, target) => {
        if (!browserURL(target)) navigation.preventDefault()
      })
      view.webContents.setWindowOpenHandler(({ url }) => {
        const target = browserURL(url)
        if (target) void view.webContents.loadURL(target).catch(() => {})
        return { action: "deny" }
      })
      view.webContents.on("did-start-navigation", (_event, _url, _inPlace, main) => {
        if (main) state.error = undefined
        send()
      })
      view.webContents.on("did-fail-load", (_event, code, _description, _url, main) => {
        if (!main || code === -3) return
        state.error = code
        view.setVisible(false)
        send()
      })
      view.webContents.on("render-process-gone", () => {
        state.error = -1
        view.setVisible(false)
        send()
      })
      view.webContents.on("did-start-loading", send)
      view.webContents.on("did-stop-loading", send)
      view.webContents.on("did-navigate", send)
      view.webContents.on("did-navigate-in-page", send)
      view.webContents.on("page-title-updated", send)
      const dispose = () => close(id)
      const navigating = (_event: unknown, _url: string, inPlace: boolean, main: boolean) => {
        if (main && !inPlace) dispose()
      }
      win.webContents.once("destroyed", dispose)
      win.webContents.once("render-process-gone", dispose)
      win.webContents.on("did-start-navigation", navigating)
      view.webContents.once("destroyed", () => {
        views.delete(id)
        sender.removeListener("destroyed", dispose)
        sender.removeListener("render-process-gone", dispose)
        sender.removeListener("did-start-navigation", navigating)
      })
    }
    const entry = views.get(id)!
    if (input.bounds) {
      const zoom = event.sender.getZoomFactor()
      const [width, height] = win.getContentSize()
      const x = Math.min(width, Math.max(0, Math.round(input.bounds.x * zoom)))
      const y = Math.min(height, Math.max(0, Math.round(input.bounds.y * zoom)))
      entry.view.setBounds({
        x,
        y,
        width: Math.min(width - x, Math.max(0, Math.round(input.bounds.width * zoom))),
        height: Math.min(height - y, Math.max(0, Math.round(input.bounds.height * zoom))),
      })
    }
    if (input.visible !== undefined)
      entry.view.setVisible(input.visible && !entry.state.error && !!(url ?? entry.state.url))
    if (url) void entry.view.webContents.loadURL(url).catch(() => {})
    const history = entry.view.webContents.navigationHistory
    if (input.action === "back" && history.canGoBack()) history.goBack()
    if (input.action === "forward" && history.canGoForward()) history.goForward()
    if (input.action === "reload") entry.view.webContents.reload()
    if (input.action === "stop") entry.view.webContents.stop()
    return entry.state
  })
}
