/*
- add node by name or id
- node name, online status, clientcount, delete from list
*/

var choo = require('choo')
var html = require('choo/html')
var log = require('choo-log')
var persist = require('choo-persist')

var app = choo()
app.use(log())
app.use(persist({name: 'ffs-monitor-' + require('./package.json').version}))
app.use(nodeStore)
app.route('/', mainView)
app.mount('body')

app.use((state, emitter) => {
  // emitter.emit('add', '64:70:02:aa:ba:f8')
  // emitter.emit('add', '14:cc:20:8a:3c:7e')
  window.setInterval(x => {
    console.log('interval')
    emitter.emit('updateAll')
  }, 1000 * 10)
})

function mainView (state, emit) {
  return html`
    <body>
      <header>
        Add a node: <input type=text> <button onclick=${add}>add</button>
      </header>
      <section>
        <ol>
          ${state.ids.map((id, i) => {
            let node = state.nodes[id]
            return html`<li>
              <b>node name</b> (${id}),<br>
              ${node.isonline ? 'online' : 'offline'},
              ${node.clientcount} <button onclick=${remove.bind(null, i)}>❌</button>
            </li>
              `
          })}
        </ol>
      </section>
    </body>
  `

  function add () {
    let id = document.querySelector('header input').value
    emit('add', id)
  }
  function remove (i) {
    emit('remove', i)
  }
}

function nodeStore (state, emitter) {
  state.ids = state.ids || []
  state.nodes = state.nodes || {}

  emitter.on('add', id => {
    if (state.ids.indexOf(id) !== -1) return
    state.nodes[id] = {}
    state.ids.push(id)
    emitter.emit('update', id)
  })

  emitter.on('remove', i => {
    state.ids.splice(i, 1)
    emitter.emit('render')
  })

  emitter.on('update', id => {
    let url = 'https://nodealarm.freifunk-stuttgart.de/' + id
    window.fetch(url).then(res => {
      res.json().then(node => {
        if (!node.length) throw new Error(`API call on ${url} results in empty array.`)
        state.nodes[id] = node[0]
        emitter.emit('render')
      })
    })
  })

  emitter.on('updateAll', x => {
    state.ids.forEach(id => emitter.emit('update', id))
  })
}
