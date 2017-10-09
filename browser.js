/*
- add node by name or id
- node name, online status, clientcount, delete from list
*/

var html = require('choo/html')
var log = require('choo-log')
var choo = require('choo')

var app = choo()
app.use(log())
app.use(countStore)
app.route('/', mainView)
app.mount('body')

function mainView (state, emit) {
  return html`
    <body>
      <section>
        Add a node: <input type=text> <button>add</button>
      </section>
      <section>
        <ol>
          <li>node name, online state, clientcount <button>delete</button></li>
        </ol>
      </section>
    </body>
  `

  function onclick () {
    emit('increment', 1)
  }
}
window.fetch('https://netinfo.freifunk-stuttgart.de/json/nodes.json').then(function(myBlob) {
  console.log(myBlob)
})

function countStore (state, emitter) {
  state.count = 0
  emitter.on('increment', function (count) {
    state.count += count
    emitter.emit('render')
  })
}
