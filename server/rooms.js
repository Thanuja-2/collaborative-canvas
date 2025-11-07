const { DrawingState } = require('./drawing-state');

class Room {
  constructor(id) {
    this.id = id;
    this.state = new DrawingState();
    this.users = new Map(); // socketId -> {username, color}
  }

  addUser(socketId, username) {
    const color = this._assignColor();
    this.users.set(socketId, { username, color });
  }

  removeUser(socketId) {
    this.users.delete(socketId);
  }

  getUsersMeta() {
    const out = [];
    for (const [id, meta] of this.users.entries()) {
      out.push({ id, username: meta.username, color: meta.color });
    }
    return out;
  }

  _assignColor() {
    // deterministic-ish color assignment
    const palette = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6'];
    return palette[this.users.size % palette.length];
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }
  has(id) { return this.rooms.has(id); }
  createRoom(id) { this.rooms.set(id, new Room(id)); }
  get(id) { return this.rooms.get(id); }
}

module.exports = { RoomManager };
