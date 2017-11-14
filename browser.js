let choo = require('choo')
let debug = require('debug')('ffs-monitor')
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
function notify (msg, state, test) {
  debug('Tyring to display a system notification')
  new window.Notification('ffs-monitor', { // eslint-disable-line
    body: msg,
    icon: 'assets/ffs-logo-128.png',
    sticky: true
  })
  if (test || (state.sendMail && state.smtp)) {
    debug('SMTP: tryring to send a test mail')
    let subject = `Node changed state`
    let message = subject
    let Smtp = window['emailjs-smtp-client']
    let smtp = new Smtp(state.smtp.host, 587, {
      useSecureTransport: true,
      requireTLS: true,
      ca: state.smtp.ca,
      tlsWorkerPath: 'assets/tcp-socket-tls-worker.js',
      auth: {
        user: state.smtp.username,
        pass: state.smtp.password
      }
    })
    smtp.onerror = err => debug('SMTP: error', err)
    smtp.ondone = bool => {
      if (bool) {
        debug('SMTP: sending Email failed', smtp.log.slice(-1))
        return
      }
      debug('SMTP: Email successfully sent')
      smtp.quit() // graceful
    }
    smtp.onready = failedRecipients => {
      if (failedRecipients.length) debug('SMTP: recipients rejected', failedRecipients)
      smtp.send(`Subject: ${subject}\r\n`)
      smtp.send(`\r\n`)
      smtp.send(message)
      smtp.end()
    }
    smtp.onidle = x => {
      console.log('connected')
      smtp.useEnvelope({
        from: state.smtp.from || state.smtp.username,
        to: `[${state.smtp.to}]`
      })
    }
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
  if (state.sharing) startSharing(state)

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
            <h5 class=modal-title>Transfer state</h5>
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
              <div class=input-group>
                <input type=text class=form-control ${state.sharing ? '' : 'disabled'}
                  value=${window.location.origin + window.location.pathname}#${state.sharingKey || ''}>
                <span class=input-group-btn>
                  <button class='btn btn-light clippy' data-clipboard-target=#connection-id>
                    <img src=assets/clippy.svg>
                  </button>
                </span>
              </div>
              <div class=form-check>
                <label class=form-check-label>
                  <input type=checkbox class=form-check-input ${
                    state.sharesmtp ? 'checked' : ''
                  } onclick=${
                    x => emit('toggleSmtpSharing')
                  }> <small>Transfer SMTP credentials.</small>
                </label>
              </div>
            </div>
            <hr>
            <div class=form-group>
              <label>Send notification Mails</label> <span class='badge badge-${state.sendMail ? 'success' : 'dark'}'>
                ${state.sendMail ? 'enabled' : 'disabled'}
              </span>
              <span class=float-right><a href=# onclick=${x => emit('toggleSendMail')}>
                • ${state.sendMail ? 'disable' : 'enable'}
              </a></span>
              <p style='margin-bottom: 4px;'><small>
                This website can send a notification email when a node goes offline or comes online again.
              </small></p>
              <input id=smtp-host type=text class=form-control placeholder='SMTP server' style='margin-bottom: 4px;' value=${
                state.smtp ? state.smtp.host : ''
              }>
              <input id=smtp-username type=text class=form-control placeholder='Username' style='margin-bottom: 4px;' value=${
                state.smtp ? state.smtp.username : ''
              }>
              <input id=smtp-password type=password class=form-control placeholder='Password' style='margin-bottom: 4px;' value=${
                state.smtp && state.smtp.password
                  ? (new Array(state.smtp.password.length)).fill('x') : ''
              }>
              <input id=smtp-to type=text class=form-control placeholder='Recipients (comma separated)' style='margin-bottom: 4px;' value=${
                state.smtp ? state.smtp.to : ''
              }>
              <input id=smtp-from type=text class=form-control placeholder='From (= username if left blank)' style='margin-bottom: 4px;' value=${
                state.smtp ? state.smtp.from : ''
              }>            
              <textarea id=smtp-ca class=form-control rows=3 placeholder='CA' style='margin-bottom: 4px;'>
                ${state.smtp ? state.smtp.ca : ''}
              </textarea>
              <small class='form-text text-muted'>Emails are sent directly from your browser. SMTP encryption (StartTLS) with standard port is enforced.</small>
              <span class=float-right>
                <button class='btn btn-info' onclick=${
                  notify.bind(null, 'SMTP: trying to send a test mail', state, true)
                }>Send a test Email</button>              
              </span>
            </div>
          </div>
          <div class=modal-footer>
            <button class='btn btn-secondary' onclick=${x => emit('toggleSendMail')}>Discard</button>
            <button class='btn btn-primary' onclick=${x => {
              emit('toggleModal')
              let smtpCredentials = {
                host: document.getElementById('smtp-host').value,
                username: document.getElementById('smtp-username').value,
                password: document.getElementById('smtp-password').value,
                to: document.getElementById('smtp-to').value,
                from: document.getElementById('smtp-from').value,
                ca: document.getElementById('smtp-ca').value
              }
              emit('saveSmtpCredentials', smtpCredentials)
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
  let tmpSmtp = {}

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
  emitter.on('toggleSmtpSharing', x => {
    state.shareSmtp = !state.shareSmtp
    emitter.emit('render')
  })
  emitter.on('saveSmtpCredentials', credentials => {
    if (!state.smtp) state.smtp = {}
    for (let prop in credentials) {
      let value = credentials[prop]
      if (value || value !== 'undefined') state.smtp[prop] = value
      else state.smtp[prop] = ''
    }
  })
  emitter.on('toggleSendMail', x => {
    state.sendMail = !state.sendMail
    emitter.emit('render')
  })
  emitter.on('toggleSmtpPersistence', x => {
    if (!state.smtp || state.smtp === {}) {
      state.smtp = tmpSmtp
    }
    tmpSmtp = state.smtp
    state.smtp = {}
  })
}

function startSharing (state, emit) {
  let hash = window.location.hash.substr(1)
  let hub = new Signalhub(
    `ffs-monitor-v${require('./package.json').version[0]}`,
    ['https://signalhub.perguth.de:65300/']
  )
  let sharingKey = hash || state.sharingKey || Swarm.createSecret()
  let swarm = new Swarm(hub, {secret: sharingKey})
  if (emit) emit('startedSharing', {swarm, sharingKey})
  debug('Starting WebRTC')

  swarm.on('peer', peer => {
    debug('Peer connected')
    if (!hash) {
      let shareSmtp = state.shareSmtp
      if (!shareSmtp) emit('toggleSmtpPersistence')
      peer.send(window.localStorage.getItem(storageName))
      if (!shareSmtp) emit('toggleSmtpPersistence')
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
