import * as fs from 'node:fs'
import * as path from 'node:path'

function copy(project, file) {
  console.log('Copying ' + file + '...')
  fs.copyFileSync(
    path.join(import.meta.dirname, file),
    path.join(import.meta.dirname, project, file),
  )
}

// rally-point-server
console.log('rally-point-server')
copy('rally-point-server', 'gen-id.js')
copy('rally-point-server', 'packets.js')
copy('rally-point-server', 'create-server.js')

// rally-point-creator
console.log('\nrally-point-creator')
copy('rally-point-creator', 'packets.js')
copy('rally-point-creator', 'route-creator.js')

// rally-point-player
console.log('\nrally-point-player')
copy('rally-point-player', 'packets.js')
copy('rally-point-player', 'player.js')
