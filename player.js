import dgram from 'dgram'
import {
  Ping,
  MSG_PING,
} from './packets.js'

let pingId = (Math.random() * 0xFFFFFFFF) >>> 0
function getPingId() {
  pingId = (pingId + 1) >>> 0
  return pingId
}

const PING_TIMEOUT = 2000

export default class RallyPointPlayer {
  constructor(host, port) {
    this.host = host
    this.port = port
    this.bound = false
    this.pings = new Map()

    this.socket = dgram.createSocket('udp6')
    this.socket.on('message', (msg, rinfo) => this._onMessage(msg, rinfo))
  }

  async bind() {
    if (this.bound) return

    await new Promise((resolve, reject) => {
      this.socket.once('listening', () => resolve())
        .once('error', err => reject(err))
      this.socket.bind({ address: this.host, port: this.port })
    })

    this.bound = true
  }

  close() {
    this.socket.close()
  }

  addErrorHandler(fn) {
    this.socket.on('error', fn)
  }

  removeErrorHandler(fn) {
    this.socket.removeEventListener('error', fn)
  }

  // servers is [{ address, port }, ...]
  async pingServers(servers) {
    const promises = servers.map(({ address, port }) => new Promise((resolve, reject) => {
      const id = getPingId()
      const timeoutId = setTimeout(() => {
        this.pings.delete(id)
        reject(new Error(`Ping to ${address}:${port} timed out`))
      }, PING_TIMEOUT)

      this.pings.set(id, { start: Date.now(), resolve, timeoutId })
      const packet = Ping.create(pingId)
      this.socket.send(packet, 0, packet.length, port, address)
    }).then(
      time => ({ time, server: { address, port } }),
      () => ({ time: Number.MAX_VALUE, server: { address, port } })
    ))

    return Promise.all(promises)
  }

  _onPing(msg, rinfo) {
    if (!Ping.validate(msg)) {
      return
    }

    const id = Ping.getPingId(msg)
    if (this.pings.has(id)) {
      const state = this.pings.get(id)
      const time = Date.now() - state.start
      this.pings.delete(id)
      clearTimeout(state.timeoutId)
      state.resolve(time)
    }
  }

  _onMessage(msg, rinfo) {
    if (msg.length < 1) return

    const type = msg.readUInt8(0)
    switch (type) {
      case MSG_PING:
        this._onPing(msg, rinfo)
        break
    }
  }
}
