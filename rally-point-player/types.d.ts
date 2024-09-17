export interface PingTarget {
  address: string
  port: number
}

export interface PingResult {
  time: number
  server: PingTarget
}

export class RallyPointPlayer {
  constructor(host: string, port: number)
  bind(): Promise<void>
  close(): void
  addErrorHandler(fn: (err: Error) => void): void
  removeErrorHandler(fn: (err: Error) => void): void
  pingServers(servers: PingTarget[]): Promise<PingResult[]>
}

export default RallyPointPlayer
