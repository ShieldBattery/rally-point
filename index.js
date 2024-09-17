import nconf from 'nconf'
import * as path from 'node:path'
import createServer from './create-server.js'

nconf.env({ lowerCase: true })
nconf.argv()
nconf.file(path.join(__dirname, 'config.json'))
nconf.defaults({
  // eslint-disable-next-line camelcase
  rp_host: '::1',
  // eslint-disable-next-line camelcase
  rp_port: 14098,
  // eslint-disable-next-line camelcase
  is_fly: false,
})

nconf.required(['secret'])

console.log(`Settings: {
rp_host: ${nconf.get('rp_host')},
is_fly: ${nconf.get('is_fly')},
}`)

const server = createServer(
  nconf.get('rp_host'),
  Number(nconf.get('rp_port')),
  nconf.get('secret'),
  nconf.get('is_fly') === 'true',
)
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
