export type BrowserState = {
  id: string
  url: string
  title: string
  loading: boolean
  back: boolean
  forward: boolean
  error?: number
}

export type BrowserUpdate = {
  id: string
  url?: string
  action?: "back" | "forward" | "reload" | "stop"
  bounds?: { x: number; y: number; width: number; height: number }
  visible?: boolean
}

export type EmbeddedBrowser = {
  update(input: BrowserUpdate): Promise<BrowserState>
  close(id: string): Promise<void>
  subscribe(callback: (state: BrowserState) => void): () => void
}
