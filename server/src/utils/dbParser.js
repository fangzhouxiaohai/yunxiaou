function parseDatabases(output) {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== 'Database');
}

function parseRedisInfo(output) {
  const lines = output.split('\n');
  const kv = {};
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z_0-9]+):(.*)$/);
    if (m) kv[m[1]] = m[2];
  }
  const hits = parseInt(kv.keyspace_hits || '0', 10);
  const misses = parseInt(kv.keyspace_misses || '0', 10);
  const databases = [];
  for (const [key, value] of Object.entries(kv)) {
    if (key.startsWith('db') && /^\d+$/.test(key.slice(2))) {
      const m = value.match(/^keys=(\d+),expires=(\d+)/);
      if (m) databases.push({ db: key, keys: parseInt(m[1], 10), expires: parseInt(m[2], 10) });
    }
  }
  return {
    version: kv.redis_version || '',
    mode: kv.redis_mode || '',
    connectedClients: parseInt(kv.connected_clients || '0', 10),
    usedMemory: parseInt(kv.used_memory || '0', 10),
    totalConnections: parseInt(kv.total_connections_received || '0', 10),
    totalCommands: parseInt(kv.total_commands_processed || '0', 10),
    hitRate: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0,
    totalKeys: databases.reduce((sum, d) => sum + d.keys, 0),
    databases,
  };
}

module.exports = { parseDatabases, parseRedisInfo };
