import * as dgram from 'node:dgram'
import {
  CreateRoute,
  CreateRouteSuccess,
  CreateRouteSuccessAck,
  CreateRouteFailure,
  CreateRouteFailureAck,
  MSG_CREATE_ROUTE_SUCCESS,
  MSG_CREATE_ROUTE_FAILURE,
} from './packets.js'

const RESEND_TIMEOUT = 500

function genPlayerId() {
  const date = Date.now() & 0xfff
  const rand = Math.random() * 0xfffff
  return ((date << 20) | rand) >>> 0
}

export class RallyPointCreator {
  constructor(host, port, secret) {
    this.host = host
    this.port = port
    this.secret = secret
    this.bound = false
    this.outstanding = new Map()

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
    this.socket.close()
  }

  addErrorHandler(fn) {
    this.socket.on('error', fn)
  }

  removeErrorHandler(fn) {
    this.socket.removeEventListener('error', fn)
  }

  async createRoute(host, port, timeout = 5000) {
    const key = `${host}:${port}`
    const p1Id = genPlayerId()
    const p2Id = genPlayerId()
    const requestKey = `${p1Id}|${p2Id}`

    const p = new Promise((resolve, reject) => {
      const state = {
        p1Id,
        p2Id,
        resolve,
        reject,
        resendId: null,
        timeoutId: null,
      }

      let serverRequests
      if (!this.outstanding.has(key)) {
        serverRequests = new Map()
        this.outstanding.set(key, serverRequests)
      } else {
        serverRequests = this.outstanding.get(key)
      }

      serverRequests.set(requestKey, state)
      this._sendCreateRoute(host, port, state)

      state.timeoutId = setTimeout(() => reject(new Error('Route creation timed out')), timeout)
    })

    try {
      return await p
    } finally {
      const serverRequests = this.outstanding.get(key)
      if (serverRequests.has(requestKey)) {
        const state = serverRequests.get(requestKey)
        serverRequests.delete(requestKey)
        if (state.resendId) {
          clearTimeout(state.resendId)
        }
        if (state.timeoutId) {
          clearTimeout(state.timeoutId)
        }
      }
    }
  }

  _sendCreateRoute(host, port, state) {
    state.resendId = setTimeout(() => this._sendCreateRoute(host, port, state), RESEND_TIMEOUT)
    const msg = CreateRoute.create(this.secret, state.p1Id, state.p2Id)
    this.socket.send(msg, 0, msg.length, port, host)
  }

  _onCreateSuccess(serverRequests, msg, rinfo) {
    if (!CreateRouteSuccess.validate(msg)) {
      return
    }

    const routeId = CreateRouteSuccess.getRouteId(msg)
    const ack = CreateRouteSuccessAck.create(routeId)
    this.socket.send(ack, 0, ack.length, rinfo.port, rinfo.address)

    const p1Id = CreateRouteSuccess.getPlayerOneId(msg)
    const p2Id = CreateRouteSuccess.getPlayerTwoId(msg)
    const key = `${p1Id}|${p2Id}`
    if (serverRequests.has(key)) {
      const state = serverRequests.get(key)
      state.resolve({ p1Id, p2Id, routeId })
    }
  }

  _onCreateFailure(serverRequests, msg, rinfo) {
    if (!CreateRouteFailure.validate(msg)) {
      return
    }

    const failureId = CreateRouteFailure.getFailureId(msg)
    const ack = CreateRouteFailureAck.create(failureId)
    this.socket.send(ack, 0, ack.length, rinfo.port, rinfo.address)

    const p1Id = CreateRouteFailure.getPlayerOneId(msg)
    const p2Id = CreateRouteFailure.getPlayerTwoId(msg)
    const key = `${p1Id}|${p2Id}`
    if (serverRequests.has(key)) {
      const state = serverRequests.get(key)
      state.reject(new Error('Route creation failed'))
    }
  }

  _onMessage(msg, rinfo) {
    if (msg.length < 1) return

    const key = `${rinfo.address}:${rinfo.port}`
    if (!this.outstanding.has(key)) return
    const serverRequests = this.outstanding.get(key)

    const type = msg.readUInt8(0)
    switch (type) {
      case MSG_CREATE_ROUTE_SUCCESS:
        this._onCreateSuccess(serverRequests, msg, rinfo)
        break
      case MSG_CREATE_ROUTE_FAILURE:
        this._onCreateFailure(serverRequests, msg, rinfo)
        break
    }
  }
}

export default RallyPointCreator
