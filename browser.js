let choo = require('choo')
let html = require('choo/html')
let Nanocomponent = require('nanocomponent')
let persist = require('choo-persist')
let Signalhub = require('signalhub')
let socketIo = require('socket.io-client')
let Swarm = require('secure-webrtc-swarm')
let moment = require('moment')

let restUrl = process.env.REST_URL || 'http://localhost:9000'
let wsUrl = process.env.WS_URL || restUrl
let minSearchLengh = 5
let pollingTime = 1000 * 60 * 15
let socket = socketIo(wsUrl)
let app = choo()
let storageName = 'ffs-monitor-v' + require('./package.json').version[0]
app.use(persist({
  name: storageName,
  filter: state => Object.assign({}, state, {swarm: null})
}))
app.use(uiStore)
app.use(nodeStore)
app.route('*', mainView)
app.mount('body')

window.Notification.requestPermission()
function notify (msg) {
  new window.Notification('ffs-monitor', { // eslint-disable-line
    body: msg,
    icon: 'assets/ffs-logo-128.png',
    sticky: true
  })
}

window.setTimeout(x => {
  document.querySelectorAll('input[type=file]')[0].addEventListener('change', e => {
    let file = e.target.files[0]
    let reader = new window.FileReader()
    reader.onloadend = e => {
      window.localStorage.setItem(storageName, e.target.result)
      window.location.reload()
    }
    reader.readAsText(file)
  }, false)
}, 300)

app.use((state, emitter) => {
  if (state.sharing) startSharing(state, emitter)

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
  update () {}
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
  }, 0)
  return html`<body>
    <div class=modal style='display: none; z-index: 10; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: grey; opacity: 0.8;'></div>
    <div class=modal tabindex=1 style='display: none; position: absolute; top: calc(50% - 225px); left: calc(50% - 383px);'>
      <div class=modal-dialog>
        <div class=modal-content>
          <div class=modal-header>
            <h5 class=modal-title>Transfer state</h5>
            <button type=button class='close'>
              <span onclick=${displayModal.bind(null, false)}>×</span>
            </button>
          </div>
          <div class=modal-body>
            <div class=form-group>
              <label>Sharing link</label> <span class='badge badge-${state.sharing ? 'success' : 'dark'}'>
                ${state.sharing ? 'enabled' : 'disabled'}
              </span>
              <span class=float-right><a href=# onclick=${toggleSharing}>
                • ${state.sharing ? 'disable' : 'enable'}
              </a></span>
              <div class=input-group>
                <input type=text class=form-control ${state.sharing ? '' : 'disabled'}
                  value=${window.location.origin + window.location.pathname}#${state.sharingKey || ''}>
                <span class=input-group-btn>
                  <button class='btn btn-light clippy' data-clipboard-target=#connection-id>
                    <img src=assets/clippy.svg>
                  </button>
                </span>
              </div>
            </div>
          </div>
          <div class=modal-footer>
            <button class='btn btn-secondary' onclick=${displayModal.bind(null, false)}>Close</button>
          </div>
        </div>
      </div>
    </div>
    <br>
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
          serving <b>${clientCount} client${clientCount !== 1 ? 's' : ''}</b>
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
              <b>${node.name}</b> (<a href='${restUrl}/v1/id/${id}'>${id}</a>),
              ${node.flags.online ? 'online,' : 'offline'}
              ${node.flags.online ? node.clientcount + ' clients' : ''}
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
          <code>v${require('./package.json').version}</code> <a href=https://github.com/pguth/ffs-monitor class=github>Github</a>
          has the source. <a href=${
            'data:application/octet-stream;charset=utf-8;base64,' +
            window.btoa(window.localStorage.getItem(storageName))
          } download=ffs-monitor.localStorage.txt>Export</a>, <a onclick=${
            x => document.querySelectorAll('input[type=file]')[0].click()
          } href=#>import</a> or <a onclick=${displayModal.bind(null, true)} href=#>transfer</a> data.
        </small>
      </footer>
      <br>
    </div>
    <input type=file style='display: none;'>
  </body>`

  function toggleSharing () {
    emit('toggleSharing')
    if (state.sharing) startSharing(state, emit)
    else state.swarm.close()
  }

  function displayModal (bool) {
    document.querySelectorAll('.modal').forEach(elem => {
      elem.style.display = bool ? 'block' : 'none'
    })
  }

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
  emitter.on('toggleSharing', x => {
    state.sharing = !state.sharing
    emitter.emit('render')
  })
  emitter.on('startedSharing', x => {
    Object.assign(state, x)
    emitter.emit('render')
  })
}

function startSharing (state, emit) {
  let hub = new Signalhub(
    `ffs-monitor-v${require('./package.json').version[0]}`,
    ['https://signalhub.perguth.de:65300/']
  )
  let sharingKey = Swarm.createSecret()
  let swarm = new Swarm(hub, {secret: sharingKey})
  emit('startedSharing', {swarm, sharingKey})
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
