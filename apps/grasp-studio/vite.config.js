import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
// Quest 3 reaches the dev server through `adb reverse tcp:5180 tcp:5180`, so the page is http://localhost:5180 on the
// headset too: a secure context without certificates. Bind to the IPv4 loopback adb forwards to (README).
export const PORT = Number(process.env.GRASP_STUDIO_PORT) || 5180;

// Save endpoint (/api/grasps): writes the recorded library into GameSystems/extensions/grasp (server/grasp_store.mjs).
// GRASP_STUDIO_OUT=<file> writes elsewhere (tests). Loaded natively by node, not bundled into the config.
function graspStoreEndpoint() {
  return { name: 'grasp-studio-store', async configureServer(server) {
    const { graspStore } = await import(pathToFileURL(resolve(projectRoot, 'server/grasp_store.mjs')).href);
    const store = graspStore({ file: process.env.GRASP_STUDIO_OUT || undefined, log: m => server.config.logger.info(`[grasp-studio] ${m}`) });
    server.config.logger.info(`[grasp-studio] recordings are saved to ${store.file}`);
    server.middlewares.use('/api/grasps', store);
    // Hand animations / gesture poses (/api/hand): GameSystems/extensions/avatar/recorded_hand.json (server/hand_store.mjs).
    const { handStore } = await import(pathToFileURL(resolve(projectRoot, 'server/hand_store.mjs')).href);
    const hands = handStore({ file: process.env.GRASP_STUDIO_HAND_OUT || undefined, log: m => server.config.logger.info(`[grasp-studio] ${m}`) });
    server.config.logger.info(`[grasp-studio] hand clips are saved to ${hands.file}`);
    server.middlewares.use('/api/hand', hands);
  } };
}

// The CharacterCreator files (src/vendor/extensions/character-cc/vendor/cc, from Contracts) are optional, as in the bottle demo: without them src/contracts.js resolves
// to a stub that throws on import, so the build succeeds and the studio runs with the reference hand and no avatar twin.
function optionalContracts() {
  const entry = resolve(projectRoot, 'src/contracts.js'), stub = resolve(projectRoot, 'src/contracts-missing.js');
  const synced = () => existsSync(resolve(projectRoot, 'src/vendor/extensions/character-cc/vendor/cc/character.js'));
  return { name: 'optional-contracts', enforce: 'pre',
    buildStart() { if (!synced()) this.warn('Contracts modules not synced: building without the avatar twin (npm run sync with CONTRACTS_DIR)'); },
    resolveId(id, importer) {
      if (!importer || !id.endsWith('contracts.js') || id.startsWith('\0')) return null;
      const file = resolve(dirname(importer.split('?')[0]), id);
      return file === entry && !synced() ? stub : null;
    } };
}

export default defineConfig({
  plugins: [graspStoreEndpoint(), optionalContracts()],
  base: './',
  publicDir: 'public',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
  preview: { host: '127.0.0.1', port: PORT + 1, strictPort: true },
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
