// Start script: `npm start`.
import { loadConfig } from './config.mjs';
import { createMetrics } from './metrics.mjs';
import { createServer } from './server.mjs';
import { createStorage } from './storage/index.mjs';
import { createState } from './state/index.mjs';
import { createAuth } from './auth/index.mjs';
import { createTunnusVerifier } from './auth/tunnus.mjs';
import { createDownloader } from './download/index.mjs';
import { createPushRunner } from './push/index.mjs';
import { createAdminAuth } from './admin-auth/index.mjs';
import { createAdminOidc } from './admin-oidc/index.mjs';
import { createPowerManager } from './power/manager.mjs';

const config = loadConfig(process.env);
const metrics = createMetrics();
const storage = createStorage(config.storage);
const state = createState(storage);
const tunnus = createTunnusVerifier(config);
const auth = createAuth(config, { tunnus });
const download = createDownloader(config);
const pushRunner = createPushRunner({ config, storage, state, download, metrics });
const adminOidc = createAdminOidc(config, { tunnus });
const adminAuth = createAdminAuth(config, { tunnus, oidc: adminOidc });
const powerManager = createPowerManager({ config, state });

await state.markInterruptedOnStart();

const hasPushScreens = (await state.listScreens()).some((s) => s.power?.routerId);
if (Object.keys(config.powerRouters ?? {}).length > 0 || hasPushScreens) {
  powerManager.start();
}

const server = createServer(config, {
  metrics,
  storage,
  state,
  auth,
  download,
  pushRunner,
  adminAuth,
  adminOidc,
});

server.listen(config.port, () => {
  console.log(`sissi listening on :${config.port} (public path "${config.publicPath || '/'}")`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(async () => {
      await powerManager.stop();
      await pushRunner.waitForIdle();
      process.exit(0);
    });
  });
}
