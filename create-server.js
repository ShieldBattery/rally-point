import dgram from 'dgram'
import {
  CreateRoute,
  CreateRouteFailure,
  CreateRouteSuccess,
  CreateRouteSuccessAck,
  MSG_CREATE_ROUTE,
  MSG_CREATE_ROUTE_SUCCESS_ACK,
} from './packets'
import genId from './gen-id'


class Route {
  constructor(id, creatorRinfo, playerOne, playerTwo) {
    this.id = id
    this.creatorRinfo = creatorRinfo
    this.playerOne = playerOne
    this.playerTwo = playerTwo

    this.playerOneConnected = false
    this.playerTwoConnected = false

    this.createSuccessAckTimeout = null
  }
}

export class ProtocolHandler {
  static ACK_TIMEOUT = 1000;
  static MAX_ACKS = 5;

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
      case MSG_CREATE_ROUTE_SUCCESS_ACK:
        this._onCreateRouteSuccessAck(msg, rinfo)
        break
    }
  }

  cleanup() {
    for (const route of this.routes.values()) {
      if (route.createSuccessAckTimeout) {
        clearTimeout(route.createSuccessAckTimeout)
      }
    }
    this.routes.clear()
  }

  _sendCreateFailure(msg, rinfo) {
    const playerOne = CreateRoute.getPlayerOneId(msg)
    const playerTwo = CreateRoute.getPlayerTwoId(msg)
    const failureId = genId()
    const response = CreateRouteFailure.create(playerOne, playerTwo, failureId)

    this.send(response, 0, response.length, rinfo.port, rinfo.address)
  }

  _onCreateRoute(msg, rinfo) {
    if (!CreateRoute.validate(msg)) {
      return
    }

    const validSignature = CreateRoute.verifySignature(this.secret, msg)
    const playerOne = CreateRoute.getPlayerOneId(msg)
    const playerTwo = CreateRoute.getPlayerTwoId(msg)
    if (playerOne === playerTwo || !validSignature) {
      this._sendCreateFailure(msg, rinfo)
      return
    }

    const route = new Route(genId(), rinfo, playerOne, playerTwo)
    this.routes.set(route.id, route)

    const response = CreateRouteSuccess.create(playerOne, playerTwo, route.id)
    let tries = 0
    const send = () => {
      if (tries < ProtocolHandler.MAX_ACKS) {
        tries++
        this.send(response, 0, response.length, rinfo.port, rinfo.address)
        route.createSuccessAckTimeout = setTimeout(send, ProtocolHandler.ACK_TIMEOUT)
      } else {
        this.routes.delete(route.id)
      }
    }
    send()
  }

  _onCreateRouteSuccessAck(msg, rinfo) {
    if (!CreateRouteSuccessAck.validate(msg)) {
      return
    }

    const routeId = CreateRouteSuccessAck.getRouteId(msg)
    if (!this.routes.has(routeId)) {
      return
    }
    const route = this.routes.get(routeId)
    if (route.creatorRinfo.port !== rinfo.port || route.creatorRinfo.address !== rinfo.address) {
      return
    }

    clearTimeout(route.createSuccessAckTimeout)
    route.createSuccessAckTimeout = null
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
