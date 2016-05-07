import crypto from 'crypto'

function sign(secret, buf) {
  return crypto.createHmac('sha256', secret).update(buf).digest()
}

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
  }
}

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

export const MSG_CREATE_ROUTE_FAILURE = 0x03

export const MSG_CREATE_ROUTE_FAILURE_ACK = 0x04
