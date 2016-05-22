import { expect } from 'chai'
import {
  CreateRoute,
  CreateRouteFailure,
  CreateRouteFailureAck,
  CreateRouteSuccess,
  CreateRouteSuccessAck,
  JoinRoute,
  JoinRouteFailure,
  JoinRouteFailureAck,
  JoinRouteSuccess,
  JoinRouteSuccessAck,
  MSG_CREATE_ROUTE,
  MSG_CREATE_ROUTE_FAILURE,
  MSG_CREATE_ROUTE_SUCCESS,
  MSG_JOIN_ROUTE_FAILURE,
  MSG_JOIN_ROUTE_SUCCESS,
} from '../packets'

import { ProtocolHandler } from '../create-server'

const SECRET = 'hell0w0rld'
const CREATOR_RINFO = {
  address: '::1',
  port: 1337,
  family: 'IPv6',
}

ProtocolHandler.ACK_TIMEOUT = 4

function ackTimeout(numTimeouts = 2) {
  return new Promise(resolve => setTimeout(resolve, ProtocolHandler.ACK_TIMEOUT * numTimeouts))
}

describe('ProtocolHandler - Creators', () => {
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

  it('should re-send route setup success until an ack is received', async () => {
    const msg = CreateRoute.create(SECRET, 0x11111111, 0x22222222)

    handler.onMessage(msg, CREATOR_RINFO)

    expect(sent).to.have.lengthOf(1)
    const response = sent[0]
    await ackTimeout()

    // Expect some repeat messages
    expect(sent).to.have.length.above(1)
    expect(sent[1].msg[0]).to.eql(MSG_CREATE_ROUTE_SUCCESS)
    expect(CreateRouteSuccess.getRouteId(response.msg))
      .to.eql(CreateRouteSuccess.getRouteId(sent[1].msg))
    const lastSentCount = sent.length

    const routeId = CreateRouteSuccess.getRouteId(response.msg)
    const ack = CreateRouteSuccessAck.create(routeId)

    handler.onMessage(ack, CREATOR_RINFO)
    await ackTimeout()

    expect(sent).to.have.lengthOf(lastSentCount)
  })

  it('should give up on successfully created route if no ack is received', async () => {
    const msg = CreateRoute.create(SECRET, 0x11111111, 0x22222222)

    handler.onMessage(msg, CREATOR_RINFO)

    expect(sent).to.have.lengthOf(1)
    const response = sent[0]
    await ackTimeout(ProtocolHandler.MAX_RESENDS + 1)

    // Expect some repeat messages
    expect(sent).to.have.length.above(1)
    expect(sent[1].msg[0]).to.eql(MSG_CREATE_ROUTE_SUCCESS)
    expect(CreateRouteSuccess.getRouteId(response.msg))
      .to.eql(CreateRouteSuccess.getRouteId(sent[1].msg))
    const lastSentCount = sent.length

    await ackTimeout()
    expect(sent).to.have.lengthOf(lastSentCount)
  })

  it('should ignore incorrectly sized route creation requests', async () => {
    const msg = Buffer.allocUnsafe(1)
    msg[0] = MSG_CREATE_ROUTE

    handler.onMessage(msg, CREATOR_RINFO)

    expect(sent).to.have.lengthOf(0)
  })

  it('should reject route creation requests with invalid signatures', async () => {
    const msg = CreateRoute.create('oh noes', 0x11111111, 0x22222222)

    handler.onMessage(msg, CREATOR_RINFO)

    expect(sent).to.have.lengthOf(1)
    const response = sent[0]
    expect(response.msg[0]).to.eql(MSG_CREATE_ROUTE_FAILURE)
  })

  it('should reject route creation requests with equal player ids', async () => {
    const msg = CreateRoute.create(SECRET, 0x11111111, 0x11111111)

    handler.onMessage(msg, CREATOR_RINFO)

    expect(sent).to.have.lengthOf(1)
    const response = sent[0]
    expect(response.msg[0]).to.eql(MSG_CREATE_ROUTE_FAILURE)
  })

  it('should re-send route creation failures until acked', async() => {
    const msg = CreateRoute.create('oh noes', 0x11111111, 0x22222222)

    handler.onMessage(msg, CREATOR_RINFO)

    expect(sent).to.have.lengthOf(1)
    const response = sent[0]
    await ackTimeout()

    // Expect some repeat messages
    expect(sent).to.have.length.above(1)
    expect(sent[1].msg[0]).to.eql(MSG_CREATE_ROUTE_FAILURE)
    expect(CreateRouteFailure.getFailureId(response.msg))
      .to.eql(CreateRouteFailure.getFailureId(sent[1].msg))
    const lastSentCount = sent.length

    const failureId = CreateRouteFailure.getFailureId(response.msg)
    const ack = CreateRouteFailureAck.create(failureId)

    handler.onMessage(ack, CREATOR_RINFO)
    await ackTimeout()

    expect(sent).to.have.lengthOf(lastSentCount)
  })

  it('should give up on notifying of failed route creation if no ack is received', async () => {
    const msg = CreateRoute.create('oh noes', 0x11111111, 0x22222222)

    handler.onMessage(msg, CREATOR_RINFO)

    expect(sent).to.have.lengthOf(1)
    const response = sent[0]
    await ackTimeout(ProtocolHandler.MAX_RESENDS + 1)

    // Expect some repeat messages
    expect(sent).to.have.length.above(1)
    expect(sent[1].msg[0]).to.eql(MSG_CREATE_ROUTE_FAILURE)
    expect(CreateRouteFailure.getFailureId(response.msg))
      .to.eql(CreateRouteFailure.getFailureId(sent[1].msg))
    const lastSentCount = sent.length

    await ackTimeout()
    expect(sent).to.have.lengthOf(lastSentCount)
  })
})

const P1_RINFO = {
  address: '::ffff:10.0.0.1',
  port: 3456,
  family: 'IPv6',
}
const P2_RINFO = {
  address: '::ffff:10.0.0.2',
  port: 6543,
  family: 'IPv6',
}
describe('ProtocolHandler - Players', () => {
  let sent
  let routeId

  const handler = new ProtocolHandler(SECRET, (msg, offset, length, port, address) => {
    const copied = Buffer.alloc(length)
    msg.copy(copied, 0, offset, length)
    if (port === P1_RINFO.port && address === P1_RINFO.address) {
      sent.p1.push(copied)
    } else if (port === P2_RINFO.port && address === P2_RINFO.address) {
      sent.p2.push(copied)
    } else if (port === CREATOR_RINFO.port && address === CREATOR_RINFO.address) {
      if (copied[0] !== MSG_CREATE_ROUTE_SUCCESS) {
        return
      }
      routeId = CreateRouteSuccess.getRouteId(copied)
      const ack = CreateRouteSuccessAck.create(routeId)
      handler.onMessage(ack, CREATOR_RINFO)
    }
  })

  beforeEach(() => {
    sent = {
      p1: [],
      p2: [],
    }

    const create = CreateRoute.create(SECRET, 0x11111111, 0x22222222)
    handler.onMessage(create, CREATOR_RINFO)
  })

  afterEach(() => {
    handler.cleanup()
  })

  it('should handle join route happy case', async () => {
    const msg = JoinRoute.create(routeId, 0x11111111)

    handler.onMessage(msg, P1_RINFO)

    expect(sent.p1).to.have.lengthOf(1)
    const response = sent.p1[0]
    expect(JoinRouteSuccess.validate(response)).to.be.true
    expect(response[0]).to.eql(MSG_JOIN_ROUTE_SUCCESS)
    expect(JoinRouteSuccess.getRouteId(response)).to.eql(routeId)

    const ack = JoinRouteSuccessAck.create(routeId, 0x11111111)

    handler.onMessage(ack, P1_RINFO)
    await ackTimeout()

    // Expect no more messages to have been sent
    expect(sent.p1).to.have.lengthOf(1)
  })

  it('should re-send join route success until ack is received', async () => {
    const msg = JoinRoute.create(routeId, 0x11111111)

    handler.onMessage(msg, P1_RINFO)

    expect(sent.p1).to.have.lengthOf(1)
    const response = sent.p1[0]
    await ackTimeout()

    // Expect some repeat messages
    expect(sent.p1).to.have.length.above(1)
    expect(sent.p1[1][0]).to.eql(MSG_JOIN_ROUTE_SUCCESS)
    expect(JoinRouteSuccess.getRouteId(response))
      .to.eql(JoinRouteSuccess.getRouteId(sent.p1[1]))
    const lastSentCount = sent.p1.length

    const ack = JoinRouteSuccessAck.create(routeId, 0x11111111)
    handler.onMessage(ack, P1_RINFO)
    await ackTimeout()

    expect(sent.p1).to.have.lengthOf(lastSentCount)
  })

  it('should give up on successfully joined route if no ack is received', async () => {
    const msg = JoinRoute.create(routeId, 0x11111111)

    handler.onMessage(msg, P1_RINFO)

    expect(sent.p1).to.have.lengthOf(1)
    const response = sent.p1[0]

    await ackTimeout(ProtocolHandler.MAX_RESENDS + 1)

    // Expect some repeat messages
    expect(sent.p1).to.have.length.above(1)
    expect(sent.p1[1][0]).to.eql(MSG_JOIN_ROUTE_SUCCESS)
    expect(JoinRouteSuccess.getRouteId(response))
      .to.eql(JoinRouteSuccess.getRouteId(sent.p1[1]))
    const lastSentCount = sent.p1.length

    await ackTimeout()
    expect(sent.p1).to.have.lengthOf(lastSentCount)
  })

  it('should handle join route failures - nonexistent routes', async () => {
    const msg = JoinRoute.create('deadbeef', 0x11111111)

    handler.onMessage(msg, P1_RINFO)

    expect(sent.p1).to.have.lengthOf(1)
    const response = sent.p1[0]
    expect(JoinRouteFailure.validate(response)).to.be.true
    expect(response[0]).to.eql(MSG_JOIN_ROUTE_FAILURE)
    expect(JoinRouteFailure.getRouteId(response)).to.eql('deadbeef')

    const failureId = JoinRouteFailure.getFailureId(response)
    const ack = JoinRouteFailureAck.create(failureId)

    handler.onMessage(ack, P1_RINFO)
    await ackTimeout()

    // Expect no more messages to have been sent
    expect(sent.p1).to.have.lengthOf(1)
  })

  it('should handle join route failures - incorrect player id', async () => {
    const msg = JoinRoute.create(routeId, 0x55555555)

    handler.onMessage(msg, P1_RINFO)

    expect(sent.p1).to.have.lengthOf(1)
    const response = sent.p1[0]
    expect(JoinRouteFailure.validate(response)).to.be.true
    expect(response[0]).to.eql(MSG_JOIN_ROUTE_FAILURE)
    expect(JoinRouteFailure.getRouteId(response)).to.eql(routeId)

    const failureId = JoinRouteFailure.getFailureId(response)
    const ack = JoinRouteFailureAck.create(failureId)

    handler.onMessage(ack, P1_RINFO)
    await ackTimeout()

    // Expect no more messages to have been sent
    expect(sent.p1).to.have.lengthOf(1)
  })

  it('should re-send join route failure messages until ack is received', async () => {
    const msg = JoinRoute.create('deadbeef', 0x11111111)

    handler.onMessage(msg, P1_RINFO)

    expect(sent.p1).to.have.lengthOf(1)
    const response = sent.p1[0]
    await ackTimeout()

    // Expect some repeat messages
    expect(sent.p1).to.have.length.above(1)
    expect(sent.p1[1][0]).to.eql(MSG_JOIN_ROUTE_FAILURE)
    expect(JoinRouteFailure.getFailureId(response))
      .to.eql(JoinRouteFailure.getFailureId(sent.p1[1]))
    const lastSentCount = sent.p1.length

    const failureId = JoinRouteFailure.getFailureId(response)
    const ack = JoinRouteFailureAck.create(failureId)
    handler.onMessage(ack, P1_RINFO)
    await ackTimeout()

    expect(sent.p1).to.have.lengthOf(lastSentCount)
  })

  it('should give up on sending join route failure messages if no ack is received', async () => {
    const msg = JoinRoute.create('deadbeef', 0x11111111)

    handler.onMessage(msg, P1_RINFO)

    expect(sent.p1).to.have.lengthOf(1)
    const response = sent.p1[0]

    await ackTimeout(ProtocolHandler.MAX_RESENDS + 1)

    // Expect some repeat messages
    expect(sent.p1).to.have.length.above(1)
    expect(sent.p1[1][0]).to.eql(MSG_JOIN_ROUTE_FAILURE)
    expect(JoinRouteFailure.getFailureId(response))
      .to.eql(JoinRouteFailure.getFailureId(sent.p1[1]))
    const lastSentCount = sent.p1.length

    await ackTimeout()
    expect(sent.p1).to.have.lengthOf(lastSentCount)
  })
})
