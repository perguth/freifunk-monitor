let choo = require('choo')
let html = require('choo/html')
let Nanocomponent = require('nanocomponent')
let persist = require('choo-persist')
let socketIo = require('socket.io-client')
let moment = require('moment')

let restUrl = process.env.REST_URL
let wsUrl = process.env.WS_URL
let minSearchLengh = 5
let pollingTime = 1000 * 60 * 15
let socket = socketIo(wsUrl)
let app = choo()
app.use(persist({name: 'ffs-monitor-' + require('./package.json').version}))
app.use(uiStore)
app.use(nodeStore)
app.route('*', mainView)
app.mount('body')

window.Notification.requestPermission()
function notify (msg) { new window.Notification(msg) } // eslint-disable-line

app.use((state, emitter) => {
  socket.on('getId', id => {
    emitter.emit('add', id)
  })
  socket.on('search', x => {
    emitter.emit('suggestion', x)
  })
  window.setInterval(x => emitter.emit('updateAll'), pollingTime)
  emitter.emit('updateAll')
})

let Input = class Component extends Nanocomponent {
  constructor () {
    super()
    this.state = {}
  }
  createElement (state) {
    this.state = state
    return html`
      <input onkeypress=${state.onkeypress} onfocus=${state.onfocus} onblur=${state.onblur}
      class=form-control type=text placeholder='name or mac address' data-toggle=dropdown>
    `
  }
  update (x) {}
}
let input = new Input()

function mainView (state, emit) {
  let nodeCount = 0
  let clientCount = 0
  state.ids.reduce((_, id) => {
    let node = state.nodes[id]
    if (!node.flags) return
    nodeCount += +node.flags.online
    clientCount += +node.clientcount
  })
  return html`<body><br>
    <div class=container><header class=row>
        <div class='col input-group dropdown show'>
        ${input.render({onkeypress: search, onfocus: showSuggestions, onblur: hideSuggestions})}

        <div class=dropdown-menu
          style='
            ${state.displaySuggestions ? 'display: block;' : 'display: hidden;'}
            width: calc(100% - 30px); margin-left: 15px; margin-right: 15px;
          '>
          ${state.suggestions.map((x, i) => html`
            <button onclick=${selected.bind(null, i)} class=dropdown-item>${x}</button>
          `)}
        </div>

        <span class=input-group-btn>
          <button onclick=${add} class='btn
            ${document.querySelectorAll('header input')[0] &&
            document.querySelectorAll('header input')[0].value
                ? 'btn-primary'
                : 'btn-secondary'}
          '>add</button>
        </span>
      </div></header><br>
      <div class=row><div class=col style='text-align: center;'>
        <i style='color: grey'>
          last update <b>${moment(state.timestamp).fromNow()}</b> -
          overall <b>${nodeCount} of ${state.ids.length} nodes online</b>
          serving <b>${clientCount} clients</b>
        </i>
      </div></div>
      <section class=row><div class=col>
        <br>
        <ul class=list-group>
          ${state.ids.map((id, i) => {
            let node = state.nodes[id]
            if (!node.flags) return
            return html`<li id=${window.Symbol()}
              class='list-group-item
              ${!node.flags.online ? 'list-group-item-dark' : ''}
              ${node.flags.online && node.clientcount === 0 ? 'list-group-item-info' : ''}
              ${node.flags.online && node.clientcount > 0 ? 'list-group-item-warning' : ''}'
              draggable=true
              ondragstart=${drag.bind(null, i)}
              ondrop=${drop.bind(null, i)}
              ondragover=${x => false}
            >
              <b>${node.name}</b> (${id}),
              ${node.flags.online ? 'online' : 'offline'},
              ${node.clientcount} clients
              <button
                onclick=${remove.bind(null, i)}
                class='close float-right'
                style='margin-top: -2px; cursor: pointer;'
                type=button>×</button>
            </li>`
          })}
        </ul>
      </div></section>
      <footer>
        <br>
        <small style='display: block; text-align: center; color: grey;'>
          <a href=https://github.com/pguth/ffs-monitor class=github>Github</a>
          has the source.
        </small>
      </footer>
    </div>
  </body>`

  function hideSuggestions () {
    setTimeout(x => emit('toggleSuggestions', false), 300)
  }

  function showSuggestions () {
    let input = document.querySelectorAll('header input')[0].value
    if (input.length >= minSearchLengh) emit('toggleSuggestions', true)
  }

  function selected (i) { // put selection into input field
    let selection = document.querySelectorAll('header .dropdown-menu button')[i].innerHTML
    document.querySelectorAll('header input')[0].value = selection
  }

  function search ({keyCode}) { // google instant style
    let newInput = String.fromCharCode(keyCode)
    let previousInput = document.querySelectorAll('header input')[0].value
    let search = previousInput + newInput
    if (search.length < minSearchLengh) {
      emit('toggleSuggestions', false)
      return
    }
    emit('toggleSuggestions', true)
    emit('inputChange', search)
    socket.emit('search', search)
  }

  function drag (from, e) {
    e.dataTransfer.setData('text/plain', from)
  }
  function drop (to, e) {
    e.preventDefault()
    let from = e.dataTransfer.getData('text')
    emit('flip', {from, to})
  }

  function add () {
    let input = document.querySelector('header input').value
    socket.emit('getId', input)
    document.querySelector('header input').value = ''
  }
  function remove (i) {
    emit('remove', i)
  }
}

function uiStore (state, emitter) {
  state.suggestions = state.suggestions || []
  state.input = state.input || ''
  state.displaySuggestions = false

  emitter.on('toggleSuggestions', x => {
    state.displaySuggestions = x
    emitter.emit('render')
  })
  emitter.on('inputChange', x => {
    state.input = x
    emitter.emit('render')
  })
  emitter.on('suggestion', x => {
    state.suggestions = [...x.names, ...x.ids]
    emitter.emit('render')
  })
}

function nodeStore (state, emitter) {
  state.ids = state.ids || []
  state.nodes = state.nodes || {}
  state.timestamp = '' || state.timestamp

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
    let url = restUrl + '/v1/id/' + id
    window.fetch(url).then(res => {
      res.json().then(node => {
        state.timestamp = node.timestamp
        if (!state.nodes[id].online && node.online) {
          notify(`Node ${node.name} came online!`)
        }
        if (state.nodes[id].online && !node.online) {
          notify(`Node ${node.name} went offline!`)
        }
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
