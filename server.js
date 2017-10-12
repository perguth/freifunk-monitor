let debug = require('debug')('ffs-monitor')
let fetch = require('node-fetch')
let backoff = require('backoff')
let bus = require('nanobus')()
let PORT = process.env.PORT

let sourceUrl = 'https://netinfo.freifunk-stuttgart.de/json/nodes.json'
let v = 'v' + require('./package.json').version[0]
let state = {}
nodeStore()

// express setup
let app = require('express')()
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
