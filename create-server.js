import dgram from 'dgram'
import crypto from 'crypto'
import {
  CreateRoute,
  CreateRouteSuccess,
  MSG_CREATE_ROUTE,
} from './packets'
import genId from './gen-id'

export class ProtocolHandler {
  static ACK_TIMEOUT = 1000;

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
    if (!CreateRoute.validate(msg)) {
      // TODO(tec27): send failure
      return
    }
    if (!CreateRoute.verifySignature(this.secret, msg)) {
      // TODO(tec27): send failure
      return
    }

    const playerOne = CreateRoute.getPlayerOneId(msg)
    const playerTwo = CreateRoute.getPlayerTwoId(msg)
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

    const response = CreateRouteSuccess.create(playerOne, playerTwo, route.id)
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
    this.protocolHandler = new ProtocolHandler(secret, (msg, offset, length, port, address) =>
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
