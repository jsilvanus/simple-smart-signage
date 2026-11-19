// Start script: `npm start`. Phase 1+ tasks wire real deps (storage, state, auth, download) here.
import { loadConfig } from './config.mjs';
import { createServer } from './server.mjs';

const config = loadConfig(process.env);
const server = createServer(config, {});
server.listen(config.port, () => {
  console.log(`sissi listening on :${config.port} (public path "${config.publicPath || '/'}")`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
