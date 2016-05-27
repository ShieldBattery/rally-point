import dgram from 'dgram'
import {
  Ping,
} from './packets.js'

export default class RallyPointPlayer {
  constructor(host, port) {
    this.host = host
    this.port = port
    this.bound = false

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

  _onMessage(msg, rinfo) {
  }
}
