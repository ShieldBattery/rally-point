import nconf from 'nconf'
import path from 'path'
import createServer from './create-server'

nconf.env()
nconf.argv()
nconf.file(path.join(__dirname, 'config.json'))
nconf.defaults({
  host: '::1',
  port: 14098,
})

nconf.required([
  'secret',
])

const server = createServer(nconf.get('host'), nconf.get('port'), nconf.get('secret'))
setInterval(() => {
  console.log(`${server.numRoutes} routes active`)
}, 5 * 60 * 1000)
server.bind().then(() => {
  console.log(`listening on ${server.host}:${server.port}`)
})
