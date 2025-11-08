// wrapper around socket.io
const WS = (() => {
  const socket = io();
  const listeners = {};

  socket.onAny((ev, payload) => {
    if (listeners[ev]) listeners[ev].forEach(fn => fn(payload));
  });

  return {
    on: (ev, fn) => {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(fn);
    },
    emit: (ev, payload) => socket.emit(ev, payload)
  };
})();
