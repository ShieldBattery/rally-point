import nconf from 'nconf'
import path from 'path'
import createServer from './create-server'

nconf.env({ lowerCase: true })
nconf.argv()
nconf.file(path.join(__dirname, 'config.json'))
nconf.defaults({
  // eslint-disable-next-line camelcase
  rp_host: '::1',
  // eslint-disable-next-line camelcase
  rp_port: 14098,
})

nconf.required(['secret'])

const server = createServer(nconf.get('rp_host'), nconf.get('rp_port'), nconf.get('secret'))
setInterval(() => {
  console.log(`${server.numRoutes} routes active`)
}, 5 * 60 * 1000)
server.bind().then(
  () => {
    console.log(`listening on ${server.host}:${server.port}`)
  },
  err => {
    console.error('Error: ' + err + '\n' + err.stack)
    process.exit(1)
  },
)
