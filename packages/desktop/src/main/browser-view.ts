import { BaseWindow, BrowserWindow, ipcMain, session, WebContentsView } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { BrowserState, BrowserUpdate } from "@opencode-ai/app/browser"
import { Schema } from "effect"
import { Browser } from "@opencode-ai/core/browser"
import { startBrowserControl } from "./browser-control"

export function browserURL(value: unknown) {
  if (typeof value !== "string" || value.length > 8192 || !URL.canParse(value)) return
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return
  return url.href
}

export function registerBrowserHandlers() {
  const views = new Map<string, { win: BrowserWindow; view: WebContentsView; state: BrowserState }>()
  const scopes = new Map<number, { win: BrowserWindow; sessionID: string; directory: string }>()
  const tracked = new Set<number>()
  const refs = new Map<string, Set<number>>()
  const pending = new Map<string, Promise<typeof Browser.Output.Type>>()
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
    refs.delete(id)
    if (!entry.win.isDestroyed()) entry.win.contentView.removeChildView(entry.view)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }

  ipcMain.handle("browser-close", (event, id: unknown) => close(key(owner(event), id)))
  ipcMain.handle("browser-bind", (event, scope: unknown) => {
    const win = owner(event)
    if (scope === undefined) {
      scopes.delete(win.id)
      return
    }
    const value = Schema.decodeUnknownSync(
      Schema.Struct({ sessionID: Browser.Request.fields.sessionID, directory: Browser.Request.fields.directory }),
    )(scope)
    if (!tracked.has(win.id)) {
      tracked.add(win.id)
      win.once("closed", () => {
        scopes.delete(win.id)
        tracked.delete(win.id)
      })
    }
    scopes.set(win.id, { win, ...value })
  })
  const update = (win: BrowserWindow, input: BrowserUpdate) => {
    if (!input || typeof input !== "object") throw new Error("Invalid browser update")
    const id = key(win, input.id)
    const url = input.url === undefined ? undefined : browserURL(input.url)
    if (input.url !== undefined && !url) throw new Error("Invalid browser URL")
    if (input.action !== undefined && !["back", "forward", "reload", "stop", "capture"].includes(input.action))
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
          backgroundThrottling: false,
        },
      })
      const state: BrowserState = { id: input.id, url: "", title: "", loading: false, back: false, forward: false }
      views.set(id, { win, view, state })
      view.setBackgroundColor("#ffffff")
      const [width, height] = win.getContentSize()
      view.setBounds({ x: 0, y: 0, width: Math.min(1280, width), height: Math.min(900, height) })
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
        if (main) {
          state.error = undefined
          refs.delete(id)
        }
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
      const zoom = win.webContents.getZoomFactor()
      const [width, height] = win.getContentSize()
      const x = Math.min(width, Math.max(0, Math.round(input.bounds.x * zoom)))
      const y = Math.min(height, Math.max(0, Math.round(input.bounds.y * zoom)))
      const bounds = {
        x,
        y,
        width: Math.min(width - x, Math.max(0, Math.round(input.bounds.width * zoom))),
        height: Math.min(height - y, Math.max(0, Math.round(input.bounds.height * zoom))),
      }
      if (bounds.width > 0 && bounds.height > 0) entry.view.setBounds(bounds)
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
  }
  ipcMain.handle("browser-update", async (event, input: BrowserUpdate) => {
    const win = owner(event)
    const state = update(win, input)
    if (input.action !== "capture") return state
    const image = await views.get(key(win, input.id))!.view.webContents.capturePage()
    return { ...state, preview: image.isEmpty() ? undefined : image.toDataURL() }
  })

  const execute = async (request: Browser.Request, signal: AbortSignal) => {
    signal.throwIfAborted()
    const scope = [...scopes.values()]
      .filter(
        (value) =>
          value.sessionID === request.sessionID && value.directory === request.directory && !value.win.isDestroyed(),
      )
      .sort((a, b) => Number(b.win.isFocused()) - Number(a.win.isFocused()))[0]
    if (!scope) throw new Error("Open this task in ArezaCode before using its browser.")
    const id = `agent_${request.sessionID}`
    const target = key(scope.win, id)
    const input = request.input
    if (input.action === "open" && !browserURL(input.url))
      throw new Error("Only HTTP and HTTPS browser URLs without credentials are supported")
    if (input.action !== "open" && !views.has(target)) throw new Error("Open a URL with the browser tool first")
    update(scope.win, { id })
    const contents = views.get(target)!.view.webContents
    contents.setBackgroundThrottling(false)
    scope.win.webContents.send("browser-open", request.sessionID)
    if (input.action === "open") {
      const stop = () => {
        if (!contents.isDestroyed()) contents.stop()
      }
      signal.addEventListener("abort", stop, { once: true })
      await contents.loadURL(browserURL(input.url)!).finally(() => signal.removeEventListener("abort", stop))
    }
    signal.throwIfAborted()
    if (contents.isDestroyed()) throw new Error("The browser was closed")
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3")
    const command = (method: string, params?: Record<string, unknown>) => {
      signal.throwIfAborted()
      const abort = () => {
        if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach()
      }
      signal.addEventListener("abort", abort, { once: true })
      return contents.debugger.sendCommand(method, params).finally(() => signal.removeEventListener("abort", abort))
    }
    if (input.action === "click" || input.action === "fill") {
      if (!refs.get(target)?.has(input.ref!))
        throw new Error("Unknown or stale browser ref. Take a new snapshot first.")
      const resolved: { object: { objectId?: string } } = await command("DOM.resolveNode", {
        backendNodeId: input.ref,
      })
      if (!resolved.object.objectId) throw new Error("The element no longer exists. Take a new snapshot.")
      signal.throwIfAborted()
      const result: { exceptionDetails?: unknown } = await command("Runtime.callFunctionOn", {
        objectId: resolved.object.objectId,
        functionDeclaration:
          input.action === "click"
            ? "function() { if (!this.isConnected || !this.getClientRects().length || this.disabled) throw Error('Element is not available'); this.scrollIntoView({block:'center',inline:'center'}); this.click(); }"
            : "function() { if (!this.isConnected || !this.getClientRects().length || this.disabled || this.readOnly || !['INPUT','TEXTAREA'].includes(this.tagName)) throw Error('Element is not editable'); this.focus(); this.select(); }",
        userGesture: true,
        returnByValue: true,
      })
      await command("Runtime.releaseObject", { objectId: resolved.object.objectId }).catch(() => {})
      if (result.exceptionDetails) throw new Error("The element could not be used. Take a new snapshot.")
      signal.throwIfAborted()
      if (input.action === "fill") await contents.insertText(input.text!)
    }
    if (input.action === "press") {
      contents.focus()
      const codes = {
        Enter: 13,
        Tab: 9,
        Escape: 27,
        Backspace: 8,
        ArrowUp: 38,
        ArrowDown: 40,
        ArrowLeft: 37,
        ArrowRight: 39,
        PageUp: 33,
        PageDown: 34,
        Home: 36,
        End: 35,
      }
      const key = { key: input.key, code: input.key, windowsVirtualKeyCode: codes[input.key!] }
      await command("Input.dispatchKeyEvent", { ...key, type: "rawKeyDown" })
      if (input.key === "Enter") await command("Input.dispatchKeyEvent", { ...key, type: "char", text: "\r" })
      await command("Input.dispatchKeyEvent", { ...key, type: "keyUp" })
    }
    if (input.action === "screenshot") {
      const view = views.get(target)!.view
      const visible = view.getVisible()
      const bounds = view.getBounds()
      const capture = scope.win.isVisible()
        ? undefined
        : new BaseWindow({ show: false, width: bounds.width, height: bounds.height })
      if (capture) {
        scope.win.contentView.removeChildView(view)
        capture.contentView.addChildView(view)
      }
      view.setVisible(true)
      const image: { data: string } = await command("Emulation.setDeviceMetricsOverride", {
        width: bounds.width,
        height: bounds.height,
        deviceScaleFactor: 1,
        mobile: false,
      })
        .then(() => command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }))
        .finally(async () => {
          if (capture && !capture.isDestroyed()) {
            capture.contentView.removeChildView(view)
            if (!scope.win.isDestroyed() && !contents.isDestroyed()) scope.win.contentView.addChildView(view)
            capture.destroy()
          }
          if (contents.isDestroyed()) return
          view.setVisible(visible)
          if (contents.debugger.isAttached()) await command("Emulation.clearDeviceMetricsOverride")
        })
      if (!image.data)
        throw new Error(
          "Browser screenshot capture failed. Use snapshot to inspect the page and report the capture error.",
        )
      return {
        title: contents.getTitle(),
        url: contents.getURL(),
        text: "Browser screenshot",
        image: image.data,
      }
    }
    const tree: {
      nodes: { ignored?: boolean; backendDOMNodeId?: number; role?: { value?: string }; name?: { value?: string } }[]
    } = await command("Accessibility.getFullAXTree")
    const nodes = tree.nodes
      .filter((node) => !node.ignored && node.backendDOMNodeId && node.role?.value !== "generic")
      .slice(0, 300)
    refs.set(target, new Set(nodes.map((node) => node.backendDOMNodeId!)))
    return {
      title: contents.getTitle(),
      url: contents.getURL(),
      text: `${contents.isLoading() ? "Page is loading; take another snapshot after navigation.\n" : ""}${nodes
        .map(
          (node) =>
            `[ref=${node.backendDOMNodeId}] ${node.role?.value ?? ""} ${JSON.stringify(node.name?.value ?? "")}`,
        )
        .join("\n")
        .slice(0, 24000)}`,
    }
  }
  return startBrowserControl((request, signal) => {
    const key = `${request.directory}\0${request.sessionID}`
    const task = (pending.get(key)?.catch(() => undefined) ?? Promise.resolve()).then(() => execute(request, signal))
    pending.set(key, task)
    void task
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key)
      })
      .catch(() => {})
    return task
  })
}
