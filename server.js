let cors = require('cors')
let express = require('express')
let fetch = require('node-fetch')
let nanobus = require('nanobus')

let app = express()
let bus = nanobus()
let state = {}
let v = 'v' + require('./package.json').version[0]
let PORT = process.env.PORT

nodeStore()

setInterval(x => { bus.emit('updateAll') }, 1000 * 60 * 60 * 15)
bus.emit('updateAll')

function nodeStore () {
  state.nodes = {}
  state.names = {}
  bus.on('updateAll', x => {
    fetch('https://netinfo.freifunk-stuttgart.de/json/nodes.json')
      .then(res => res.json()).then(res => {
        state.timestamp = res.meta.timestamp
        res.nodes.forEach(node => {
          state.nodes[node.id] = node
          state.names[node.name] = node.id
        })
      })
  })
}

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

app.use(cors())
app.listen(PORT, x => { console.log(`running on :${PORT}`) })
