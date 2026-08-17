const fs = require('node:fs');
const path = require('node:path');

function audit(dataDir, entry) {
  fs.mkdirSync(dataDir, { recursive: true });
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  fs.appendFileSync(path.join(dataDir, 'audit.log'), `${line}\n`, 'utf8');
}

module.exports = { audit };
