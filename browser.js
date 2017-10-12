let choo = require('choo')
let html = require('choo/html')
let persist = require('choo-persist')
// let socketIo = require('socket.io-client')

let restUrl = 'https://ffs-monitor.perguth.de/'
// let restUrl = 'http://localhost:3000'
// let socket = socketIo(restUrl)
let app = choo()
app.use(persist({name: 'ffs-monitor-' + require('./package.json').version}))
app.use(nodeStore)
app.route('*', mainView)
app.mount('body')

// socket.on('connect', function () {
//   console.log('test')
// })
// socket.on('event', function (data) {})
// socket.on('disconnect', function () {})
//
// socket.on('info', function (msg) {
//   console.log('message: ' + msg.msg)
// })

app.use((state, emitter) => {
  // emitter.emit('add', '64:70:02:aa:ba:f8')
  // emitter.emit('add', '14:cc:20:8a:3c:7e')
  window.setInterval(x => {
    console.log('interval')
    emitter.emit('updateAll')
  }, 1000 * 10)
  emitter.emit('updateAll')
})

function mainView (state, emit) {
  return html`<body><br>
    <div class=container>
      <header class='row input-group'>
        <span style='position: absolute; left: 13px; top: 7px; right: 12px; z-index: 3;'>
          ${state.suggestion}
        </span>
        <input class=form-control type=text placeholder='mac address' onkeypress=${keypress}>
        <span class=input-group-btn>
          <button onclick=${add} class='btn btn-primary'>add</button>
        </span>
      </header><br>
      <section class=row>
        <ol class=list-group>
          ${state.ids.map((id, i) => {
            let node = state.nodes[id]
            return html`<li id=${window.Symbol()}
              class='list-group-item ${!node.flags.online ? 'list-group-item-danger' : ''}'
              draggable=true
              ondragstart=${pick.bind(null, i)}
              ondrop=${drop.bind(null, i)}
              ondragover=${x => false}
            >
              <b>${node.name}</b> (${id}),
              ${node.flags.online ? 'online' : 'offline'},
              ${node.clientcount} clients
              <button
                onclick=${remove.bind(null, i)}
                class='close float-right'
                style='margin-top: -2px;'
                type=button>×</button>
            </li>`
          })}
        </ol>
      </section>
      <footer>
        <small style='display: block; text-align: center; color: grey;'>
          <a href=https://github.com/pguth/ffs-monitor class=github>Github</a>
          has the source.
        </small>
      </footer>
    </div>
</body>`

  function keypress (e) {
    // let input = String.fromCharCode(e.keyCode)
  }

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
    let url = restUrl + '/v1/mac/' + id
    window.fetch(url).then(res => {
      res.json().then(node => {
        state.nodes[id] = node
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
