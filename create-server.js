import dgram from 'dgram'
import crypto from 'crypto'
import {
  MSG_CREATE_ROUTE,
  LENGTH_MSG_CREATE_ROUTE,
  MSG_CREATE_ROUTE_SUCCESS,
  LENGTH_MSG_CREATE_ROUTE_SUCCESS,
  MSG_CREATE_ROUTE_SUCCESS_ACK,
  MSG_CREATE_ROUTE_FAILURE_ACK,
} from './protocol-constants'
import genId from './gen-id'

export class ProtocolHandler {
  // sendFn is function(msg, offset, length, port, address)
  constructor(secret, sendFn) {
    this.secret = secret
    this.send = sendFn

    this.routes = new Map()
  }

  onMessage(msg, rinfo) {
    if (msg.length < 1) return

    const type = msg.readUInt8(0)
    switch (type) {
      case MSG_CREATE_ROUTE:
        this._onCreateRoute(msg, rinfo)
        break
    }
  }

  cleanup() {
    this.routes.clear()
  }

  _onCreateRoute(msg, rinfo) {
    if (msg.length !== LENGTH_MSG_CREATE_ROUTE) {
      // TODO(tec27): send failure
      return
    }

    const data = msg.slice(0, 1 + 4 + 4)
    const signature = msg.slice(data.length)
    if (!this._verifySignature(data, signature)) {
      // TODO(tec27): send failure
      return
    }

    const playerOne = msg.readUInt32LE(1)
    const playerTwo = msg.readUInt32LE(5)
    if (playerOne === playerTwo) {
      // TODO(tec27): send failure
      return
    }

    const route = {
      id: genId(),
      playerOne,
      playerTwo,
    }
    this.routes.set(route.id, route)

    const response = Buffer.allocUnsafe(LENGTH_MSG_CREATE_ROUTE_SUCCESS)
    response.writeUInt8(MSG_CREATE_ROUTE_SUCCESS, 0)
    response.writeUInt32LE(playerOne, 1)
    response.writeUInt32LE(playerTwo, 5)
    response.write(route.id, 9)
    this.send(response, 0, response.length, rinfo.port, rinfo.address)
  }

  _verifySignature(msg, signature) {
    const expected = crypto.createHmac('sha256', this.secret).update(msg).digest()
    let matching = true
    // don't break early here to avoid exposing when the signature mismatched via timing
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== signature[i]) {
        matching = false
      }
    }
    return matching
  }
}

class Server {
  constructor(host, port, secret) {
    this.host = host
    this.port = port
    this.secret = secret

    this.socket = dgram.createSocket('udp6')
    this.protocolHandler = new ProtocolHandler((msg, offset, length, port, address) =>
        this.socket.send(msg, offset, length, port, address))
    this.socket.on('message', (msg, rinfo) => this.protocolHandler.onMessage(msg, rinfo))
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

  addErrorHandler(fn) {
    this.socket.on('error', fn)
  }

  removeErrorHandler(fn) {
    this.socket.removeEventListener('error', fn)
  }
}

export default function createServer(host, port, secret) {
  return new Server(host, port, secret)
}
