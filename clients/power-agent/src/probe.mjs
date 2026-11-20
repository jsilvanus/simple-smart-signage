import net from 'node:net';

function probeSinglePort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: ip, port });

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Probe TCP reachability on one or more ports.
 * Returns true if any port accepts a TCP connection within timeoutMs.
 */
export async function probeTcp(ip, ports, timeoutMs = 1500) {
  if (!ip) return false;
  const portList = Array.isArray(ports) ? ports : [ports];
  const validPorts = portList.filter((p) => Number.isInteger(p) && p > 0);
  if (validPorts.length === 0) return false;

  try {
    return await Promise.any(
      validPorts.map((port) =>
        probeSinglePort(ip, port, timeoutMs).then((ok) => {
          if (!ok) throw new Error('unreachable');
          return true;
        }),
      ),
    );
  } catch {
    return false;
  }
}
