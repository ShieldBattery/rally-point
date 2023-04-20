import dgram from 'dgram'
import {
  CreateRoute,
  CreateRouteFailure,
  CreateRouteFailureAck,
  CreateRouteSuccess,
  CreateRouteSuccessAck,
  Forward,
  JoinRoute,
  JoinRouteFailure,
  JoinRouteFailureAck,
  JoinRouteSuccess,
  JoinRouteSuccessAck,
  KeepAlive,
  Ping,
  RouteReady,
  RouteReadyAck,
  MSG_CREATE_ROUTE,
  MSG_CREATE_ROUTE_FAILURE_ACK,
  MSG_CREATE_ROUTE_SUCCESS_ACK,
  MSG_FORWARD,
  MSG_JOIN_ROUTE,
  MSG_JOIN_ROUTE_FAILURE_ACK,
  MSG_JOIN_ROUTE_SUCCESS_ACK,
  MSG_KEEP_ALIVE,
  MSG_PING,
  MSG_ROUTE_READY_ACK,
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
    this.p1ReadyResender = null
    this.p2JoinResender = null
    this.p2ReadyResender = null

    this.p1LastMessage = Date.now()
    this.p2LastMessage = Date.now()
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

  get lastActive() {
    return Math.min(this.p1LastMessage, this.p2LastMessage)
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
      if (
        this.playerOneEndpoint.port !== rinfo.port ||
        this.playerOneEndpoint.address !== rinfo.address
      ) {
        return
      }
      if (this.p1JoinResender) {
        this.p1JoinResender.handleAck()
        this.p1JoinResender = null
      }
    } else if (this.playerTwoId === playerId) {
      if (
        this.playerTwoEndpoint.port !== rinfo.port ||
        this.playerTwoEndpoint.address !== rinfo.address
      ) {
        return
      }
      if (this.p2JoinResender) {
        this.p2JoinResender.handleAck()
        this.p2JoinResender = null
      }
    }
  }

  handlePostReadyMessage(playerId, rinfo) {
    if (!this.connected && !this.p1ReadyResender && !this.p2ReadyResender) {
      return false
    }

    if (this.playerOneId === playerId) {
      if (
        this.playerOneEndpoint.port !== rinfo.port ||
        this.playerOneEndpoint.address !== rinfo.address
      ) {
        return false
      }

      this.p1LastMessage = Date.now()
      if (this.p1ReadyResender) {
        this.p1ReadyResender.handleAck()
        this.p1ReadyResender = null
      }
    } else if (this.playerTwoId === playerId) {
      if (
        this.playerTwoEndpoint.port !== rinfo.port ||
        this.playerTwoEndpoint.address !== rinfo.address
      ) {
        return false
      }

      this.p2LastMessage = Date.now()
      if (this.p2ReadyResender) {
        this.p2ReadyResender.handleAck()
        this.p2ReadyResender = null
      }
    } else {
      return false
    }

    return true
  }

  handleKeepAlive(playerId, rinfo) {
    if (this.playerOneId === playerId) {
      if (
        this.playerOneEndpoint.port !== rinfo.port ||
        this.playerOneEndpoint.address !== rinfo.address
      ) {
        return false
      }
      this.p1LastMessage = Date.now()
    } else if (this.playerTwoId === playerId) {
      if (
        this.playerTwoEndpoint.port !== rinfo.port ||
        this.playerTwoEndpoint.address !== rinfo.address
      ) {
        return false
      }
      this.p2LastMessage = Date.now()
    } else {
      return false
    }

    return true
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
  // How long to wait before re-sending a packet (milliseconds)
  static ACK_TIMEOUT = 500
  // How many times to resend a packet before giving up
  static MAX_RESENDS = 5
  // How long a route can stay idle before it gets pruned (milliseconds)
  static MAX_ROUTE_STALENESS = 10 * 60 * 1000

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
    try {
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
        case MSG_JOIN_ROUTE_FAILURE_ACK:
          this._onJoinRouteFailureAck(msg, rinfo)
          break
        case MSG_JOIN_ROUTE_SUCCESS_ACK:
          this._onJoinRouteSuccessAck(msg, rinfo)
          break
        case MSG_ROUTE_READY_ACK:
          this._onRouteReadyAck(msg, rinfo)
          break
        case MSG_FORWARD:
          this._onForward(msg, rinfo)
          break
        case MSG_KEEP_ALIVE:
          this._onKeepAlive(msg, rinfo)
          break
        case MSG_PING:
          this._onPing(msg, rinfo)
          break
      }
    } catch (err) {
      console.error(
        `Error handling message [${type}] from ${rinfo.address}:${rinfo.port}: ${
          err?.stack ?? err
        }`,
      )
    }
  }

  cleanRouteTimers(route) {
    if (route.createResender) {
      route.createResender.handleAck()
    }
    if (route.p1JoinResender) {
      route.p1JoinResender.handleAck()
    }
    if (route.p1ReadyResender) {
      route.p1ReadyResender.handleAck()
    }
    if (route.p2JoinResender) {
      route.p2JoinResender.handleAck()
    }
    if (route.p2ReadyResender) {
      route.p2ReadyResender.handleAck()
    }
  }

  cleanup() {
    for (const route of this.routes.values()) {
      this.cleanRouteTimers(route)
    }
    this.routes.clear()

    for (const failure of this.failures.values()) {
      failure.handleAck()
    }
    this.failures.clear()
  }

  pruneRoutes() {
    const oldest = Date.now() - ProtocolHandler.MAX_ROUTE_STALENESS
    let removed = 0
    for (const route of this.routes.values()) {
      if (route.lastActive < oldest) {
        this.cleanRouteTimers(route)
        this.routes.delete(route.id)
        removed++
      }
    }

    return removed
  }

  _sendCreateFailure(msg, rinfo) {
    const playerOne = CreateRoute.getPlayerOneId(msg)
    const playerTwo = CreateRoute.getPlayerTwoId(msg)
    const failureId = genId()
    const response = CreateRouteFailure.create(playerOne, playerTwo, failureId)
    const failure = new Failure(
      failureId,
      rinfo,
      ProtocolHandler.ACK_TIMEOUT,
      ProtocolHandler.MAX_RESENDS,
      response,
      this.send,
      () => this.failures.delete(failureId),
    )
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
    route.createResender = new PacketResender(
      ProtocolHandler.ACK_TIMEOUT,
      ProtocolHandler.MAX_RESENDS,
      rinfo,
      response,
      this.send,
      () => this.routes.delete(route.id),
    )
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

  _sendJoinFailure(msg, rinfo) {
    const routeId = JoinRoute.getRouteId(msg)
    const failureId = genId()
    const response = JoinRouteFailure.create(routeId, failureId)
    const failure = new Failure(
      failureId,
      rinfo,
      ProtocolHandler.ACK_TIMEOUT,
      ProtocolHandler.MAX_RESENDS,
      response,
      this.send,
      () => this.failures.delete(failureId),
    )
    this.failures.set(failureId, failure)
    failure.start()
  }

  _onJoinRoute(msg, rinfo) {
    if (!JoinRoute.validate(msg)) {
      return
    }

    const routeId = JoinRoute.getRouteId(msg)
    if (!this.routes.has(routeId)) {
      this._sendJoinFailure(msg, rinfo)
      return
    }
    const playerId = JoinRoute.getPlayerId(msg)
    const route = this.routes.get(routeId)
    const wasConnected = route.connected
    const playerNum = route.registerEndpoint(playerId, rinfo)
    if (!playerNum) {
      this._sendJoinFailure(msg, rinfo)
      return
    }

    const response = JoinRouteSuccess.create(routeId)
    const resender = new PacketResender(
      ProtocolHandler.ACK_TIMEOUT,
      ProtocolHandler.MAX_RESENDS,
      rinfo,
      response,
      this.send,
      () => {},
    )
    if (playerNum === 1) {
      route.p1JoinResender = resender
    } else {
      route.p2JoinResender = resender
    }
    resender.start()

    if (!wasConnected && route.connected) {
      const readyMsg = RouteReady.create(routeId)
      route.p1ReadyResender = new PacketResender(
        ProtocolHandler.ACK_TIMEOUT,
        ProtocolHandler.MAX_RESENDS,
        route.playerOneEndpoint,
        readyMsg,
        this.send,
        () => {},
      )
      route.p2ReadyResender = new PacketResender(
        ProtocolHandler.ACK_TIMEOUT,
        ProtocolHandler.MAX_RESENDS,
        route.playerTwoEndpoint,
        readyMsg,
        this.send,
        () => {},
      )
      route.p1ReadyResender.start()
      route.p2ReadyResender.start()
    }
  }

  _onJoinRouteFailureAck(msg, rinfo) {
    if (!JoinRouteFailureAck.validate(msg)) {
      return
    }

    const failureId = JoinRouteFailureAck.getFailureId(msg)
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

  _onRouteReadyAck(msg, rinfo) {
    if (!RouteReadyAck.validate(msg)) {
      return
    }

    const routeId = RouteReadyAck.getRouteId(msg)
    if (!this.routes.has(routeId)) {
      return
    }
    const route = this.routes.get(routeId)
    const playerId = RouteReadyAck.getPlayerId(msg)
    route.handlePostReadyMessage(playerId, rinfo)
  }

  _onForward(msg, rinfo) {
    if (!Forward.validate(msg)) {
      return
    }

    const routeId = Forward.getRouteId(msg)
    if (!this.routes.has(routeId)) {
      return
    }
    const route = this.routes.get(routeId)
    const playerId = Forward.getPlayerId(msg)
    if (!route.handlePostReadyMessage(playerId, rinfo)) {
      return
    }

    const receive = Forward.toReceive(msg)
    const dest = playerId === route.playerOneId ? route.playerTwoEndpoint : route.playerOneEndpoint
    this.send(receive, 0, receive.length, dest.port, dest.address)
  }

  _onKeepAlive(msg, rinfo) {
    if (!KeepAlive.validate(msg)) {
      return
    }

    const routeId = KeepAlive.getRouteId(msg)
    if (!this.routes.has(routeId)) {
      return
    }
    const route = this.routes.get(routeId)
    const playerId = KeepAlive.getPlayerId(msg)
    if (!route.handleKeepAlive(playerId, rinfo)) {
      return
    }

    this.send(msg, 0, msg.length, rinfo.port, rinfo.address)
  }

  _onPing(msg, rinfo) {
    if (!Ping.validate(msg)) {
      return
    }
    this.send(msg, 0, msg.length, rinfo.port, rinfo.address)
  }
}

class Server {
  constructor(host, port, secret, isFly) {
    this.host = host
    this.port = port
    this.secret = secret
    this.bound = false

    this.socket = dgram.createSocket({
      type: isFly ? 'udp4' : 'udp6',
    })
    this.protocolHandler = new ProtocolHandler(secret, (msg, offset, length, port, address) =>
      this.socket.send(msg, offset, length, port, address),
    )
    this.socket.on('message', (msg, rinfo) => this.protocolHandler.onMessage(msg, rinfo))

    this.pruneInterval = setInterval(
      () => this.protocolHandler.pruneRoutes(),
      1.5 * ProtocolHandler.MAX_ROUTE_STALENESS,
    )
  }

  get numRoutes() {
    return this.protocolHandler.routes.size
  }

  async bind() {
    if (this.bound) return

    await new Promise((resolve, reject) => {
      this.socket.once('listening', () => resolve()).once('error', err => reject(err))
      this.socket.bind({ address: this.host, port: this.port })
    })

    this.bound = true
  }

  close() {
    this.socket.close()
    clearInterval(this.pruneInterval)
    this.protocolHandler.cleanup()
  }

  addErrorHandler(fn) {
    this.socket.on('error', fn)
  }

  removeErrorHandler(fn) {
    this.socket.removeEventListener('error', fn)
  }
}

export default function createServer(host, port, secret, isFly) {
  return new Server(host, port, secret, isFly)
}
