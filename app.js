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

createServer(nconf.get('host'), nconf.get('port'), nconf.get('secret'))
