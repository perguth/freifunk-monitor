let backoff = require('backoff')
const bus = require('nanobus')()
const debug = require('debug')('ffs-monitor')
const express = require('express')
const fetch = require('node-fetch')
const PORT = process.env.PORT || 8080
const https = require('https')
const fs = require('fs')
const memoize = require('fast-memoize')
const cors = require('cors')
const jsonParser = require('body-parser').json()

const credentialsPath = process.env.CREDENTIALS || './credentials.json'
const sourceUrl = 'https://netinfo.freifunk-stuttgart.de/json/nodes.json'
const v = 'v' + require('./package.json').version[0]
const minTimeout = 1000 * 60 * 15
const minSearchLengh = 3
const state = {}
let server
nodeStore()

// express setup
const app = express()
app.use('/assets', express.static('assets'))

// server setup
if (!process.env.CERT) {
  app.use(cors())
  server = app.listen(PORT, x => { console.log(`HTTP server on :${PORT}`) })
} else {
  const cert = fs.readFileSync(process.env.CERT, 'utf8')
  const key = fs.readFileSync(process.env.KEY, 'utf8')
  server = https.createServer({ key, cert }, app)
  server.listen(PORT, x => { console.log(`HTTPS server on :${PORT}`) })
  if (process.env.HTTP_PORT) {
    const HTTP_PORT = process.env.HTTP_PORT
    app.listen(HTTP_PORT, x => { console.log(`HTTP server on :${HTTP_PORT}`) })
  }
}

// socket.io
const io = require('socket.io')(server)
const getId = memoize(lookup => {
  let res
  res = state.names[lookup]
  if (res) return res
  res = state.nodes[lookup] && lookup
  return res
})
io.sockets.on('connection', function (socket) {
  socket.on('getId', lookup => {
    socket.emit('getId', getId(lookup))
  })
  socket.on('search', x => {
    if (
      (x.startsWith('ffs-') && x.length <= (minSearchLengh + 'ffs-'.length)) ||
      (!x.startsWith('ffs-') && x.length <= minSearchLengh)
    ) return
    const results = {
      names: Object.keys(state.names).filter(name => name.includes(x)),
      ids: Object.keys(state.nodes).filter(id => id.includes(x))
    }
    socket.emit('search', results)
  })
})

// backoff setup
state.lastPull = Date.now()
backoff = backoff.fibonacci({
  initialDelay: minTimeout,
  maxDelay: 1000 * 60 * 60 * 24 * 3
})
backoff.on('ready', (number, delay) => {
  debug(`backoff: calling updateAll, retry ${number + 1} after ${delay}ms backoff`)
  bus.emit('updateAll')
})
bus.emit('updateAll')

// state handling
function nodeStore () {
  state.nodes = {}
  state.names = {}
  bus.on('updateAll', x => {
    debug('updateAll: fetching JSON')
    fetch(sourceUrl)
      .then(res => res.json()).then(res => {
        state.timestamp = res.meta.timestamp
        res.nodes.forEach(node => {
          state.nodes[node.id] = node
          state.names[node.name] = node.id
        })
        backoff.backoff()
      })
  })
}

// routes & middleware
app.use((req, res, next) => {
  if (state.lastPull < (Date.now() - minTimeout)) {
    debug('received request, resetting backoff')
    state.lastPull = Date.now()
    backoff.reset()
    bus.emit('updateAll')
  }
  next()
})

app.get('/version', (req, res) => res.send(v))

app.get(`/${v}/id/:id`, (req, res) => {
  const id = req.params.id
  const node = Object.assign({}, state.nodes[id], { timestamp: state.timestamp })
  res.send(node)
})

app.get(`/${v}/name/:name`, (req, res) => {
  const id = state.names[req.params.name]
  const node = Object.assign({}, state.nodes[id], { timestamp: state.timestamp })
  res.send(node)
})

app.get(`/${v}/all`, (req, res) => {
  const nodes = Object.assign({}, state.nodes, { timestamp: state.timestamp })
  res.send(nodes)
})

app.post(`/${v}/offload`, jsonParser, (req, res) => {
  let credentials
  try {
    credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
  } catch (err) {
    credentials = { keys: {} }
    debug('`credentials.json` missing. Set path in environment variable `CREDENTIALS`!')
  }
  const key = req.body.key
  console.log('key', key, credentials.keys[key])
  if (!credentials.keys[key]) {
    debug('Refused offloader request for key:', key)
    res.send(JSON.stringify({ err: 'API key not allowed: ' + key }))
    return
  }
  debug('Allowed offloader request for key:', key)
  debug('I should monitor now:', req.body.nodes, 'and send mails to:', req.body.email)
  res.send('{}')
})

// ui
app.get('/', (req, res) => res.send(`<style>
  a {
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  a.github {
    opacity: 0.5;
    color: black;
    font-weight: bold;
    text-decoration: none;
  }
  a.github:hover {
    text-decoration: underline;
  }
  a.github::before {
    content: '';
    background: url(assets/github.png) no-repeat;
    background-size: 10px;
    display: inline-block;
    width: 12px;
    height: 10px;
    margin-left: 2px;
  }
</style><div style='width: 240px; margin: 0 auto; position: relative; height: 100%;'>
  <section style='display: block; color: grey; position: absolute; top: 15%;'>
    <h1 style='border-bottom: 1px dotted grey;'>ffs-monitor ${v}</h1>
    <p style='text-align: justify;'>
      This server regularly pulls and caches the <a href=https://netinfo.freifunk-stuttgart.de/json/nodes.json>JSON file</a>
      that is published by <a href=https://freifunk-stuttgart.de/>freifunk-stuttgart.de</a> containing
      information about all registered nodes. Information about individual nodes is then exposed via a REST interface:
    <ul style='border: 1px dotted grey; border-width: 0 0 1px; padding: 0 0 16px 26px;'>
      ${app._router.stack.filter(x => x.route).map(r => {
        const route = r.route.path
        let href = route
        const urlVar = route.split(':')[1]
        if (route === '/') return
        if (route.includes(':')) {
          const item = randomItem(route, urlVar)
          href = href.replace(`:${urlVar}`, item)
        }
        return `<li><a href=${href}>${route}</a></li>`
      }).join('')}
    </ul>
    <small style='text-align: center; display: block;'><a href=https://github.com/pguth/ffs-monitor class=github>Github</a>
    has the source.</small>
  </section></div>`))

function randomItem (route, urlVar) {
  if (Object.keys(state.nodes).length === 0) return urlVar
  const nodes = state.nodes
  const ids = Object.keys(nodes)
  const randomId = ids[ids.length * Math.random() << 0]
  if (urlVar === 'id') return randomId
  return nodes[ids[ids.length * Math.random() << 0]][urlVar]
}
