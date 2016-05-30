const fs = require('fs')
const path = require('path')
const babel = require('babel-core')

function babelify(project, file) {
  console.log('Babelifying ' + file + '...')
  fs.writeFileSync(path.join(__dirname, project, file),
      babel.transformFileSync(path.join(__dirname, file)).code)
}

// rally-point-server
console.log('rally-point-server')
babelify('rally-point-server', 'gen-id.js')
babelify('rally-point-server', 'packets.js')
babelify('rally-point-server', 'create-server.js')

// rally-point-creator
console.log('\nrally-point-creator')
babelify('rally-point-creator', 'packets.js')
babelify('rally-point-creator', 'route-creator.js')

// rally-point-player
console.log('\nrally-point-player')
babelify('rally-point-player', 'packets.js')
babelify('rally-point-player', 'player.js')
