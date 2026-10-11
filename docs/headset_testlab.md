# Headset test lab

The Quest 3 headset checks from [extensions_plan.md](extensions_plan.md) (steps 4, 6, 7, 9 and 10) run from one
bookmarkable page. The tool is `tools/headset-lab`; its [README](../tools/headset-lab/README.md) covers setup and
internals.

- **Bookmark in the Quest browser:** https://dionysus.dk/webxr/GameSystems/. This page reads `lan.json`, which the lab
  server publishes on start, and links to the LAN hub.
- **LAN hub:** `https://<pc-ip>:8443/`, currently `https://192.168.50.175:8443/`. It serves the tests, checklists,
  feedback buttons and server status. The demo is at `/demo/`, Grasp Studio at `/studio/` (recordings are appended as
  variants to `extensions/grasp/recorded_grasps.json` and `extensions/avatar/recorded_hand.json`; nothing is overwritten), and Contracts at
  `/contracts/`.
- **Start on the PC:** double-click the desktop shortcut "GameSystems testlab". No adb, no tunnel.
- **Certificate:** self-signed, with one origin for everything. Accept it once in the headset ("Avanceret → Fortsæt").
  You accept it again only when the browser forgets the decision or the PC's IP changes.
- **Results:** `docs/headset_results.jsonl`, one JSON object per line: `{ id, title, group, verdict: virker|fejl|delvist,
  note, link, at, ua }`.
- **Steam Frame:** its browser has no WebXR, so this lab is for Quest 3 only.

## Tests on the hub (`tools/headset-lab/hub/tests.js`)

| group | test ids | links (query parameters checked in code) |
|---|---|---|
| Grasp Studio (step 4, 7) | `studio-greb`, `studio-animation`, `studio-gestus`, `studio-kvalitet` | `/studio/`, `?side=left`, `?character=vrm`, `?quality=0..3` |
| Grasp Studio: avatar and variants | `studio-avatar`, `studio-varianter` | `/studio/?avatarview=mirror\|self`, `&character=vrm`; demo `?graspvariant=recorded&handvariant=recorded` |
| Hand poses and gestures (step 7) | `hands-controller`, `hands-tracked-pop`, `hands-contracts` | demo and Contracts `?handposes=low\|mid\|high` |
| Bottles in Contracts (step 9) | `contracts-flasker`, `contracts-brud`, `contracts-kvalitet` | `?quality=0..3`, `?bottles=mid` |
| Bottles in the demo | `demo-flasker` | `/demo/`, `?avatar=off` (the demo has no `?quality`; use the VR panel's "Kvalitet" button) |
| VRM and hand profile (step 6, 10) | `vrm-greb`, `contracts-greb`, `handprofil-runtime` | `?character=vrm`, `?testpanel` |
| Performance (step 3, 10) | `perf-mid` | `?testpanel&grasp=low\|mid\|high` |

The **demo test panel** (`webxr-demo/src/testpanel.js`, loaded only with `?testpanel`) adds a row above the demo's VR
panel, and the same controls on the desktop HUD:

- The frame interval, as the mean and the worst frame over the last second.
- The time of the last `grab` event. This is where the avatar adapts the grasp, including the mid/high closure search,
  once per bottle and hand.
- **Hånd**: cycles `player.setHandProfile` overrides: none, size 1.15 or 0.9, girth 1.3 or 0.8.
- **Greb**: cycles `setGraspQuality` between low, mid and high. `?grasp=` sets the starting value.

Two notes for the VRM and grasp tests:

- In the demo, every item gets the beer or wine grasp (`graspKind`), including the mugs. The can, mug and carton
  grasps exist only in Contracts, with the CC character. Contracts has no `?character`.
- The VRM test model (Jimmy, CC0) comes from `extensions/character-vrm/fetch_model.mjs`, and the demo sync copies it
  into `webxr-demo/public/vrm-assets`. The hub's status line shows whether it is in place.

## Kendte fejl / rettet

- **Grasp Studio: the panel did not react after a recording (2026-10-10).** Only the index finger of the hand that was
  *not* recording could press the in-VR panel. After a Greb capture you naturally press with the free recording hand,
  so Gem / Kassér seemed dead. Now the index finger of either hand works. The recording hand is ignored only while it
  is being captured (holding / arming / recording / stopping). Entering VR no longer goes through three's VRButton,
  whose `offerSession` Quest cancels ("called more than once") and which never offers again after you leave VR from
  the system menu. The page now has its own button: one request at a time, errors shown in the status line, and the
  label switches between "Gå i VR" and "Afslut VR". On session end the panel's poke state is reset. An unsaved capture
  is kept, so it can still be saved on the 2D page. `apps/grasp-studio/tests/smoke.mjs` checks the panel press with
  the recording hand, the page after leaving VR, and entering VR again.
- **The thumb was oddly twisted from the start (2026-10-10).** The avatar's thumb bones were posed by the shortest
  swing from the bind direction. That gave the thumb a roll that depended on the pose: about -25 to -70 deg in the
  relaxed hand and +60 deg in a thumbs-up on the CC body, so the nail did not sit off the bend plane. The thumb bones
  are now posed by frame (segment plus flexion hinge, `fingers.js` `thumbFrameDelta`, switch `THUMB_AXIS.roll`). The
  CC bind thumb lies within about 5 deg of the hinge convention, so the roll stays constant in every pose.
- **Thumb pronation from tracked hands (2026-10-10).** Tracked thumbs and recordings now carry an axial `twist`: the
  5th value of the thumb row, ±45 deg, measured from the MCP/IP bend plane. Before, the bend was projected onto a
  fixed plane, which put the tip out by about 20 mm at 20 deg of pronation. The twist is used by `rigdata.chainAngles`
  and `fingers.js` on the avatar, and by `record.rowsFromJoints`, `closure.fingerChain`, `grasp_validator` and
  `handposes` in the grasp code. Old 4-value rows mean twist 0. Controller, curve and baked sources have no twist, so
  the low tier keeps the fixed-plane thumb. The switches are `THUMB_AXIS.twist` and `THUMB_TWIST.enabled`. The tests
  are in `webxr-demo/tests/thumb-twist.test.js`.

- **Grasp Studio saves were refused silently (2026-10-10, evening).** The Quest recordings never reached disk. The lab
  process had loaded the studio's save validators once at start. After the thumb rows got a 5th value, every save was
  refused with 400. The server did not log or keep the refused saves, and the page cleared the capture, so those
  recordings are lost. Fixed:
  - the validators are re-imported when their file changes;
  - refused saves are logged and kept in `apps/grasp-studio/rejected/*.rejected.jsonl`;
  - the page queues every save in localStorage until the server confirms it, and shows a green "Gemt ✓" or red
    "IKKE GEMT" toast in VR; "Gem kø" retries the queue.

  Details: [ikvr_implementation.md](ikvr_implementation.md), round 2.

## Lab log and restarts

- The lab console (and `tools/headset-lab/.state/lab.log`) prints one line per `/studio/api/*`, `/api/results` and
  `/api/sync` request: `[lab] POST /studio/api/grasps -> 200 (7 ms, Quest, 192.168.50.x)`. A failed save shows here
  as `-> 400`, next to the studio's `save REFUSED (400): …` line.
- Changes to `tools/headset-lab/serve.mjs` or `hub/tests.js` take effect only after a lab restart. Close the console
  window (or stop the `node serve.mjs` process) and start the "GameSystems testlab" shortcut again.
- Avoid editing `apps/grasp-studio/vite.config.js` while the lab runs. Vite then restarts the studio inside the lab
  process, and repeated restarts can break the HMR websocket ("Invalid frame header"). Restart the lab instead.
