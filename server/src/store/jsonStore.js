const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(dataDir, name, defaults = []) {
    this.file = path.join(dataDir, name);
    this.defaults = defaults;
  }

  read() {
    if (!fs.existsSync(this.file)) return structuredClone(this.defaults);
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonStore };
