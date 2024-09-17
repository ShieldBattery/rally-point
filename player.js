import * as dgram from 'node:dgram'
import { EventEmitter } from 'events'
import {
  Forward,
  JoinRoute,
  JoinRouteFailure,
  JoinRouteFailureAck,
  JoinRouteSuccess,
  JoinRouteSuccessAck,
  KeepAlive,
  Ping,
  Receive,
  RouteReady,
  RouteReadyAck,
  MSG_JOIN_ROUTE_FAILURE,
  MSG_JOIN_ROUTE_SUCCESS,
  MSG_PING,
  MSG_RECEIVE,
  MSG_ROUTE_READY,
} from './packets.js'

const PING_TIMEOUT = 2000
const RESEND_TIMEOUT = 500

let pingId = (Math.random() * 0xffffffff) >>> 0
function getPingId() {
  pingId = (pingId + 1) >>> 0
  return pingId
}

/**
 * Returns a monotonically increasing number corresponding to a time in milliseconds.
 */
function monotonicNow() {
  const [seconds, nanos] = process.hrtime()
  return seconds * 1000 + nanos / 1000000
}

const getRouteKey = (address, port, routeId) => `${address}:${port}|${routeId}`

class RallyPointRoute extends EventEmitter {
  constructor(owner, { address, port }, routeId, playerId) {
    super()
    this.owner = owner
    this.address = address
    this.port = port
    this.routeId = routeId
    this.playerId = playerId

    this._resolveReady = null
    this.ready = new Promise(resolve => {
      this._resolveReady = resolve
    })

    this.ready.then(() => this.emit('ready'))
  }

  async untilReady() {
    await this.ready
  }

  send(msg) {
    const packet = Forward.create(this.routeId, this.playerId, msg)
    this.owner.socket.send(packet, 0, packet.length, this.port, this.address)
  }

  keepAlive() {
    const packet = KeepAlive.create(this.routeId, this.playerId)
    this.owner.socket.send(packet, 0, packet.length, this.port, this.address)
  }

  _onRouteReady() {
    this._resolveReady()
  }

  _onReceive(msg, rinfo) {
    this._resolveReady()
    this.emit('message', Receive.getData(msg), this)
  }
}

export class RallyPointPlayer {
  constructor(host, port) {
    this.host = host
    this.port = port
    this.bound = false
    this.pings = new Map()
    this.joins = new Map()
    this.joinedServers = new Set()
    this.activeRoutes = new Map()

    this.socket = dgram.createSocket('udp6')
    this.socket.on('message', (msg, rinfo) => this._onMessage(msg, rinfo))
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
    for (const ping of this.pings.values()) {
      ping.resolve({ time: Number.MAX_VALUE, server: { address: ping.address, port: ping.port } })
    }
    this.pings.clear()

    for (const join of this.joins.values()) {
      join.reject('Join failed due to closing socket')
    }
    this.joins.clear()

    this.joinedServers.clear()
    this.activeRoutes.clear()
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
    const promises = servers.map(({ address, port }) =>
      new Promise((resolve, reject) => {
        const id = getPingId()
        const timeoutId = setTimeout(() => {
          this.pings.delete(id)
          reject(new Error(`Ping to ${address}:${port} timed out`))
        }, PING_TIMEOUT)

        this.pings.set(id, { address, port, start: monotonicNow(), resolve, timeoutId })
        const packet = Ping.create(pingId)
        this.socket.send(packet, 0, packet.length, port, address)
      }).then(
        time => ({ time, server: { address, port } }),
        () => ({ time: Number.MAX_VALUE, server: { address, port } }),
      ),
    )

    return Promise.all(promises)
  }

  async joinRoute({ address, port }, routeId, playerId, timeout = 5000) {
    const key = getRouteKey(address, port, routeId)
    const p = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Joining route timed out'))
      }, timeout)
      const state = {
        resolve,
        reject,
        timeoutId,
        routeId,
        playerId,
        resendId: null,
      }

      this.joins.set(key, state)
      this.joinedServers.add(`${address}:${port}`)
      this._sendJoin(address, port, state)
    })

    try {
      return await p
    } finally {
      if (this.joins.has(key)) {
        const state = this.joins.get(key)
        this.joins.delete(key)
        if (state.resendId) {
          clearTimeout(state.resendId)
        }
        if (state.timeoutId) {
          clearTimeout(state.timeoutId)
        }
      }
    }
  }

  _sendJoin(address, port, state) {
    state.resendId = setTimeout(() => this._sendJoin(address, port, state), RESEND_TIMEOUT)
    const msg = JoinRoute.create(state.routeId, state.playerId)
    this.socket.send(msg, 0, msg.length, port, address)
  }

  _onJoinSuccess(msg, rinfo) {
    if (!JoinRouteSuccess.validate(msg)) {
      return
    }

    const routeId = JoinRouteSuccess.getRouteId(msg)
    const key = getRouteKey(rinfo.address, rinfo.port, routeId)
    let playerId
    let joinState
    if (!this.joins.has(key)) {
      if (!this.activeRoutes.has(key)) {
        // We'd like to ack this, but we don't have a player ID so tough luck
        return
      } else {
        playerId = this.activeRoutes.get(key).playerId
      }
    } else {
      joinState = this.joins.get(key)
      playerId = joinState.playerId
    }

    const ack = JoinRouteSuccessAck.create(routeId, playerId)
    this.socket.send(ack, 0, ack.length, rinfo.port, rinfo.address)

    if (!joinState) {
      return
    }

    const route = new RallyPointRoute(this, rinfo, routeId, playerId)
    this.activeRoutes.set(key, route)
    joinState.resolve(route)
  }

  _onJoinFailure(msg, rinfo) {
    if (!JoinRouteFailure.validate(msg)) {
      return
    }
    if (!this.joinedServers.has(`${rinfo.address}:${rinfo.port}`)) {
      return
    }

    const routeId = JoinRouteFailure.getRouteId(msg)
    const failureId = JoinRouteFailure.getFailureId(msg)
    const ack = JoinRouteFailureAck.create(failureId)
    this.socket.send(ack, 0, ack.length, rinfo.port, rinfo.address)

    const key = getRouteKey(rinfo.address, rinfo.port, routeId)
    if (this.joins.has(key)) {
      const state = this.joins.get(key)
      state.reject(new Error('Joining route failed'))
    }
  }

  _onRouteReady(msg, rinfo) {
    if (!RouteReady.validate(msg)) {
      return
    }

    const routeId = RouteReady.getRouteId(msg)
    const key = getRouteKey(rinfo.address, rinfo.port, routeId)
    if (!this.activeRoutes.has(key)) {
      return
    }

    const route = this.activeRoutes.get(key)
    const ack = RouteReadyAck.create(route.routeId, route.playerId)
    this.socket.send(ack, 0, ack.length, rinfo.port, rinfo.address)

    route._onRouteReady()
  }

  _onReceive(msg, rinfo) {
    if (!Receive.validate(msg)) {
      return
    }

    const routeId = Receive.getRouteId(msg)
    const key = getRouteKey(rinfo.address, rinfo.port, routeId)
    if (!this.activeRoutes.has(key)) {
      return
    }

    const route = this.activeRoutes.get(key)
    route._onReceive(msg, rinfo)
  }

  _onPing(msg, rinfo) {
    if (!Ping.validate(msg)) {
      return
    }

    const id = Ping.getPingId(msg)
    if (this.pings.has(id)) {
      const state = this.pings.get(id)
      if (state.address === rinfo.address && state.port === rinfo.port) {
        const time = monotonicNow() - state.start
        this.pings.delete(id)
        clearTimeout(state.timeoutId)
        state.resolve(time)
      }
    }
  }

  _onMessage(msg, rinfo) {
    if (msg.length < 1) return

    const type = msg.readUInt8(0)
    switch (type) {
      case MSG_JOIN_ROUTE_SUCCESS:
        this._onJoinSuccess(msg, rinfo)
        break
      case MSG_JOIN_ROUTE_FAILURE:
        this._onJoinFailure(msg, rinfo)
        break
      case MSG_ROUTE_READY:
        this._onRouteReady(msg, rinfo)
        break
      case MSG_RECEIVE:
        this._onReceive(msg, rinfo)
        break
      case MSG_PING:
        this._onPing(msg, rinfo)
        break
    }
  }
}

export default RallyPointPlayer
