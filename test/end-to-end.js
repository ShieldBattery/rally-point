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
  beforeEach(async () => {
    server = createServer(HOST, SERVER_PORT, SECRET)
    routeCreator = new RouteCreator(HOST, CREATOR_PORT, SECRET)

    await Promise.all([
      server.bind(),
      routeCreator.bind(),
    ])
  })

  afterEach(() => {
    server.close()
    routeCreator.close()
  })

  it('should be able to forward packets between two clients', async () => {
    const { routeId, p1Id, p2Id } = await routeCreator.createRoute(HOST, SERVER_PORT)

    console.log(`routeId: ${routeId}, p1: ${p1Id}, p2: ${p2Id}`)
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
