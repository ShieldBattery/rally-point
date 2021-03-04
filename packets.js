import crypto from 'crypto'

function sign(secret, buf) {
  return crypto.createHmac('sha256', secret).update(buf).digest()
}

// Intended to be sent from creators to rally-point.
// Asks rally-point to create a new route for 2 specified player IDs.
export const MSG_CREATE_ROUTE = 0x00
export const LENGTH_MSG_CREATE_ROUTE = 1 + 4 /* player 1 ID */ + 4 /* player 2 ID */ + 32 /* mac */
export const CreateRoute = {
  create(secret, playerOneId, playerTwoId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_CREATE_ROUTE)
    msg.writeUInt8(MSG_CREATE_ROUTE, 0)
    msg.writeUInt32LE(playerOneId, 1)
    msg.writeUInt32LE(playerTwoId, 5)
    const signature = sign(secret, msg.slice(0, 1 + 4 + 4))
    signature.copy(msg, 9)

    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_CREATE_ROUTE
  },

  verifySignature(secret, msg) {
    const data = msg.slice(0, 1 + 4 + 4)
    const signature = msg.slice(data.length)

    const expected = crypto.createHmac('sha256', secret).update(data).digest()
    let matching = true
    // don't break early here to avoid exposing when the signature mismatched via timing
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== signature[i]) {
        matching = false
      }
    }
    return matching
  },

  getPlayerOneId(msg) {
    return msg.readUInt32LE(1)
  },

  getPlayerTwoId(msg) {
    return msg.readUInt32LE(5)
  },
}

// Intended to be sent from rally-point to creators.
// Indicates that their route creation request was successful and provides a unique route
// identifier that players must use to join the route.
export const MSG_CREATE_ROUTE_SUCCESS = 0x01
export const LENGTH_MSG_CREATE_ROUTE_SUCCESS =
  1 + 4 /* player 1 ID */ + 4 /* player 2 ID */ + 8 /* route ID */
export const CreateRouteSuccess = {
  create(playerOneId, playerTwoId, routeId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_CREATE_ROUTE_SUCCESS)
    msg.writeUInt8(MSG_CREATE_ROUTE_SUCCESS, 0)
    msg.writeUInt32LE(playerOneId, 1)
    msg.writeUInt32LE(playerTwoId, 5)
    msg.write(routeId, 9)

    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_CREATE_ROUTE_SUCCESS
  },

  getPlayerOneId(msg) {
    return msg.readUInt32LE(1)
  },

  getPlayerTwoId(msg) {
    return msg.readUInt32LE(5)
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1 + 4 + 4)
  },
}

// Intended to be sent from creators to rally-point.
// Indicates that the creator received the route success message.
export const MSG_CREATE_ROUTE_SUCCESS_ACK = 0x02
export const LENGTH_MSG_CREATE_ROUTE_SUCCESS_ACK = 1 + 8 /* route ID */
export const CreateRouteSuccessAck = {
  create(routeId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_CREATE_ROUTE_SUCCESS_ACK)
    msg.writeUInt8(MSG_CREATE_ROUTE_SUCCESS_ACK, 0)
    msg.write(routeId, 1)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_CREATE_ROUTE_SUCCESS_ACK
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1)
  },
}

// Intended to be sent from rally-point to creators.
// Indicates that the route creation request has failed.
// Failures are generally for programming/signing errors, no other failures should generally occur.
export const MSG_CREATE_ROUTE_FAILURE = 0x03
export const LENGTH_MSG_CREATE_ROUTE_FAILURE =
  1 + 4 /* player 1 ID */ + 4 /* player 2 ID */ + 8 /* failure ID */
export const CreateRouteFailure = {
  create(playerOneId, playerTwoId, failureId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_CREATE_ROUTE_FAILURE)
    msg.writeUInt8(MSG_CREATE_ROUTE_FAILURE, 0)
    msg.writeUInt32LE(playerOneId, 1)
    msg.writeUInt32LE(playerTwoId, 5)
    msg.write(failureId, 9)

    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_CREATE_ROUTE_FAILURE
  },

  getPlayerOneId(msg) {
    return msg.readUInt32LE(1)
  },

  getPlayerTwoId(msg) {
    return msg.readUInt32LE(5)
  },

  getFailureId(msg) {
    return msg.toString('utf8', 1 + 4 + 4)
  },
}

// Intended to be sent from creators to rally-point.
// Indicates that the creator has received notification that their request failed.
export const MSG_CREATE_ROUTE_FAILURE_ACK = 0x04
export const LENGTH_MSG_CREATE_ROUTE_FAILURE_ACK = 1 + 8 /* failure ID */
export const CreateRouteFailureAck = {
  create(failureId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_CREATE_ROUTE_FAILURE_ACK)
    msg.writeUInt8(MSG_CREATE_ROUTE_FAILURE_ACK, 0)
    msg.write(failureId, 1)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_CREATE_ROUTE_FAILURE_ACK
  },

  getFailureId(msg) {
    return msg.toString('utf8', 1)
  },
}

// Intended to be sent from players to rally-point
// Indicates that the player wants to join a particular route ID (and set their connection as one of
// the endpoints for it)
export const MSG_JOIN_ROUTE = 0x05
export const LENGTH_MSG_JOIN_ROUTE = 1 + 8 /* route ID */ + 4 /* player ID */
export const JoinRoute = {
  create(routeId, playerId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_JOIN_ROUTE)
    msg.writeUInt8(MSG_JOIN_ROUTE, 0)
    msg.write(routeId, 1)
    msg.writeUInt32LE(playerId, 9)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_JOIN_ROUTE
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1, 9)
  },

  getPlayerId(msg) {
    return msg.readUInt32LE(9)
  },
}

// Intended to be sent from rally-point to players
// Indicates that the player has successfully joined the route requested
export const MSG_JOIN_ROUTE_SUCCESS = 0x06
export const LENGTH_MSG_JOIN_ROUTE_SUCCESS = 1 + 8 /* routeID */
export const JoinRouteSuccess = {
  create(routeId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_JOIN_ROUTE_SUCCESS)
    msg.writeUInt8(MSG_JOIN_ROUTE_SUCCESS, 0)
    msg.write(routeId, 1)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_JOIN_ROUTE_SUCCESS
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1)
  },
}

// Intended to be sent from players to rally-point
// Indicates that they've received notification that they've successfully joined the route
export const MSG_JOIN_ROUTE_SUCCESS_ACK = 0x07
export const LENGTH_MSG_JOIN_ROUTE_SUCCESS_ACK = 1 + 8 /* routeID */ + 4 /* playerID */
export const JoinRouteSuccessAck = {
  create(routeId, playerId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_JOIN_ROUTE_SUCCESS_ACK)
    msg.writeUInt8(MSG_JOIN_ROUTE_SUCCESS_ACK, 0)
    msg.write(routeId, 1)
    msg.writeUInt32LE(playerId, 9)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_JOIN_ROUTE_SUCCESS_ACK
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1, 9)
  },

  getPlayerId(msg) {
    return msg.readUInt32LE(9)
  },
}

// Intended to be sent from rally-point to players
// Indicates that the player's join request has failed
export const MSG_JOIN_ROUTE_FAILURE = 0x08
export const LENGTH_MSG_JOIN_ROUTE_FAILURE = 1 + 8 /* routeID */ + 8 /* failureID */
export const JoinRouteFailure = {
  create(routeId, failureId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_JOIN_ROUTE_FAILURE)
    msg.writeUInt8(MSG_JOIN_ROUTE_FAILURE, 0)
    msg.write(routeId, 1)
    msg.write(failureId, 9)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_JOIN_ROUTE_FAILURE
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1, 9)
  },

  getFailureId(msg) {
    return msg.toString('utf8', 9)
  },
}

// Intended to be sent from players to rally-point.
// Indicates that the player has received notification that their join request failed.
export const MSG_JOIN_ROUTE_FAILURE_ACK = 0x09
export const LENGTH_MSG_JOIN_ROUTE_FAILURE_ACK = 1 + 8 /* failure ID */
export const JoinRouteFailureAck = {
  create(failureId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_JOIN_ROUTE_FAILURE_ACK)
    msg.writeUInt8(MSG_JOIN_ROUTE_FAILURE_ACK, 0)
    msg.write(failureId, 1)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_JOIN_ROUTE_FAILURE_ACK
  },

  getFailureId(msg) {
    return msg.toString('utf8', 1)
  },
}

// Intended to be sent from rally-point to players.
// Indicates that the specified route has both players and is ready to use for forwarding.
export const MSG_ROUTE_READY = 0x0a
export const LENGTH_MSG_ROUTE_READY = 1 + 8 /* route ID */
export const RouteReady = {
  create(routeId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_ROUTE_READY)
    msg.writeUInt8(MSG_ROUTE_READY, 0)
    msg.write(routeId, 1)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_ROUTE_READY
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1)
  },
}

// Intended to be sent from players to rally-point.
// Indicates that the player received the notification of route readiness.
export const MSG_ROUTE_READY_ACK = 0x0b
export const LENGTH_MSG_ROUTE_READY_ACK = 1 + 8 /* route ID */ + 4 /* player ID */
export const RouteReadyAck = {
  create(routeId, playerId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_ROUTE_READY_ACK)
    msg.writeUInt8(MSG_ROUTE_READY_ACK, 0)
    msg.write(routeId, 1)
    msg.writeUInt32LE(playerId, 9)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_ROUTE_READY_ACK
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1, 9)
  },

  getPlayerId(msg) {
    return msg.readUInt32LE(9)
  },
}

// Intended to be sent between players and rally-point (from either side)
// rally-point should send a keep-alive in response to this packet from a player
export const MSG_KEEP_ALIVE = 0x0c
export const LENGTH_MSG_KEEP_ALIVE = 1 + 8 /* route ID */ + 4 /* player ID */
export const KeepAlive = {
  create(routeId, playerId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_KEEP_ALIVE)
    msg.writeUInt8(MSG_KEEP_ALIVE, 0)
    msg.write(routeId, 1)
    msg.writeUInt32LE(playerId, 9)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_KEEP_ALIVE
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1, 9)
  },

  getPlayerId(msg) {
    return msg.readUInt32LE(9)
  },
}

// Intended to be sent from rally-point to players
// Contains data that the other player forwards to this one
export const MSG_RECEIVE = 0x0d
export const MIN_LENGTH_MSG_RECEIVE = 1 + 8 /* route ID */
export const Receive = {
  create(routeId, data, dataStart = 0, dataEnd) {
    const end = dataEnd === undefined ? data.length : dataEnd
    const msg = Buffer.allocUnsafe(MIN_LENGTH_MSG_RECEIVE + (end - dataStart))
    msg.writeUInt8(MSG_RECEIVE, 0)
    msg.write(routeId, 1)
    data.copy(msg, 9, dataStart, dataEnd)
    return msg
  },

  validate(msg) {
    return msg.length >= MIN_LENGTH_MSG_RECEIVE
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1, 9)
  },

  getData(msg) {
    return msg.slice(9)
  },
}

// Intended to be sent from players to rally-point
// Contains data that a player wants to forward to the other player
export const MSG_FORWARD = 0x0e
export const MIN_LENGTH_MSG_FORWARD = 1 + 8 /* route ID */ + 4 /* player ID */
export const Forward = {
  create(routeId, playerId, data) {
    const msg = Buffer.allocUnsafe(MIN_LENGTH_MSG_FORWARD + data.length)
    msg.writeUInt8(MSG_FORWARD, 0)
    msg.write(routeId, 1)
    msg.writeUInt32LE(playerId, 9)
    data.copy(msg, 13)
    return msg
  },

  validate(msg) {
    return msg.length >= MIN_LENGTH_MSG_FORWARD
  },

  getRouteId(msg) {
    return msg.toString('utf8', 1, 9)
  },

  getPlayerId(msg) {
    return msg.readUInt32LE(9)
  },

  getData(msg) {
    return msg.slice(13)
  },

  toReceive(msg) {
    return Receive.create(Forward.getRouteId(msg), msg, 13)
  },
}

// Intended to be sent from players to rally-point and back
// Contains an ID that the player can use to identify the source packet
export const MSG_PING = 0x0f
export const LENGTH_MSG_PING = 1 + 4 /* ping ID */
export const Ping = {
  create(pingId) {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_PING)
    msg.writeUInt8(MSG_PING, 0)
    msg.writeUInt32LE(pingId, 1)
    return msg
  },

  validate(msg) {
    return msg.length === LENGTH_MSG_PING
  },

  getPingId(msg) {
    return msg.readUInt32LE(1)
  },
}
