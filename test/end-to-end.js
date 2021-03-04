import { expect } from 'chai'

import createServer from '../create-server'
import RouteCreator from '../route-creator'
import Player from '../player'

const SECRET = 'hell0w0rld'
const HOST = '::1'
const SERVER_PORT = 56666
const CREATOR_PORT = 56667
const P1_PORT = 56668
const P2_PORT = 56669

describe('Server and clients', function() {
  this.timeout(10000)

  let server
  let routeCreator
  let players
  beforeEach(async () => {
    server = createServer(HOST, SERVER_PORT, SECRET)
    routeCreator = new RouteCreator(HOST, CREATOR_PORT, SECRET)
    players = []

    await Promise.all([
      server.bind(),
      routeCreator.bind(),
    ])
  })

  afterEach(() => {
    for (const p of players) {
      p.close()
    }
    server.close()
    routeCreator.close()
  })

  it('should be able to have clients ping servers', async () => {
    const player = new Player(HOST, P1_PORT)
    players.push(player)
    await player.bind()
    const results = await player.pingServers([
      { address: HOST, port: SERVER_PORT },
      { address: HOST, port: SERVER_PORT },
    ])

    expect(results).to.have.lengthOf(2)
    expect(results[0].server).to.eql({ address: HOST, port: SERVER_PORT })
    expect(results[0]).to.include.key('time')
  })

  it('should be able to forward packets between two clients', async () => {
    const p1 = new Player(HOST, P1_PORT)
    players.push(p1)
    const p2 = new Player(HOST, P2_PORT)
    players.push(p2)
    await Promise.all([ p1.bind(), p2.bind() ])
    const { routeId, p1Id, p2Id } = await routeCreator.createRoute(HOST, SERVER_PORT)

    const p1Route = await p1.joinRoute({ address: HOST, port: SERVER_PORT }, routeId, p1Id)
    const p2Route = await p2.joinRoute({ address: HOST, port: SERVER_PORT }, routeId, p2Id)

    const p1Received = new Promise(resolve => {
      p1Route.on('message', data => resolve(data))
    })
    const p2Received = new Promise(resolve => {
      p2Route.on('message', data => resolve(data))
    })

    p1Route.send(Buffer.from('hello'))
    p2Route.send(Buffer.from('hi'))

    const received = await Promise.all([p1Received, p2Received])
    expect(received[0].toString('utf8')).to.eql('hi')
    expect(received[1].toString('utf8')).to.eql('hello')
  })

  it('should get route creation failures when secret is wrong', async () => {
    routeCreator.close()
    // We bind on a different port here to avoid colliding with the old RouteCreator
    routeCreator = new RouteCreator(HOST, P1_PORT, 'wrongsecret')
    await routeCreator.bind()
    try {
      await routeCreator.createRoute(HOST, SERVER_PORT)
      throw new Error('Expected an Error to be thrown')
    } catch (err) {
      expect(err).to.not.be.null
    }
  })
})
