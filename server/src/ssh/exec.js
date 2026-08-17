// 危险命令黑名单：命中即拒绝（硬性约束 8.1 第 5 条）
const DANGER_PATTERNS = [
  /\brm\s+-rf\s+(\/\s*$|\/\*)/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,
  /:\s*\(\s*\)\s*\{/,
  /\bchmod\s+(-R\s+)?777\s+\//,
  /\binit\s+0\b/,
];

function assertCommandSafe(command) {
  for (const pattern of DANGER_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`命令被安全策略拦截（命中危险模式: ${pattern}）`);
    }
  }
}

function run(client, command, { timeoutMs = 15000, maxOutput = 512 * 1024 } = {}) {
  assertCommandSafe(command);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { client.destroy(); } catch { /* 连接可能已断开 */ }
      reject(new Error(`命令执行超时（${timeoutMs}ms）: ${command.slice(0, 80)}`));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }
      stream.on('data', (d) => {
        if (stdout.length < maxOutput) stdout += d.toString();
      });
      stream.stderr.on('data', (d) => {
        if (stderr.length < maxOutput) stderr += d.toString();
      });
      stream.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  });
}

module.exports = { assertCommandSafe, run };
