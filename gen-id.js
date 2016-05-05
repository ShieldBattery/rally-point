// ID generation similar to cuid.slug, but without process fingerprints since they aren't useful for
// this application (and removing them frees up some more bytes for more entropy). Also keeps a
// constant size at all times
const blockSize = 4
const base = 36
const discreteValues = Math.pow(base, blockSize)

function random() {
  return (Math.random() * discreteValues << 0).toString(base)
}

let c = 0
function counter() {
  c = c < discreteValues ? c : 0
  return c++
}

const pad = (str, size) => ('0000' + str).slice(-size)
// returns an 8 character random ID
export default function genId() {
  const date = Date.now().toString(36)
  const rand = pad(random(), 2)
  const count = pad(counter().toString(36), blockSize)

  return date.slice(-2) + count + rand
}
