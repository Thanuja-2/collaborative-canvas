// Canvas module: manages drawing, layers, operations
(function(global){
  const DPR = window.devicePixelRatio || 1;

  function createCanvasElement(el) {
    const canvas = el;
    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * DPR);
      canvas.height = Math.round(rect.height * DPR);
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
    }
    window.addEventListener('resize', resize);
    resize();
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);
    return { canvas, ctx, resize };
  }

  // Basic smoothing (simple quadratic curve)
  function drawSmoothPath(ctx, points, color, width, composite = 'source-over') {
    if (!points || points.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    if (points.length === 1) {
      const p = points[0];
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.01, p.y + 0.01);
    } else {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i+1].x) / 2;
        const midY = (points[i].y + points[i+1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }
      // last segment
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // CanvasApp constructor
  function CanvasApp({ elCanvas, cursorsContainer, send }) {
    const { canvas, ctx } = createCanvasElement(elCanvas);
    const cursorsEl = cursorsContainer;

    const state = {
      tool: 'brush',
      color: '#000000',
      width: 4,
      localOps: {},   // opId -> op partial
      ops: [],        // ordered list of operations from server
      remoteTemp: {}, // opId -> points (in-flight)
      users: {}       // id -> {username, color}
    };

    // public API
    const api = {
      setTool: (t) => state.tool = t,
      setColor: (c) => state.color = c,
      setWidth: (w) => state.width = w,
      handleInitState,
      handleOpCreated,
      handleStrokePoints,
      handleFinishStroke,
      handleUndo,
      handleRedo,
      handleClear,
      updateUsers
    };

    // draw entire operations list
    function redrawAll() {
      // clear
      ctx.clearRect(0,0,canvas.width,canvas.height);
      // draw each op in order
      for (const op of state.ops) {
        if (op.type === 'stroke' && op.points.length) {
          const composite = (op.meta && op.meta.tool === 'eraser') ? 'destination-out' : 'source-over';
          drawSmoothPath(ctx, op.points, op.meta.color, op.meta.width, composite);
        }
      }
    }

    // incremental draw for a single op (overdraw)
    function drawOpPartial(op) {
      // For simplicity: redraw entire canvas. For better perf, draw into offscreen per op.
      redrawAll();
    }

    // coordinate conversion (page to canvas local)
    function toCanvasCoords(evt) {
      const rect = canvas.getBoundingClientRect();
      const x = (evt.clientX - rect.left);
      const y = (evt.clientY - rect.top);
      return { x, y };
    }

    // smoothing + batching: we collect points in a buffer and send every 30-50ms or when mouseup
    let isDrawing = false;
    let currentOpId = null;
    let buffer = [];
    let lastSentAt = 0;

    function pointerDown(evt) {
      if (evt.button !== undefined && evt.button !== 0) return;
      isDrawing = true;
      buffer = [];
      const coords = toCanvasCoords(evt);
      // create op on server
      send('startStroke', { meta: { tool: state.tool, color: state.color, width: state.width } });
      // note: server will send opCreated -> we'll set currentOpId
      // optimistic local op: create temp op id (client-side) to show immediate stroke
      currentOpId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
      state.localOps[currentOpId] = {
        id: currentOpId,
        type: 'stroke',
        meta: { tool: state.tool, color: state.color, width: state.width },
        points: [coords],
        finished: false
      };
      state.ops.push(state.localOps[currentOpId]);
      redrawAll();
    }

    function pointerMove(evt) {
      const coords = toCanvasCoords(evt);
      // emit cursor to others
      send('cursorMove', { x: coords.x, y: coords.y });

      if (!isDrawing) return;
      // add to buffer and local op
      buffer.push(coords);
      state.localOps[currentOpId].points.push(coords);
      const now = Date.now();
      if (now - lastSentAt > 40) { // batch every ~40ms
        // send to server if we have server opId bound (opCreated)
        if (state.localOps[currentOpId].serverOpId) {
          send('strokePoints', { opId: state.localOps[currentOpId].serverOpId, points: buffer.slice() });
        }
        lastSentAt = now;
        buffer = [];
      }
      drawOpPartial(state.localOps[currentOpId]);
    }

    function pointerUp(evt) {
      if (!isDrawing) return;
      isDrawing = false;
      // send remaining buffer
      const local = state.localOps[currentOpId];
      if (local && local.serverOpId && buffer.length) {
        send('strokePoints', { opId: local.serverOpId, points: buffer.slice() });
      }
      // finish
      if (local && local.serverOpId) {
        send('finishStroke', { opId: local.serverOpId });
      }
      // finalize local op: the server will send finishStroke and authoritative op list soon
      currentOpId = null;
      buffer = [];
    }

    // attach events
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointerDown(e); });
    canvas.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', (e) => { try { canvas.releasePointerCapture(e.pointerId); } catch(e){} pointerUp(e); });

    // Server event handlers
    function handleInitState({ operations, users }) {
      state.ops = operations;
      state.users = {};
      users.forEach(u => state.users[u.id] = u);
      redrawAll();
      renderUsers();
    }

    function handleOpCreated({ opId }) {
      // map the latest local temporary op that lacks serverOpId to the server opId
      // naive mapping: find first local op with serverOpId unset and set it
      for (const key of Object.keys(state.localOps)) {
        const op = state.localOps[key];
        if (!op.serverOpId) {
          op.serverOpId = opId;
          // also update the op in ops (replace temp id)
          op.id = opId;
          break;
        }
      }
    }

    function handleStrokePoints({ opId, points, owner }) {
      // find op in state.ops or create placeholder
      let op = state.ops.find(o => o.id === opId);
      if (!op) {
        op = { id: opId, type: 'stroke', meta: { color: '#000', width: 4 }, points: [], finished: false };
        state.ops.push(op);
      }
      op.points.push(...points);
      redrawAll();
    }

    function handleFinishStroke({ opId }) {
      const op = state.ops.find(o => o.id === opId);
      if (op) op.finished = true;
      redrawAll();
    }

    function handleUndo({ opId }) {
      // remove op with opId from state.ops
      state.ops = state.ops.filter(o => o.id !== opId);
      redrawAll();
    }

    function handleRedo({ operation }) {
      state.ops.push(operation);
      redrawAll();
    }

    function handleClear() {
      state.ops = [];
      redrawAll();
    }

    function updateUsers(users) {
      // users: [{id, username, color}]
      state.users = {};
      users.forEach(u => state.users[u.id] = u);
      renderUsers();
    }

    function renderUsers() {
      // show online users in toolbar and render cursor elements for each user
      const usersArr = Object.values(state.users);
      const toolbarUsers = document.getElementById('users');
      if (toolbarUsers) {
        toolbarUsers.innerHTML = usersArr.map(u => `<span style="color:${u.color};margin-left:8px">${u.username}</span>`).join('');
      }
      // ensure cursor DOM elements
      cursorsEl.innerHTML = '';
      usersArr.forEach(u => {
        const div = document.createElement('div');
        div.id = `cursor-${u.id}`;
        div.className = 'remote-cursor';
        div.innerHTML = `<div class="remote-dot" style="background:${u.color}"></div><div>${u.username}</div>`;
        cursorsEl.appendChild(div);
      });
    }

    // public exposures for event binding
    api._internal = {
      _handleInitState: handleInitState,
      _handleOpCreated: handleOpCreated,
      _handleStrokePoints: handleStrokePoints,
      _handleFinishStroke: handleFinishStroke,
      _handleUndo: handleUndo,
      _handleRedo: handleRedo,
      _handleClear: handleClear,
      _updateUsers: updateUsers
    };

    // cursor move handler from remote
    function remoteCursorMove({ id, username, x, y }) {
      const el = document.getElementById(`cursor-${id}`);
      if (!el) return;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }

    api.remoteCursorMove = remoteCursorMove;

    return api;
  }

  global.CanvasApp = CanvasApp;
})(window);
