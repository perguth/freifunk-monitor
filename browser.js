let choo = require('choo')
let debug = require('debug')('ffs-monitor')
let devtools = require('choo-devtools')
let email = require('apostle.io')
let html = require('choo/html')
let Nanocomponent = require('nanocomponent')
let persist = require('choo-persist')
let Signalhub = require('signalhub')
let socketIo = require('socket.io-client')
let Swarm = require('secure-webrtc-swarm')
let moment = require('moment')

let restUrl = process.env.REST_URL || 'http://localhost:9000'
let wsUrl = process.env.WS_URL || restUrl
let apostleKey = process.env.APOSTLE_KEY || 'd867ceb476158bda34e72c0c5e26c2dde0039d9d'

let minSearchLengh = 5
let pollingTime = 1000 * 60 * 15
let socket = socketIo(wsUrl)
let storageName = 'ffs-monitor-v' + require('./package.json').version[0]
let hash = window.location.hash.substr(1)

let storage = window.localStorage.getItem(storageName)
console.log('storage', JSON.parse(storage))

let app = choo()
if (process.env.NODE_ENV !== 'production') {
  app.use(devtools())
}
app.use(persist({
  name: storageName,
  filter: state => Object.assign({}, state, {
    swarm: null,
    displayModal: null
  })
}))
app.use(uiStore)
app.use(nodeStore)
app.route('*', mainView)
app.mount('body')

window.Notification.requestPermission()
function notify (msg, state, testMail) {
  debug('Tyring to display a system notification')
  new window.Notification('ffs-monitor', { // eslint-disable-line
    body: msg,
    icon: 'assets/ffs-logo-128.png',
    sticky: true
  })
  if (state.sendMail || testMail) {
    email.domainKey = apostleKey
    email.deliver('node-changes-state', {
      email: state.email.local.address,
      node: {
        id: 'ec:08:6b:f7:d4:ae',
        name: 'ffs-aleppo-kiefer'
      }
    }).then(x => debug('Sent test email'), err => {
      debug('Sending email failed', err)
    })
  }
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
  if (state.sharing || hash) startSharing(state)

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
    <div class=modal style='display: ${state.displayModal ? 'block' : 'none'}; z-index: 10; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: grey; opacity: 0.8;'></div>
    <div class=modal tabindex=1 style='display: ${state.displayModal ? 'block' : 'none'}; position: relative; margin: 0 auto;'>
      <div class=modal-dialog>
        <div class=modal-content>
          <div class=modal-header>
            <h5 class=modal-title>Settings</h5>
            <button type=button class=close>
              <span onclick=${x => emit('toggleModal')}>×</span>
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
              <p style='line-height: 1.2; text-align: justify;'><small>
                These links can grant read-only access to the list of nodes assembled on this page. The current site will be mirrored automatically as long as the sharing link is enabled and the page remains open. The "Send mail"-link will also enable notification mails.
              </small></p>
              <div class=input-group style='margin-bottom: 6px;'>
                <div class=input-group-btn>
                  <button type=button class='btn btn-light dropdown-toggle' style='border: 1px solid rgba(0,0,0,.15); border-right: 0;' onclick=${x => emit('toggleSharingLink')}>
                    ${state.displayedLinkType === 'sendEmail' ? 'Send mails' : 'No mails'}
                  </button>
                </div>
                <input type=url class=form-control ${state.sharing ? '' : 'disabled'}
                  value=${window.location.origin + window.location.pathname}#${state.sharingKey || ''}>
                <span class=input-group-btn>
                  <button class='btn btn-light clippy' data-clipboard-target=#connection-id>
                    <img src=assets/clippy.svg>
                  </button>
                </span>
              </div>
              <input type=email class=form-control placeholder='Recipient mail address' ${
                state.displayedLinkType === 'sendMail' ? '' : 'disabled'
              } value=${state.email.remote.address ? state.email.remote.address : ''}>
            </div>
            <hr>

            <div class=form-group>
              <label>NodeJS offloader</label> <span class='badge badge-${state.offloading ? 'success' : 'dark'}'>
                ${state.offloading ? 'connected' : 'disconnected'}
              </span>
              <p style='line-height: 1.2;'><small>
                Let a regular server do the monitoring and sending of notification mails. It will automatically mirror the node list from this page.
              </small></p>
              <div class=input-group style='margin-bottom: 6px;'>
                <input type=url class=form-control placeholder='Your API key'>
                <span class=input-group-btn>
                  <button class='btn btn-light' type=button onclick=${
                    x => emit('connectOffloader')
                  } style='border: 1px solid rgba(0,0,0,.15);'>Connect</button>
                </span>
              </div>
              <input type=email class=form-control placeholder='Recipient mail address'>
            </div>
            <hr>
            
            <div class=form-group>
              <label>Send notification mails</label> <span class='badge badge-${state.email.local.enabled ? 'success' : 'dark'}'>
                ${state.email.local.enabled ? 'enabled' : 'disabled'}
              </span>
              <span class=float-right><a href=# onclick=${x => emit('toggleEmailLocal')}>
                • ${state.email.local.enabled ? 'disable' : 'enable'}
              </a></span>
              <p style='line-height: 1.2;'><small>
                As long as this page remains open it can send notification emails when nodes go offline or come back online.
              </small></p>
              <div class=input-group>
                <input id=mailto type=email class=form-control placeholder='Recipient email address' value=${state.email.local.address || ''}>
                <span class=input-group-btn>
                  <button class='btn btn-light' type=button onclick=${x => {
                    notify('Trying to send a test mail', state, true)
                    emit('saveRemoteEmailAddress', document.getElementById('mailto').value)
                  }} style='border: 1px solid rgba(0,0,0,.15);'>
                    Send a test email
                  </button>
                </span>
              </div>
            </div>
          </div>
          <div class=modal-footer>
            <button class='btn btn-secondary' onclick=${x => emit('toggleEmailLocal')}>Discard</button>
            <button class='btn btn-primary' onclick=${x => {
              emit('toggleModal')
              emit('saveRemoteEmailAddress', document.getElementById('mailto').value)
            }}>Save</button>
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
      </div></header>
      <div class=row style='text-align: center; display: ${nodeCount ? 'block' : 'none'};'>
        <br>
        <div class=col>
          <i style='color: grey'>
            last update <b>${moment(state.timestamp).fromNow()}</b> -
            overall <b>${nodeCount} of ${state.ids.length} nodes online</b>
            serving <b>${clientCount} client${clientCount !== 1 ? 's' : ''}</b>
          </i>
        </div>
      </div>
      <section class=row  style='text-align: center; display: ${nodeCount ? 'block' : 'none'};'><div class=col>
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
        <br>
      </div></section>
      <footer style='margin-top: 8px;'>
        <small style='display: block; text-align: center; color: grey;'>
          <code>v${require('./package.json').version}</code> <a
            href=https://github.com/pguth/ffs-monitor class=github>Github</a>
            has the source. <a href=${
              'data:application/octet-stream;charset=utf-8;base64,' +
              window.btoa(window.localStorage.getItem(storageName))
          } download=ffs-monitor.localStorage.txt>Export</a>, <a onclick=${
            x => document.querySelectorAll('input[type=file]')[0].click()
          } href=#>import</a> or <a onclick=${x => emit('toggleModal')} href=#>transfer</a> data.
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
  state.email = state.email || {
    local: {},
    remote: {}
  }
  state.displayedLinkType = state.displayedLinkType || 'justMirror'

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
  emitter.on('toggleModal', x => {
    state.displayModal = !state.displayModal
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
  emitter.on('toggleRemoteMailing', x => {
    state.remoteMailing = !state.remoteMailing
    emitter.emit('render')
  })
  emitter.on('saveRemoteEmailAddress', x => {
    state.email.local.address = x
  })
  emitter.on('toggleEmailLocal', x => {
    state.email.local.enabled = !state.email.local.enabled
    emitter.emit('render')
  })
  emitter.on('connectOffloader', x => {
    debug('connectOffloader')
  })
  emitter.on('toggleSharingLink', x => {
    state.displayedLinkType = state.displayedLinkType === 'noMail'
      ? 'sendMail' : 'noMail'
    emitter.emit('render')
  })
}

function startSharing (state, emit) {
  let hub = new Signalhub(
    `ffs-monitor-v${require('./package.json').version[0]}`,
    ['https://signalhub.perguth.de:65300/'] // TODO: Multiple hubs for redundancy
  )
  let keys = {}
  let ephemeralKey
  if (!hash) {
    keys.noMail = state.keys.noMail || Swarm.createKey()
    keys.sendMail = state.keys.sendMail || Swarm.createKey()
  } else {
    ephemeralKey = hash.split('-')[1]
  }
  let swarm = new Swarm(hub, {
    keys: Object.keys(state.keys).map(type => state.keys[type])
  })
  if (ephemeralKey) swarm.keys.push(ephemeralKey)
  if (emit) emit('startedSharing', {swarm, keys})

  swarm.on('peer', peer => {
    debug('Peer connected')
    if (!hash) {
      let storage = JSON.parse(window.localStorage.getItem(storageName))
      delete storage.keys
      if (peer.key === keys.noMail) {
        delete storage.sendMail
      }
      peer.send(storage)
    }
    peer.on('data', data => {
      let json = JSON.parse(data)
      let sameList = state.ids.find(id => {
        return json.ids.find(elem => elem.indexOf(id) === -1)
      })
      if (sameList) {
        debug('Peer has the same list - skipping')
        return
      }
      debug('Peer has a new list - updating')
      window.localStorage.setItem(storageName, data.toString())
      window.location.reload()
    })
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
          notify(`Node ${node.name} came online!`, state)
        }
        if (state.nodes[id].online && !node.online) {
          notify(`Node ${node.name} went offline!`, state)
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
