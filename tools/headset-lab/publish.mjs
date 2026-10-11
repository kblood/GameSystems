// Publishes the lab's current LAN URL to the cloud entry page (https://dionysus.dk/webxr/GameSystems/lan.json), so a
// bookmark in the headset always finds the lab, even after the PC got a new IP. Same SSH setup as
// webxr-demo/deploy.ps1 (key C:\Devstuff\GCloud\caldor_nopass, kaspersolesen@35.228.204.127). lan.json holds only the
// LAN URL, IP, port and a timestamp. Uploaded only when the public file has another URL; never throws (the lab keeps
// running without it).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CLOUD = Object.freeze({
  pageUrl: 'https://dionysus.dk/webxr/GameSystems/',
  host: '35.228.204.127', user: 'kaspersolesen', port: 22,
  key: 'C:\\Devstuff\\GCloud\\caldor_nopass',
  remoteDir: '/var/www/html/webxr/GameSystems',
});

const exe = name => {
  const win = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', `${name}.exe`);
  return existsSync(win) ? win : name;
};
const sshOptions = key => ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new'];
const run = (cmd, args, timeout = 60000) => new Promise((ok, fail) => execFile(cmd, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
  if (error) { error.message = `${cmd.split(/[\\/]/).pop()} ${error.code ?? ''}: ${(stderr || error.message).trim()}`; fail(error); } else ok(stdout);
}));

/** The public lan.json, or null (missing / offline). */
export async function readPublished(pageUrl = CLOUD.pageUrl) {
  try {
    const res = await fetch(new URL('lan.json', pageUrl), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/**
 * Upload lan.json when the public one has another URL. Resolves to { state: 'unchanged' | 'published' | 'failed' |
 * 'skipped', url, publishedAt?, error? }.
 */
export async function publishLan({ url, ip, port, cloud = CLOUD, log = () => {} }) {
  try {
    const current = await readPublished(cloud.pageUrl);
    if (current?.url === url) return { state: 'unchanged', url, publishedAt: current.publishedAt };
    if (!existsSync(cloud.key)) return { state: 'skipped', url, error: `SSH-nøgle mangler: ${cloud.key}` };
    const doc = { url, ip, port, publishedAt: new Date().toISOString() };
    const dir = await mkdtemp(join(tmpdir(), 'gs-lab-'));
    const local = join(dir, 'lan.json'), remoteTmp = `/tmp/gamesystems-lan.${process.pid}.${Date.now()}.json`;
    const target = `${cloud.user}@${cloud.host}`, opts = sshOptions(cloud.key);
    try {
      await writeFile(local, JSON.stringify(doc, null, 2) + '\n');
      await run(exe('scp'), [...opts, '-P', String(cloud.port), local, `${target}:${remoteTmp}`]);
      // install = copy + owner + mode in one step; the folder is the entry page's (deploy-hub.ps1), created if missing.
      await run(exe('ssh'), [...opts, '-p', String(cloud.port), target,
        `set -e; sudo mkdir -p '${cloud.remoteDir}'; sudo install -m 644 -o www-data -g www-data '${remoteTmp}' '${cloud.remoteDir}/lan.json'; rm -f '${remoteTmp}'`]);
    } finally { await rm(dir, { recursive: true, force: true }); }
    log(`LAN-adressen er lagt op: ${cloud.pageUrl}lan.json -> ${url}`);
    return { state: 'published', url, publishedAt: doc.publishedAt };
  } catch (error) {
    return { state: 'failed', url, error: error.message };
  }
}
