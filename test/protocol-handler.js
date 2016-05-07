import { expect } from 'chai'
import {
  CreateRoute,
  CreateRouteSuccess,
  CreateRouteSuccessAck,
  MSG_CREATE_ROUTE_SUCCESS,
} from '../packets'

import { ProtocolHandler } from '../create-server'

const SECRET = 'hell0w0rld'
const CREATOR_RINFO = {
  address: '::1',
  port: 1337,
  family: 'IPv6',
}

ProtocolHandler.ACK_TIMEOUT = 1

function ackTimeout(numTimeouts = 2) {
  return new Promise(resolve => setTimeout(resolve, ProtocolHandler.ACK_TIMEOUT * numTimeouts))
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

  it('should handle route setup happy case', async () => {
    const msg = CreateRoute.create(SECRET, 0x11111111, 0x22222222)

    handler.onMessage(msg, CREATOR_RINFO)

    expect(sent).to.have.lengthOf(1)
    const response = sent[0]
    expect(CreateRouteSuccess.validate(response.msg)).to.be.true
    expect(response.msg[0]).to.eql(MSG_CREATE_ROUTE_SUCCESS)
    expect(CreateRouteSuccess.getPlayerOneId(response.msg)).to.eql(0x11111111)
    expect(CreateRouteSuccess.getPlayerTwoId(response.msg)).to.eql(0x22222222)
    expect(response.port).to.eql(CREATOR_RINFO.port)
    expect(response.address).to.eql(CREATOR_RINFO.address)

    const routeId = CreateRouteSuccess.getRouteId(response.msg)
    const ack = CreateRouteSuccessAck.create(routeId)

    handler.onMessage(ack, CREATOR_RINFO)
    await ackTimeout()

    // Expect no more messages to have been sent
    expect(sent).to.have.lengthOf(1)
  })
})
