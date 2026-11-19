// Start script: `npm start`.
import { loadConfig } from './config.mjs';
import { createMetrics } from './metrics.mjs';
import { createServer } from './server.mjs';
import { createStorage } from './storage/index.mjs';
import { createState } from './state/index.mjs';
import { createAuth } from './auth/index.mjs';
import { createDownloader } from './download/index.mjs';
import { createPushRunner } from './push/index.mjs';
import { createAdminAuth } from './admin-auth/index.mjs';

const config = loadConfig(process.env);
const metrics = createMetrics();
const storage = createStorage(config.storage);
const state = createState(storage);
const auth = createAuth(config);
const download = createDownloader(config);
const pushRunner = createPushRunner({ config, storage, state, download, metrics });
const adminAuth = createAdminAuth(config);

await state.markInterruptedOnStart();

const server = createServer(config, {
  metrics,
  storage,
  state,
  auth,
  download,
  pushRunner,
  adminAuth,
});

server.listen(config.port, () => {
  console.log(`sissi listening on :${config.port} (public path "${config.publicPath || '/'}")`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(async () => {
      await pushRunner.waitForIdle();
      process.exit(0);
    });
  });
}
