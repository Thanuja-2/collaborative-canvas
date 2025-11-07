const { v4: uuidv4 } = require('uuid');

/**
 * Server maintains an ordered operation log (array).
 * Each operation = { id, type, owner, meta, points: [], finished, createdAt }
 * Undo/Redo implemented by popping/marking operations in the global op log.
 */
class DrawingState {
  constructor() {
    this.ops = [];         // list of operations in z-order
    this.undoStack = [];   // operations removed (for redo)
  }

  createOperation({ type = 'stroke', owner, meta = {} } = {}) {
    const op = {
      id: uuidv4(),
      type,
      owner,
      meta,
      points: [],
      finished: false,
      createdAt: Date.now()
    };
    this.ops.push(op);
    // creating a new op invalidates redo stack
    this.undoStack = [];
    return op;
  }

  appendPoints(opId, points) {
    const op = this.ops.find(o => o.id === opId);
    if (!op) return;
    op.points.push(...points);
  }

  finishOperation(opId) {
    const op = this.ops.find(o => o.id === opId);
    if (op) op.finished = true;
  }

  getOperations() {
    // return a safe clone
    return this.ops.map(o => ({ ...o, points: [...o.points] }));
  }

  undo() {
    // remove last finished operation (global undo)
    for (let i = this.ops.length - 1; i >= 0; i--) {
      if (this.ops[i].type === 'stroke') {
        const [op] = this.ops.splice(i, 1);
        this.undoStack.push(op);
        return op;
      }
    }
    return null;
  }

  redo() {
    const op = this.undoStack.pop();
    if (op) {
      this.ops.push(op);
      return op;
    }
    return null;
  }

  clear() {
    this.ops = [];
    this.undoStack = [];
  }
}

module.exports = { DrawingState };
