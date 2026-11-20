import { execFile as nodeExecFile } from 'node:child_process';

function runExecFile(execFileFn, file, args, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, stdout = '', stderr = '') => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    };

    try {
      const maybePromise = execFileFn(file, args, options, (err, stdout, stderr) => {
        done(err, stdout, stderr);
      });
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(
          (res) => done(null, res?.stdout ?? '', res?.stderr ?? ''),
          (err) => done(err),
        );
      }
    } catch (err) {
      done(err);
    }
  });
}

async function connectAdb(ip, port, timeoutMs, execFileFn) {
  const target = `${ip}:${port}`;
  const { stdout, stderr } = await runExecFile(
    execFileFn,
    'adb',
    ['connect', target],
    { timeout: timeoutMs },
  );
  const combined = `${stdout}\n${stderr}`.trim();
  if (/failed to connect|unable to connect|cannot connect/i.test(combined)) {
    throw new Error(`ADB connect failed for ${target}: ${combined}`);
  }
  return { target, output: combined };
}

/**
 * Put an Android TV to sleep via ADB (`KEYCODE_SLEEP` is idempotent).
 */
export async function sleepAndroidTv(
  ip,
  { port = 5555, timeoutMs = 10000, execFile = nodeExecFile } = {},
) {
  const { target } = await connectAdb(ip, port, timeoutMs, execFile);
  await runExecFile(
    execFile,
    'adb',
    ['-s', target, 'shell', 'input', 'keyevent', 'KEYCODE_SLEEP'],
    { timeout: timeoutMs },
  );
}

/**
 * Connect to an Android TV over ADB so the user can accept the RSA pairing prompt.
 */
export async function pairAdb(
  ip,
  { port = 5555, timeoutMs = 30000, execFile = nodeExecFile } = {},
) {
  return connectAdb(ip, port, timeoutMs, execFile);
}
