// distro.js — 发行版检测与第三方软件源判断
function detectDistro(osReleaseText) {
  const kv = {};
  for (const line of osReleaseText.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) kv[m[1]] = m[2];
  }
  const id = (kv.ID || 'unknown').toLowerCase();
  const family = id === 'centos' || id === 'rhel' || id === 'fedora' || id === 'rocky' || id === 'almalinux' || id === 'amzn' ? 'rhel' : 'debian';
  return { id, name: kv.NAME || '', version: kv.VERSION_ID || '', versionMajor: parseInt(kv.VERSION_ID || '0', 10), family };
}

// rpm -qa 输出包含 remi-release 且系统为 rhel 系 → remi 可用
function remiAvailable(family, versionMajor, rpmOutput) {
  return family === 'rhel' && versionMajor === 7 && /remi-release/.test(rpmOutput);
}

// dpkg -l 输出包含 php 相关包且系统为 debian 系 → sury 可用
function suryAvailable(family, versionMajor, dpkgOutput) {
  return family === 'debian' && /php/.test(dpkgOutput);
}

module.exports = { detectDistro, remiAvailable, suryAvailable };
