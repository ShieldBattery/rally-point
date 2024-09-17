export interface RallyPointServer {
  get numRoutes(): number
  async bind(): Promise<void>
  close(): void
  addErrorHandler(fn: (err: Error) => void): void
  removeErrorHandler(fn: (err: Error) => void): void
}

export default function createServer(host: string, port: number, secret: string, isFly: boolean):
    RallyPointServer
