#!/usr/bin/env node
import { createPowerAgent } from './src/agent.mjs';
import { DEFAULT_DATA_DIR } from './src/tokens.mjs';

export function loadAgentConfig(env = process.env) {
  const sissiUrl = (env.SISSI_URL || '').trim();
  const agentToken = (env.SISSI_AGENT_TOKEN || '').trim();
  if (!sissiUrl) {
    throw new Error('SISSI_URL environment variable is required');
  }
  if (!agentToken) {
    throw new Error('SISSI_AGENT_TOKEN environment variable is required');
  }

  const pollSeconds = env.SISSI_POLL_SECONDS ? Number(env.SISSI_POLL_SECONDS) : 60;
  if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) {
    throw new Error(`Invalid SISSI_POLL_SECONDS: ${env.SISSI_POLL_SECONDS}`);
  }

  return {
    sissiUrl,
    agentToken,
    dataDir: env.SISSI_POWER_DATA_DIR || DEFAULT_DATA_DIR,
    pollSeconds,
    wolBroadcast: env.SISSI_WOL_BROADCAST || '255.255.255.255',
  };
}

async function main() {
  const config = loadAgentConfig(process.env);
  const agent = createPowerAgent(config);

  const shutdown = (signal) => {
    console.log(`[power-agent] received ${signal}, stopping...`);
    agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log(
    `[power-agent] starting (url=${config.sissiUrl}, poll=${config.pollSeconds}s, dataDir=${config.dataDir})`,
  );
  await agent.start();
}

const isEntrypoint =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isEntrypoint) {
  main().catch((err) => {
    console.error(`[power-agent] fatal: ${err?.message || err}`);
    process.exit(1);
  });
}
