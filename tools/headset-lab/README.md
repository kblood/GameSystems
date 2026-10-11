# Headset test lab (Quest 3)

One bookmarkable page in the Quest browser runs every pending headset test. You don't need to type a URL, run a CLI
command, use adb or set up a tunnel. Background and the test list: [`docs/headset_testlab.md`](../../docs/headset_testlab.md).

## Use

1. On the PC, double-click **GameSystems testlab** on the desktop. The shortcut runs `Start GameSystems testlab.cmd` in
   a console window titled "GameSystems testlab (Quest 3)". If the lab is already running, the window says so and does
   not start a second one.
2. In the Quest browser, open the bookmark **https://dionysus.dk/webxr/GameSystems/** and tap **Åbn testlab**.
3. The first time, the browser warns that the connection is not private, because the certificate is self-signed. Tap
   **Avanceret → Fortsæt til … (usikkert)**.
4. The hub lists the tests by system. Each test has one-tap links, a checklist, and the buttons **Virker / Fejl /
   Delvist** with an optional note. Answers are appended to `GameSystems/docs/headset_results.jsonl`.

To stop the lab, close the console window or press Ctrl+C. There is no autostart.

## What runs where

All of it runs in one node process on the PC (`serve.mjs`), with one HTTPS origin on `0.0.0.0:8443`:

| path | what | how |
|---|---|---|
| `/` | hub page (`hub/`) | static; test list in `hub/tests.js` |
| `/demo/` | `webxr-demo` (index, `systems.html`, `fire.html`) | the demo's own Vite in middleware mode, from its `vite.config.js`; `base: '/demo/'`, HMR socket `/demo/hmr` |
| `/studio/` | `apps/grasp-studio` | same, `base: '/studio/'`, HMR `/studio/hmr`; `/studio/api/grasps` and `/studio/api/hand` save to disk as with `npm run dev` |
| `/contracts/` | `NightfallContractsWebXR-interaction` root (`CONTRACTS_DIR` overrides it) | static files, like its `tools/serve.mjs` |
| `/api/status` | app state, sync, VRM/CC availability, recordings (count and time), cloud publish | JSON |
| `/api/results` | GET: the reported results. POST `{ id, verdict: virker\|fejl\|delvist, note?, link? }` | appends `{ id, title, group, verdict, note, link, at, ua }` |
| `/api/sync` | POST: re-runs the demo and studio syncs (the hub's "Synk apps igen" button) | |

On start, `serve.mjs` does the following:

1. Finds the LAN IP. This is the default-route interface, for example `192.168.50.175`.
2. Makes sure the certificate exists (see the next section).
3. Runs the demo and studio syncs. These are the same scripts that `npm run sync`/predev runs. They only copy
   GameSystems extensions into gitignored vendor folders. Contracts' `npm run sync` is never run.
4. Starts both Vite apps.
5. Prints the status.
6. Publishes `lan.json` to the cloud page when the public one has a different URL.

The upload uses scp/ssh with the same key and host as `webxr-demo/deploy.ps1`. A failed upload is reported and the
lab keeps running.

The apps run as before. `npm run dev`, `npm test` and the adb flow are unchanged. The lab gives each app a separate
dependency cache (`node_modules/.vite-headset-lab`), so it can run alongside an app's own `npm run dev`. The demo has
one small addition, `src/testpanel.js`, which `main.js` loads only with `?testpanel`.

Grasp Studio's save endpoints accept only same-machine `Origin`s. For `/studio/api/*`, the lab first checks that the
`Origin` matches its own `Host`, then presents it as localhost. Cross-site posts are still refused (403).

## Certificate

- The certificate is `cert/cert.pem` + `cert/key.pem` (gitignored). It is generated once with Git for Windows' OpenSSL
  (`OPENSSL=<path>` overrides it) and is valid for 825 days. The SAN covers `localhost`, `127.0.0.1` and every LAN IPv4
  address of the PC.
- **There is one exception for the whole lab.** Everything is on one origin (one port), so the warning is accepted once
  and covers the demo, the studio and Contracts.
- Chromium remembers the decision for a while. When it expires, the warning comes back and you accept it again.
- The certificate is regenerated only when the PC's LAN IP is not in it, for example after a new DHCP lease. The
  headset then asks once more. The cloud page always points at the current IP.
- An accepted self-signed certificate still gives a secure context, so WebXR works. This was verified in desktop
  Chrome: `isSecureContext` is true. It has not been verified on a real Quest.

## Cloud entry page

`cloud/index.html` is deployed with `deploy-hub.ps1` (`-VerifyOnly` only checks the live page) to
`/var/www/html/webxr/GameSystems` and served at https://dionysus.dk/webxr/GameSystems/. The page:

- Reads `lan.json` (`{ url, ip, port, publishedAt }`) from its own origin and shows one big button to the LAN hub.
- Explains the certificate warning.
- Tells you what to do if the button does not load: the lab is not running, so double-click the desktop shortcut.
- Makes no LAN requests of its own. Chrome's private-network-access rules would make them unreliable.

Deploys keep the live `lan.json`.

## Files

- `serve.mjs`: the server, also usable as a module (`startLab({ port, resultsFile, certDir, sync, publish, apps })`)
- `cert.mjs`: LAN addresses and the certificate
- `publish.mjs`: `lan.json` upload
- `hub/`: hub page (`tests.js` is the test catalogue; it is shared with the server, which uses it to validate result ids)
- `cloud/`: cloud entry page
- `deploy-hub.ps1`: deploys `cloud/`
- `Start GameSystems testlab.cmd`: double-click launcher
- `make-shortcut.ps1`: (re)creates the desktop shortcut (WScript.Shell)
- `test/lab.test.mjs`: `node --test tools/headset-lab/test/lab.test.mjs` (from `GameSystems`). It starts the lab on a
  free port with a temp certificate, a temp results file and temp studio save files, with no sync and no publish.
- `.state/lab.log`: console log (gitignored)

## Adding a test

Add an entry to `hub/tests.js`, with an `id`, a title, links as lab paths with query parameters, and a checklist. Check
first that every query parameter exists in the app's code (the header of `tests.js` lists the parameters). Then
reload the hub. A server restart is needed only for result-id validation.

## If something is wrong

- **The button on the cloud page does not load:** the lab is not running on the PC, or the Quest is on another
  network.
- **Port 8443 is in use by another program:** run `node serve.mjs --port 8444` (or set `HEADSET_LAB_PORT`). The new
  port needs its own certificate acceptance, and the cloud page follows on the next start.
- **The VRM model is missing** (`?character=vrm`): run `node extensions/character-vrm/fetch_model.mjs` in GameSystems.
  It downloads Jimmy (CC0) with a sha256 check. Then tap "Synk apps igen" on the hub.
- **Windows firewall:** node.exe is allowed inbound on Private networks. The lab does not change firewall settings.
