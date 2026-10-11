// LAN addresses and the lab's self-signed TLS certificate (no npm dependencies).
// WebXR needs a secure context, and a LAN IP over plain http is not one, so the lab serves HTTPS with a self-signed
// certificate whose subjectAltName lists localhost, 127.0.0.1 and this PC's LAN IPv4 addresses. The headset browser shows
// a warning once per origin (https://<ip>:<port>); the user accepts it ("Avanceret -> Fortsæt").
// The certificate is generated once with OpenSSL (Git for Windows ships one) into cert/ (gitignored) and regenerated
// only when the primary LAN IP is missing from it (new DHCP lease), which means one new acceptance in the headset.
import { X509Certificate } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

// Adapters that are never the LAN the headset is on (Hyper-V/WSL, VirtualBox/VMware host-only, VPNs).
const VIRTUAL = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Tailscale|ZeroTier|vpn|docker/i;

/** Non-internal IPv4 addresses: [{ address, name, virtual }]. */
export function ipv4Addresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ address: a.address, name, virtual: VIRTUAL.test(name) });
  }
  return out;
}

/**
 * The IPv4 address of the default route (what the headset reaches on the LAN): a connected UDP socket picks the
 * outgoing interface without sending anything. Falls back to the first non-virtual adapter.
 */
export function primaryIPv4() {
  return new Promise(ok => {
    const fallback = () => (ipv4Addresses().find(a => !a.virtual) || ipv4Addresses()[0])?.address || '127.0.0.1';
    const s = createSocket('udp4');
    const done = ip => { try { s.close(); } catch {} ok(ip); };
    s.on('error', () => done(fallback()));
    try {
      s.connect(53, '8.8.8.8', () => {
        let ip = null;
        try { ip = s.address().address; } catch {}
        done(ip && ip !== '0.0.0.0' ? ip : fallback());
      });
    } catch { done(fallback()); }
  });
}

/** OpenSSL executable: OPENSSL env, Git for Windows' copies, else `openssl` on PATH. */
export function findOpenSSL() {
  const candidates = [process.env.OPENSSL, 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe'].filter(Boolean);
  return candidates.find(p => existsSync(p)) || 'openssl';
}

/** Names in a PEM certificate's subjectAltName: { dns: [...], ip: [...] } (null when unreadable). */
export function certNames(pem) {
  try {
    const san = new X509Certificate(pem).subjectAltName || '';
    const dns = [], ip = [];
    for (const part of san.split(',').map(s => s.trim())) {
      if (part.startsWith('DNS:')) dns.push(part.slice(4));
      else if (part.startsWith('IP Address:')) ip.push(part.slice(11));
    }
    return { dns, ip };
  } catch { return null; }
}

const run = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, { windowsHide: true, timeout: 60000 }, (error, stdout, stderr) => {
  if (error) { error.message += stderr ? `\n${stderr}` : ''; fail(error); } else ok(stdout);
}));

/**
 * Make sure dir/cert.pem + dir/key.pem exist and cover `required` IPs (plus localhost / 127.0.0.1); `include` IPs are
 * added to a newly generated certificate too. Resolves to { key, cert, created, ips, file }.
 */
export async function ensureCert(dir, { required = [], include = [], openssl = findOpenSSL(), log = () => {} } = {}) {
  const certFile = join(dir, 'cert.pem'), keyFile = join(dir, 'key.pem');
  if (existsSync(certFile) && existsSync(keyFile)) {
    const cert = await readFile(certFile), key = await readFile(keyFile);
    const names = certNames(cert);
    if (names && required.every(ip => names.ip.includes(ip))) return { key, cert, created: false, ips: names.ip, file: certFile };
    log(`certifikatet dækker ikke ${required.join(', ')}: laver et nyt (headsettet skal acceptere det igen)`);
  }
  const ips = [...new Set(['127.0.0.1', ...required, ...include])];
  await mkdir(dir, { recursive: true });
  const cnf = join(dir, `openssl.${process.pid}.cnf`);
  // A config file instead of -subj/-addext: works with every OpenSSL build and avoids MSYS path mangling of "/CN=".
  await writeFile(cnf, [
    '[req]', 'distinguished_name = dn', 'x509_extensions = v3', 'prompt = no', '',
    '[dn]', 'CN = GameSystems testlab', 'O = GameSystems headset lab (local self-signed)', '',
    '[v3]', 'subjectAltName = @alt', 'basicConstraints = critical,CA:FALSE', 'keyUsage = critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage = serverAuth', 'subjectKeyIdentifier = hash', '',
    '[alt]', 'DNS.1 = localhost', ...ips.map((ip, i) => `IP.${i + 1} = ${ip}`), '',
  ].join('\n'));
  try {
    await run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-keyout', keyFile, '-out', certFile, '-config', cnf]);
  } catch (error) {
    throw new Error(`kunne ikke lave certifikatet med ${openssl} (sæt OPENSSL=<sti til openssl.exe>): ${error.message}`);
  } finally { await rm(cnf, { force: true }); }
  const cert = await readFile(certFile), key = await readFile(keyFile);
  log(`nyt selvsigneret certifikat: ${certFile} (localhost, ${ips.join(', ')})`);
  return { key, cert, created: true, ips, file: certFile };
}
