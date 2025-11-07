const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { DrawingState } = require('./drawing-state');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'client')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const rooms = new RoomManager();

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // Client joins a default room (for demo) or requested room
  socket.on('joinRoom', ({ roomId, username }) => {
    roomId = roomId || 'default';
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.createRoom(roomId);
    }
    const room = rooms.get(roomId);
    room.addUser(socket.id, username || `User-${socket.id.slice(0,4)}`);
    socket.data.roomId = roomId;
    socket.data.username = username;

    // Send current state and user list
    socket.emit('initState', {
      operations: room.state.getOperations(),
      users: room.getUsersMeta()
    });

    // Notify others
    io.to(roomId).emit('usersUpdate', room.getUsersMeta());
  });

  socket.on('startStroke', (payload) => {
    const roomId = socket.data.roomId; if (!roomId) return;
    const room = rooms.get(roomId);
    const op = room.state.createOperation({ type: 'stroke', owner: socket.id, meta: payload.meta });
    // stash the op id to allow clients to send points referencing it
    socket.emit('opCreated', { opId: op.id });
  });

  socket.on('strokePoints', (payload) => {
    // payload: { opId, points } // points array: [{x,y,t}] batched
    const roomId = socket.data.roomId; if (!roomId) return;
    const room = rooms.get(roomId);
    room.state.appendPoints(payload.opId, payload.points);
    // broadcast to others
    socket.to(roomId).emit('strokePoints', { opId: payload.opId, points: payload.points, owner: socket.id });
  });

  socket.on('finishStroke', ({ opId }) => {
    const roomId = socket.data.roomId; if (!roomId) return;
    const room = rooms.get(roomId);
    room.state.finishOperation(opId);
    io.to(roomId).emit('finishStroke', { opId, owner: socket.id });
  });

  socket.on('cursorMove', ({ x, y }) => {
    const roomId = socket.data.roomId; if (!roomId) return;
    socket.to(roomId).emit('cursorMove', { id: socket.id, username: socket.data.username, x, y });
  });

  socket.on('undo', () => {
    const roomId = socket.data.roomId; if (!roomId) return;
    const room = rooms.get(roomId);
    const op = room.state.undo(); // returns removed op or null
    if (op) {
      io.to(roomId).emit('undo', { opId: op.id });
    }
  });

  socket.on('redo', () => {
    const roomId = socket.data.roomId; if (!roomId) return;
    const room = rooms.get(roomId);
    const op = room.state.redo();
    if (op) {
      io.to(roomId).emit('redo', { operation: op });
    }
  });

  socket.on('clear', () => {
    const roomId = socket.data.roomId; if (!roomId) return;
    const room = rooms.get(roomId);
    room.state.clear();
    io.to(roomId).emit('clear');
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.removeUser(socket.id);
      io.to(roomId).emit('usersUpdate', room.getUsersMeta());
    }
    console.log('socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
