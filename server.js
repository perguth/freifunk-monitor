let backoff = require('backoff')
let bus = require('nanobus')()
let debug = require('debug')('ffs-monitor')
let express = require('express')
let fetch = require('node-fetch')
let PORT = process.env.PORT || 9000
let https = require('https')
let fs = require('fs')
let memoize = require('fast-memoize')
let cors = require('cors')

let sourceUrl = 'https://netinfo.freifunk-stuttgart.de/json/nodes.json'
let v = 'v' + require('./package.json').version[0]
let minTimeout = 1000 * 60 * 15
let minSearchLengh = 5
let state = {}
let server
nodeStore()

// express setup
let app = express()
app.use('/assets', express.static('assets'))

// server setup
if (!process.env.CERT) {
  app.use(cors())
  server = app.listen(PORT, x => { console.log(`HTTP server on :${PORT}`) })
} else {
  let cert = fs.readFileSync(process.env.CERT, 'utf8')
  let key = fs.readFileSync(process.env.KEY, 'utf8')
  server = https.createServer({key, cert}, app)
  server.listen(PORT, x => { console.log(`HTTPS server on :${PORT}`) })
  if (process.env.HTTP_PORT) {
    let HTTP_PORT = process.env.HTTP_PORT
    app.listen(HTTP_PORT, x => { console.log(`HTTP server on :${HTTP_PORT}`) })
  }
}

// socket.io
let io = require('socket.io')(server)
let getId = memoize(lookup => {
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
    if (x.length < minSearchLengh) return
    let results = {
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
  debug(`calling updateAll, try ${number} after ${delay}ms backoff`)
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

app.get(`/version`, (req, res) => res.send(v))

app.get(`/${v}/id/:id`, (req, res) => {
  let id = req.params.id
  let node = Object.assign({}, state.nodes[id], {timestamp: state.timestamp})
  res.send(node)
})

app.get(`/${v}/name/:name`, (req, res) => {
  let id = state.names[req.params.name]
  let node = Object.assign({}, state.nodes[id], {timestamp: state.timestamp})
  res.send(node)
})

app.get(`/${v}/all`, (req, res) => {
  let nodes = Object.assign({}, state.nodes, {timestamp: state.timestamp})
  res.send(nodes)
})

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
        let route = r.route.path
        let href = route
        let urlVar = route.split(':')[1]
        if (route === '/') return
        if (route.includes(':')) {
          let item = randomItem(route, urlVar)
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
  let nodes = state.nodes
  let ids = Object.keys(nodes)
  let randomId = ids[ids.length * Math.random() << 0]
  if (urlVar === 'id') return randomId
  return nodes[ids[ids.length * Math.random() << 0]][urlVar]
}
