let choo = require('choo')
let html = require('choo/html')
let log = require('choo-log')
let persist = require('choo-persist')

let app = choo()
app.use(log())
app.use(persist({name: 'ffs-monitor-' + require('./package.json').version}))
app.use(nodeStore)
app.route('*', mainView)
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
  return html`<body><br>
    <div class=container>
      <header class='row input-group'>
        <input class=form-control type=text placeholder='mac address'>
        <span class=input-group-btn>
          <button onclick=${add} class='btn btn-primary'>add</button>
        </span>
      </header><br>
      <section class=row>
        <ol class=list-group>
          ${state.ids.map((id, i) => {
            let node = state.nodes[id]
            return html`<li id=${window.Symbol()}
              class='list-group-item ${!node.isonline ? 'list-group-item-danger' : ''}'
              draggable=true
              ondragstart=${pick.bind(null, i)}
              ondrop=${drop.bind(null, i)}
              ondragover=${x => false}
            >
              <b>node name</b> (${id}),
              ${node.isonline ? 'online' : 'offline'},
              <button
                onclick=${remove.bind(null, i)}
                class='close float-right'
                style='margin-top: -2px;'
                type=button>×</button>
            </li>`
          })}
        </ol>
      </section>
    </div>
</body>`

  function pick (from, e) {
    e.dataTransfer.setData('text/plain', from)
  }
  function drop (to, e) {
    e.preventDefault()
    let from = e.dataTransfer.getData('text')
    emit('flip', {from, to})
  }

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
    let url = 'https://ffs-monitor.perguth.de/v1/mac/' + id
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

  emitter.on('flip', ({from, to}) => {
    let tmp = state.ids[to]
    state.ids[to] = state.ids[from]
    state.ids[from] = tmp
    emitter.emit('render')
  })
}
