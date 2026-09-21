export type ProjectService = {
  id: string
  kind: "process" | "container"
  name: string
  ports: number[]
  urls: string[]
  pid?: number
  group?: number
  running?: boolean
  failed?: boolean
}

export type ProjectServicesState = {
  services: ProjectService[]
  launchers?: { id: string; command: string }[]
  processes: "available" | "unavailable"
  docker: "available" | "unavailable" | "remote"
}

export type ProjectServicesPlatform = {
  list(directory: string): Promise<ProjectServicesState>
  stop(directory: string, id: string): Promise<void>
  start(directory: string, id: string): Promise<void>
}
