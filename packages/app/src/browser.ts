export type BrowserState = {
  id: string
  url: string
  title: string
  loading: boolean
  back: boolean
  forward: boolean
  error?: number
  preview?: string
}

export type BrowserUpdate = {
  id: string
  url?: string
  action?: "back" | "forward" | "reload" | "stop" | "capture"
  bounds?: { x: number; y: number; width: number; height: number }
  visible?: boolean
}

export type EmbeddedBrowser = {
  bind(scope: { sessionID: string; directory: string } | undefined): Promise<void>
  onOpen(callback: (sessionID: string) => void): () => void
  update(input: BrowserUpdate): Promise<BrowserState>
  close(id: string): Promise<void>
  subscribe(callback: (state: BrowserState) => void): () => void
}
