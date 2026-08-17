function section(output, name) {
  const m = output.match(new RegExp(`===${name}===\\n([\\s\\S]*?)(?=\\n===|$)`));
  return m ? m[1] : '';
}

function parseCpu(text) {
  const cpu = { us: 0, sy: 0, id: 100 };
  const m = text.match(/%Cpu\(s\):\s+([\d.]+)\s+us,\s+([\d.]+)\s+sy,[\s\S]*?([\d.]+)\s+id/);
  if (m) {
    cpu.us = parseFloat(m[1]);
    cpu.sy = parseFloat(m[2]);
    cpu.id = parseFloat(m[3]);
  }
  return cpu;
}

function parseLoad(text) {
  const m = text.match(/load average:\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/);
  if (!m) return [0, 0, 0];
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

function parseUptime(text) {
  // "up 10 days,  3:42" 或 "up 3:42" 或 "up 1 min"
  const m = text.match(/up\s+(\d+)\s+days?,\s+(\d+):(\d+)/) || text.match(/up\s+(\d+):(\d+)/);
  if (m) {
    const days = m.length === 4 ? parseInt(m[1], 10) : 0;
    const h = m.length === 4 ? parseInt(m[2], 10) : parseInt(m[1], 10);
    const min = m.length === 4 ? parseInt(m[3], 10) : parseInt(m[2], 10);
    return days * 86400 + h * 3600 + min * 60;
  }
  return 0;
}

function parseMem(text) {
  const m = text.match(/Mem:\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\s+(\d+)\s+(\d+)/);
  if (!m) return { totalMB: 0, usedMB: 0, availMB: 0, percent: 0 };
  const total = parseInt(m[1], 10);
  const used = parseInt(m[2], 10);
  const avail = parseInt(m[5], 10);
  return {
    totalMB: total,
    usedMB: used,
    availMB: avail,
    percent: total ? Math.round((used / total) * 100) : 0,
  };
}

function parseDisk(text) {
  const lines = text.split('\n').filter((l) => /^\//.test(l.trim()));
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    return {
      fs: parts[0],
      size: parts[1],
      used: parts[2],
      percent: parseInt(parts[4].replace('%', ''), 10),
      mount: parts[5],
    };
  });
}

function parseNet(text) {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n')) {
    // /proc/net/dev: iface: rx_bytes rx_packets ... (8 个 rx 字段) tx_bytes ...
    // 注意 (\s+\d+){7} 的捕获组只保留最后一次重复，tx 字节在 m[4]
    const m = line.trim().match(/^(\w+):\s+(\d+)(\s+\d+){7}\s+(\d+)/);
    if (m && m[1] !== 'lo') {
      rx += parseInt(m[2], 10);
      tx += parseInt(m[4], 10);
    }
  }
  return { rxBytes: rx, txBytes: tx };
}

function parseOs(text) {
  const name = text.match(/NAME="?([^"\n]+)"?/);
  const version = text.match(/VERSION="?([^"\n]+)"?/);
  if (name && version) return `${name[1]} ${version[1]}`;
  return (name && name[1]) || 'Unknown';
}

function parseMonitorOutput(output) {
  const cpuText = section(output, 'CPU');
  return {
    cpu: parseCpu(cpuText),
    load: parseLoad(cpuText + section(output, 'UPTIME')),
    mem: parseMem(section(output, 'MEM')),
    disk: parseDisk(section(output, 'DISK')),
    net: parseNet(section(output, 'NET')),
    uptimeSec: parseUptime(section(output, 'UPTIME')),
    os: parseOs(section(output, 'SYS')),
  };
}

module.exports = { parseMonitorOutput };
