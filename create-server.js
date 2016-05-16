import dgram from 'dgram'
import {
  CreateRoute,
  CreateRouteFailure,
  CreateRouteFailureAck,
  CreateRouteSuccess,
  CreateRouteSuccessAck,
  JoinRoute,
  JoinRouteSuccess,
  JoinRouteSuccessAck,
  MSG_CREATE_ROUTE,
  MSG_CREATE_ROUTE_FAILURE_ACK,
  MSG_CREATE_ROUTE_SUCCESS_ACK,
  MSG_JOIN_ROUTE,
  MSG_JOIN_ROUTE_SUCCESS_ACK,
} from './packets'
import genId from './gen-id'

class PacketResender {
  constructor(timeout, maxResends, rinfo, packetData, sendFn, onFailure) {
    this.timeout = timeout
    this.maxResends = maxResends
    this.rinfo = rinfo
    this.packetData = packetData
    this.send = sendFn
    this.onFailure = onFailure

    this.timerId = null
    this.tries = 0
    this.done = false
  }

  _sendPacket() {
    this.timerId = null
    if (this.done) return

    if (this.tries < this.maxResends) {
      this.tries++
      this.send(this.packetData, 0, this.packetData.length, this.rinfo.port, this.rinfo.address)
      this.timerId = setTimeout(() => this._sendPacket(), this.timeout)
    } else {
      this.done = true
      this.onFailure()
    }
  }

  start() {
    if (this.done || this.timerId !== null) return
    this._sendPacket()
  }

  handleAck() {
    if (this.done) return

    this.done = true
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }
}

class Route {
  constructor(id, creatorRinfo, playerOne, playerTwo) {
    this.id = id
    this.creatorRinfo = creatorRinfo
    this.playerOneId = playerOne
    this.playerOneEndpoint = null
    this.playerTwoId = playerTwo
    this.playerTwoEndpoint = null

    this.createResender = null
    this.p1JoinResender = null
    this.p2JoinResender = null
  }

  get playerOneConnected() {
    return !!this.playerOneEndpoint
  }

  get playerTwoConnected() {
    return !!this.playerTwoEndpoint
  }

  get connected() {
    return this.playerOneConnected && this.playerTwoConnected
  }

  registerEndpoint(playerId, rinfo) {
    if (this.playerOneId === playerId) {
      this.playerOneEndpoint = rinfo
      return 1
    } else if (this.playerTwoId === playerId) {
      this.playerTwoEndpoint = rinfo
      return 2
    } else {
      return 0
    }
  }

  handleJoinSuccessAck(playerId, rinfo) {
    if (this.playerOneId === playerId) {
      if (this.playerOneEndpoint.port !== rinfo.port ||
          this.playerOneEndpoint.address !== rinfo.address) {
        return
      }
      if (this.p1JoinResender) {
        this.p1JoinResender.handleAck()
        this.p1JoinResender = null
      }
    } else if (this.playerTwoId === playerId) {
      if (this.playerTwoEndpoint.port !== rinfo.port ||
          this.playerTwoEndpoint.address !== rinfo.address) {
        return
      }
      if (this.p2JoinResender) {
        this.p2JoinResender.handleAck()
        this.p2JoinResender = null
      }
    }
  }
}

class Failure {
  constructor(id, rinfo, timeout, maxResends, packetData, sendFn, onNoAck) {
    this.id = id
    this.rinfo = rinfo

    this.resender = new PacketResender(timeout, maxResends, rinfo, packetData, sendFn, onNoAck)
  }

  start() {
    this.resender.start()
  }

  handleAck() {
    this.resender.handleAck()
  }
}

export class ProtocolHandler {
  static ACK_TIMEOUT = 1000;
  static MAX_RESENDS = 5;

  // sendFn is function(msg, offset, length, port, address)
  constructor(secret, sendFn) {
    this.secret = secret
    this.send = sendFn

    this.routes = new Map()
    this.failures = new Map()
  }

  onMessage(msg, rinfo) {
    if (msg.length < 1) return

    const type = msg.readUInt8(0)
    switch (type) {
      // Creator messages
      case MSG_CREATE_ROUTE:
        this._onCreateRoute(msg, rinfo)
        break
      case MSG_CREATE_ROUTE_SUCCESS_ACK:
        this._onCreateRouteSuccessAck(msg, rinfo)
        break
      case MSG_CREATE_ROUTE_FAILURE_ACK:
        this._onCreateRouteFailureAck(msg, rinfo)
        break

      // Player messages
      case MSG_JOIN_ROUTE:
        this._onJoinRoute(msg, rinfo)
        break
      case MSG_JOIN_ROUTE_SUCCESS_ACK:
        this._onJoinRouteSuccessAck(msg, rinfo)
        break
    }
  }

  cleanup() {
    for (const route of this.routes.values()) {
      if (route.createResender) {
        route.createResender.handleAck()
      }
      if (route.p1JoinResender) {
        route.p1JoinResender.handleAck()
      }
      if (route.p2JoinResender) {
        route.p2JoinResender.handleAck()
      }
    }
    this.routes.clear()

    for (const failure of this.failures.values()) {
      failure.handleAck()
    }
    this.failures.clear()
  }

  _sendCreateFailure(msg, rinfo) {
    const playerOne = CreateRoute.getPlayerOneId(msg)
    const playerTwo = CreateRoute.getPlayerTwoId(msg)
    const failureId = genId()
    const response = CreateRouteFailure.create(playerOne, playerTwo, failureId)
    const failure = new Failure(failureId, rinfo, ProtocolHandler.ACK_TIMEOUT,
        ProtocolHandler.MAX_RESENDS, response, this.send, () => this.failures.delete(failureId))
    this.failures.set(failureId, failure)
    failure.start()
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
    route.createResender = new PacketResender(ProtocolHandler.ACK_TIMEOUT,
        ProtocolHandler.MAX_RESENDS, rinfo, response, this.send, () => this.routes.delete(route.id))
    route.createResender.start()
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

    if (route.createResender) {
      route.createResender.handleAck()
    }
    route.createResender = null
  }

  _onCreateRouteFailureAck(msg, rinfo) {
    if (!CreateRouteFailureAck.validate(msg)) {
      return
    }

    const failureId = CreateRouteFailureAck.getFailureId(msg)
    if (!this.failures.has(failureId)) {
      return
    }
    const failure = this.failures.get(failureId)
    if (failure.rinfo.port !== rinfo.port || failure.rinfo.address !== rinfo.address) {
      return
    }

    failure.handleAck()
    this.failures.delete(failureId)
  }

  _onJoinRoute(msg, rinfo) {
    if (!JoinRoute.validate(msg)) {
      return
    }


    const routeId = JoinRoute.getRouteId(msg)
    if (!this.routes.has(routeId)) {
      // TODO(tec27): send failure
      return
    }
    const playerId = JoinRoute.getPlayerId(msg)
    const route = this.routes.get(routeId)
    const wasConnected = route.connected
    const playerNum = route.registerEndpoint(playerId, rinfo)
    if (!playerNum) {
      // TODO(tec27): send failure
      return
    }

    const response = JoinRouteSuccess.create(routeId)
    const resender = new PacketResender(ProtocolHandler.ACK_TIMEOUT,
        ProtocolHandler.MAX_RESENDS, rinfo, response, this.send, () => {})
    if (playerNum === 1) {
      route.p1JoinResender = resender
    } else {
      route.p2JoinResender = resender
    }
    resender.start()

    if (!wasConnected && route.connected) {
      // TODO(tec27): send route ready
    }
  }

  _onJoinRouteSuccessAck(msg, rinfo) {
    if (!JoinRouteSuccessAck.validate(msg)) {
      return
    }

    const routeId = JoinRouteSuccessAck.getRouteId(msg)
    if (!this.routes.has(routeId)) {
      return
    }
    const route = this.routes.get(routeId)
    const playerId = JoinRouteSuccessAck.getPlayerId(msg)
    route.handleJoinSuccessAck(playerId, rinfo)
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
