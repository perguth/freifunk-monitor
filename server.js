let backoff = require('backoff')
let bus = require('nanobus')()
let debug = require('debug')('ffs-monitor')
let express = require('express')
let fetch = require('node-fetch')
let PORT = process.env.PORT || 3000

let sourceUrl = 'https://netinfo.freifunk-stuttgart.de/json/nodes.json'
let v = 'v' + require('./package.json').version[0]
let state = {}
nodeStore()

// express setup
let app = express()
app.use('/assets', express.static('assets'))
// let server = app.listen(PORT, x => { console.log(`running on :${PORT}`) })
app.listen(PORT, x => {
  console.log(`running on :${PORT}`)
  debug('debug log on')
})

// let io = require('socket.io')(server)
// io.sockets.on('connection', function (socket) {
//   console.log('A new user connected!')
//   socket.emit('info', { msg: 'The world is round, there is no up or down.' })
// })

// backoff setup
let minTimeout = 1000 * 60 * 15
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
    state.lastPull = Date.now()
    backoff.reset()
  }
  next()
})

app.get(`/version`, (req, res) => res.send(v))

app.get(`/${v}/mac/:mac`, (req, res) => {
  let node = Object.assign({}, state.nodes[req.params.mac], {timestamp: state.timestamp})
  res.send(node)
})

app.get(`/${v}/name/:name`, (req, res) => {
  let mac = state.names[req.params.name]
  let node = Object.assign({}, state.nodes[mac], {timestamp: state.timestamp})
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
  let macs = Object.keys(nodes)
  let randomMac = macs[macs.length * Math.random() << 0]
  if (urlVar === 'mac') return randomMac
  return nodes[macs[macs.length * Math.random() << 0]][urlVar]
}
