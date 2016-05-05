import { expect } from 'chai'
import crypto from 'crypto'
import {
  MSG_CREATE_ROUTE,
  LENGTH_MSG_CREATE_ROUTE,
  MSG_CREATE_ROUTE_SUCCESS,
  LENGTH_MSG_CREATE_ROUTE_SUCCESS
} from '../protocol-constants'

import { ProtocolHandler } from '../create-server'

const SECRET = 'hell0w0rld'
const SERVER_RINFO = {
  address: '::1',
  port: 1337,
  family: 'IPv6',
}

function sign(buf) {
  return crypto.createHmac('sha256', SECRET).update(buf).digest()
}

describe('ProtocolHandler', () => {
  let sent
  let handler
  beforeEach(() => {
    sent = []
    handler = new ProtocolHandler(SECRET, (msg, offset, length, port, address) => {
      const copied = Buffer.alloc(length)
      msg.copy(copied, 0, offset, length)
      sent.push({ msg: copied, port, address })
    })
  })

  afterEach(() => {
    handler.cleanup()
  })

  it('should handle route setup messages', () => {
    const msg = Buffer.allocUnsafe(LENGTH_MSG_CREATE_ROUTE)
    msg.writeUInt8(MSG_CREATE_ROUTE, 0)
    msg.writeUInt32LE(0x11111111, 1)
    msg.writeUInt32LE(0x22222222, 5)
    const signature = sign(msg.slice(0, 1 + 4 + 4))
    signature.copy(msg, 9)

    handler.onMessage(msg, SERVER_RINFO)

    expect(sent).to.have.lengthOf(1)
    const response = sent[0]
    expect(response.msg).to.have.lengthOf(LENGTH_MSG_CREATE_ROUTE_SUCCESS)
    expect(response.msg[0]).to.eql(MSG_CREATE_ROUTE_SUCCESS)
    expect(response.port).to.eql(SERVER_RINFO.port)
    expect(response.address).to.eql(SERVER_RINFO.address)
  })
})
