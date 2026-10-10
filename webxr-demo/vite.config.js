import { defineConfig } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const sourceRoot = resolve(projectRoot, '..');
const mime = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

// Serve source assets from GameSystems during development. The build copies only used files.
function sourceAssets() {
  return { name: 'gamesystems-source-assets', configureServer(server) {
    server.middlewares.use('/assets', (req, res, next) => {
      let url;
      try { url = decodeURIComponent((req.url || '').split('?')[0]); } catch { return next(); }
      const file = resolve(sourceRoot, '.' + url);
      if (!file.startsWith(sourceRoot + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
      res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
  } };
}

// The CharacterCreator files (src/vendor/extensions/character-cc/vendor/cc, from Contracts) are optional: without them src/contracts.js resolves to a stub that
// throws on import, so the build succeeds and the demo runs without the avatar extension (grab_findings 1.7).
function optionalContracts() {
  const entry = resolve(projectRoot, 'src/contracts.js'), stub = resolve(projectRoot, 'src/contracts-missing.js');
  const synced = () => existsSync(resolve(projectRoot, 'src/vendor/extensions/character-cc/vendor/cc/character.js'));
  return { name: 'optional-contracts', enforce: 'pre',
    buildStart() { if (!synced()) this.warn('Contracts modules not synced: building without the avatar (npm run sync with CONTRACTS_DIR)'); },
    resolveId(id, importer) {
      if (!importer || !id.endsWith('contracts.js') || id.startsWith('\0')) return null;
      const file = resolve(dirname(importer.split('?')[0]), id);
      return file === entry && !synced() ? stub : null;
    } };
}

export default defineConfig({
  plugins: [sourceAssets(), optionalContracts()],
  base: './',
  publicDir: 'public',
  server: { fs: { allow: [sourceRoot] } },
  build: { target: 'es2022', rollupOptions: { input: {
    bottles: resolve(projectRoot, 'index.html'), systems: resolve(projectRoot, 'systems.html'), fire: resolve(projectRoot, 'fire.html'),
  } } },
  worker: { format: 'es' },
});
