const { EventEmitter } = require('node:events');

class FakeClient extends EventEmitter {
  constructor({ connectDelay = 5 } = {}) {
    super();
    this.connectDelay = connectDelay;
    this.connectCount = 0;
    this.execCount = 0;
    this.destroyed = false;
    this.inFlight = 0;
    this.maxInFlight = 0;
  }

  connect() {
    this.connectCount += 1;
    setTimeout(() => {
      if (this.destroyed) return;
      this.emit('ready');
    }, this.connectDelay);
  }

  exec(command, cb) {
    this.execCount += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const stream = new EventEmitter();
    stream.stderr = new EventEmitter();
    setTimeout(() => {
      stream.emit('data', Buffer.from(`out:${command}`));
      stream.stderr.emit('data', Buffer.from(''));
      stream.emit('close', 0);
      this.inFlight -= 1;
    }, 5);
    cb(null, stream);
  }

  destroy() {
    if (!this.destroyed) {
      this.destroyed = true;
      this.emit('close');
    }
  }
}

module.exports = { FakeClient };
