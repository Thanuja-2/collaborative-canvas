// App initialization and bindings
document.addEventListener('DOMContentLoaded', () => {
  const canvasEl = document.getElementById('canvas');
  const cursorsContainer = document.getElementById('cursors');
  const app = CanvasApp({ elCanvas: canvasEl, cursorsContainer, send: (ev, payload) => WS.emit(ev, payload) });

  // UI bindings
  document.getElementById('tool').addEventListener('change', (e) => app.setTool(e.target.value));
  document.getElementById('color').addEventListener('input', (e) => app.setColor(e.target.value));
  document.getElementById('width').addEventListener('input', (e) => app.setWidth(parseInt(e.target.value, 10)));
  document.getElementById('undo').addEventListener('click', () => WS.emit('undo'));
  document.getElementById('redo').addEventListener('click', () => WS.emit('redo'));
  document.getElementById('clear').addEventListener('click', () => WS.emit('clear'));

  // join room
  WS.emit('joinRoom', { roomId: 'default', username: prompt('Your name:', `User-${Math.floor(Math.random()*1000)}`) });

  // Wire websocket events to canvas
  WS.on('initState', (payload) => app._internal._handleInitState(payload));
  WS.on('opCreated', (payload) => app._internal._handleOpCreated(payload));
  WS.on('strokePoints', (payload) => app._internal._handleStrokePoints(payload));
  WS.on('finishStroke', (payload) => app._internal._handleFinishStroke(payload));
  WS.on('undo', (payload) => app._internal._handleUndo(payload));
  WS.on('redo', (payload) => app._internal._handleRedo(payload));
  WS.on('clear', () => app._internal._handleClear());
  WS.on('usersUpdate', (payload) => app._internal._updateUsers(payload));
  WS.on('cursorMove', (payload) => app.remoteCursorMove(payload));
});
