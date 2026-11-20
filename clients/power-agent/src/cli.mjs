#!/usr/bin/env node
import { pairSamsung } from './samsung.mjs';
import { pairAdb } from './adb.mjs';
import { DEFAULT_DATA_DIR, saveSamsungToken, tokensFilePath } from './tokens.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage() {
  console.error(
    [
      'Usage:',
      '  node clients/power-agent/src/cli.mjs pair-samsung <ip> [--port 8002]',
      '  node clients/power-agent/src/cli.mjs pair-adb <ip> [--port 5555]',
    ].join('\n'),
  );
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ip] = positional;
  const dataDir = process.env.SISSI_POWER_DATA_DIR || DEFAULT_DATA_DIR;

  if (!command || flags.help || flags.h) {
    usage();
    process.exit(command ? 0 : 1);
  }

  if (command === 'pair-samsung') {
    if (!ip) {
      console.error('Error: <ip> is required for pair-samsung');
      usage();
      process.exit(1);
    }
    const port = flags.port ? Number(flags.port) : 8002;
    console.log(`Connecting to Samsung TV at ${ip}:${port}...`);
    console.log('Accept the "Allow device?" prompt on the TV remote.');
    const { token } = await pairSamsung(ip, { port });
    await saveSamsungToken(dataDir, ip, token);
    console.log(`Paired Samsung TV ${ip}. Token saved to ${tokensFilePath(dataDir)}`);
    return;
  }

  if (command === 'pair-adb') {
    if (!ip) {
      console.error('Error: <ip> is required for pair-adb');
      usage();
      process.exit(1);
    }
    const port = flags.port ? Number(flags.port) : 5555;
    console.log(`Connecting to Android TV via ADB at ${ip}:${port}...`);
    console.log('Accept "Always allow from this computer" on the TV if prompted.');
    const res = await pairAdb(ip, { port });
    console.log(res.output || `Connected to ${ip}:${port}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(`Error: ${err?.message || err}`);
  process.exit(1);
});
