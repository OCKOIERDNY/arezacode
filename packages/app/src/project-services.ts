export type ProjectService = {
  id: string
  kind: "process" | "container"
  name: string
  ports: number[]
  urls: string[]
  pid?: number
}

export type ProjectServicesState = {
  services: ProjectService[]
  processes: "available" | "unavailable"
  docker: "available" | "unavailable" | "remote"
}

export type ProjectServicesPlatform = {
  list(directory: string): Promise<ProjectServicesState>
  stop(directory: string, id: string): Promise<void>
}
