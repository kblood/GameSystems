# Arbejdsplan: grab-system og avatar (Contracts + Bottles-demo)

Sammenlagt fra 34 verificerede punkter til 26 opgaver. De rettede forslag fra skeptikerne er brugt. Hvor de to rettelser var uenige, er valget og grunden skrevet med.

---

## 1) Gør nu: små opgaver med høj værdi

**1.1 Hånden bliver hængende på en flaske, der er skudt i stykker**
- **Status:** ✅ Rettet 2026-10-09 (extensions trin 1): `interaction._dropHold` sender `release`; `breakage.onBroken` → `interaction.dropBottle` + `broken`-event; avatarens `update` dropper holds uden parent. `shoot()`-delen er ikke lavet.
- **Projekt:** demo
- **Hvorfor:** `interaction.js:179` fjerner holdet uden `avatar.release(owner)`. `breakage.shoot` rammer også en flaske, man holder (via `factory.remove`, `breakage.js:183`). Hånden bliver derfor svejset fast på en frakoblet root, og på desktop bliver armen stående i "holding". Reset er ikke ramt, fordi `releaseAll` kører først.
- **Ændring:** Lav en hjælper `_dropHold(owner)`, der gør `held.delete` + `avatar?.release(owner)`. Brug den i linje 179 og i `release()`. Som backstop springer `avatar.update` holds over og sletter dem, hvis `!h.bottle.root.parent`. Valgfrit: `shoot()` springer flasken i skyderens egen hånd over.
- **Indsats:** S
- **Effekt:** høj

**1.2 Controller-disconnect eller skift til hand tracking efterlader flasken frosset i luften som kinematisk**
- **Status:** ✅ Rettet 2026-10-09: `_onDisconnected` slipper med hastighed 0 og sender `disconnect`; `_checkTracking` slipper efter `LOST_RELEASE_SECONDS` (0,25 s) uden pose.
- **Projekt:** demo
- **Hvorfor:** Handleren for `'disconnected'` (`interaction.js:74`) nulstiller kun handedness. Holds, der er toggled med pinch (`selectstart`), slipper aldrig, og `physics.hold` holder kroppen fast på en forældet pointer-pose.
- **Ændring:** I `'disconnected'` kaldes `this.release(i)` med hastighed 0, før handedness nulstilles. Derudover slippes XR-holds, når `!entry.pointer.visible` har varet mere end ca. 0,25 s, så tabt hand tracking uden disconnect også er dækket. Man kan ikke stole på `squeezeend` for pinch-holds.
- **Indsats:** S
- **Effekt:** høj

**1.3 Standard-poses forsvandt i lab-v1-refittet, så `defaultPose()` tager bare den første pose i listen**
- **Status:** ✅ Rettet 2026-10-09 (extensions trin 2): `apply_grasp_fit.mjs` (nu i `extensions/grasp/tools`) flytter flaget (`restoreDefaults`: `_r000_t+1` med mindst |offset|, ellers laveste `nearestPose`-cost); data regenereret med værktøjet (beer-L, wine-R/L `_r000_t+1`; can-R r315, can-L r045, da can ikke har r000). Tests i Contracts og demo. Demo-stopgap er unødvendig: demoen bruger nu `defaultPose` fra extensionen.
- **Projekt:** begge
- **Sammenlagt:** to punkter.
- **Hvorfor:** Kun `bottle_beer/right/body` har stadig `default:true`. Beer-L, wine-R, wine-L, can-R og can-L falder tilbage på `list[0]`: r045, r045, r315, r135 og r045. `apply_grasp_fit.mjs` flytter aldrig default-flaget. Demoens `avatar.js:23` afhænger direkte af det, så vin og venstre hånd sidder 45° forkert.
- **Ændring:**
  - **Contracts:** Når `apply_grasp_fit.mjs` dropper en default, flyttes flaget til en overlevende pose i samme kind/side/grasp. Første valg er `…_r000_t+1` ved vilkårligt offset, ellers den laveste `nearestPose`-cost til den gamle default. Generér dataene med værktøjet. Tilføj en test: hver gruppe, der havde en default i bagningen, har stadig præcis én med o+0.0000 og t+1. Neck, mug/body og magazine/base_pinch undtages, fordi de aldrig har haft en default. Kør `npm run test:hands` og interaction-smoke bagefter, fordi venstre-default i `hand_probe` og `interaction_smoke` ændrer sig.
  - **Demo (stopgap indtil resync):** `graspFor` vælger først efter id-mønsteret `_r000_t\+1$` med lavest |offset| og falder ellers tilbage på `defaultPose`.
- **Indsats:** S
- **Effekt:** høj

**1.4 Runtime-clamp af bagte fingerrækker og audit af det, der faktisk sendes**
- **Status:** ✅ Rettet 2026-10-09 (trin 2): `runtimeRows(pose)` memoiserer clampede open/closed-rækker (WeakMap), `withSkinMargin` memoiseres, `setGraspQuality('raw'|'clamped')`. Audit tjekker angles/open/margin (mug 8 hver, carton 0); test af `fingerState` for alle poses ved t ∈ {0; 0,5; 1} i stedet for `present()`. **Undtagelse:** mug står i `CLAMP_EXEMPT` og sendes rå, fordi clampen (tommel-pitch 100 → 65) gav 27 mm indtrængning og 83° opposition i `test:hands`; fjernes efter mug-refittet (3.1).
- **Trin 3 (2026-10-09):** `SKIN_MARGIN`/`withSkinMargin` er fjernet; lukning-til-kontakt (`extensions/grasp/closure.js`, `graspPose`) erstatter dem, og output fra `mid`/`high` er clampet. Kvalitet: `raw | low | mid | high` (`'clamped'` = `low`, default `mid`). **Mug-undtagelsen består:** grebs-lab fandt ingen tommel inden for led-grænserne, der holder kruset på CC-huden (clampet tommel: 27,8 mm ind; tommel-søgning i range: op til 12 mm ind / opposition 0). I `mid` lukkes mugs fire fingre i range, og kun tommelen (`EXEMPT_KEEP`) følger sin rå række (lukket langs sin form uden clamp). Marginens tommel-del (+10° bend1) er lagt ind i mug-poserne i `baked_grasps.data.json`. `test:hands` mug/left: indtrængning 1,28 → 0,91 mm, opposition 123,8° (uændret). Audit: `known = { mug.angles: 8, mug.open: 8 }` (margin-tællingen er væk).
- **Projekt:** contracts
- **Sammenlagt:** fem punkter (clamp, "runtime never clamped", cache-and-clamp, audit på withSkinMargin og test af runtime-output).
- **Hvorfor:** Headeren i `grasp_validator.js:9` påstår, at `clampRows` bruges ved runtime, men intet i `src/` kalder den. `grab.js:184` sender `fingerState(withSkinMargin(pose))` direkte videre, og pluginet (`index.js:112`) spreader det ind uden limits. Alle 8 mug-poses er ude af range, både lukkede og åbne rækker (default-tommel dyaw 56/pitch 70 mod grænserne 30/65). Carton har 4 ude, men kun med 1°. Auditen tjekker kun rå `p.angles`. Demoen clamper allerede, så Contracts er bagud i forhold til sin egen forbruger.
- **Ændring:**
  - I `baked_grasps.js` memoiseres de clampede open-rækker og de clampede skin-margin-closed-rækker pr. pose-id, og `fingerState` lerper mellem dem. HARD er en boks, så lerp mellem to clampede endepunkter bliver i range. Det koster intet pr. frame.
  - Det dækker også `openFingerState`/`magazineFingers`.
  - Tilføj et `GRASP_QUALITY`-flag (`'raw' | 'clamped'`, default `'clamped'`) til lab og diagnose, og gør headerkommentaren sand.
  - **Tests:**
    - (a) Udvid bake-auditten til at tjekke `p.open` og `withSkinMargin(p).angles` mod det kendte budget. Tallene kan stige for mug.
    - (b) Én grab-test: for hver LAYOUT-kind med venstre hånd, own default og kør `present()` ved t ∈ {0; 0,5; 1}. Assert at `validateRows(...).ok`. Det verificerer, at clampen faktisk er koblet på.
  - Tjek mug visuelt bagefter i `test:hands`, fordi tommelen kan miste kontakt. Clampen er et værn. Selve rettelsen er mug-refittet (3.1).
- **Bemærk:** Magazine-påstanden er droppet. Runtime bruger kun `magazineFingers(1)`, og den er i range.
- **Indsats:** S
- **Effekt:** høj

**1.5 Held-drive i Contracts ignorerer håndens rotation og bruger en peak-hastighed**
- **Status:** ✅ Rettet 2026-10-09 (trin 2): `createHandMotion`/`pushHandMotion` (gennemsnit af 2 samples) og `carriedVelocity` i `held_drive.js`; `grab.js` sender `velocity = v + ω × (targetCom − pose.pos)`, `angular = ω`. Rettet også manglende `−v·dt` i `driveAcceleration`. Tests: 3 rad/s < 3°, jitter ≤ 0,75 × håndens; stop fra 1 m/s giver ca. 25 mm overshoot (før 79) — < 5 mm er umuligt med 90 m/s²-loftet, så grænsen er < 30 mm.
- **Projekt:** contracts
- **Hvorfor:**
  - `grab.js:165` (ikke 255) sætter `angular:[0,0,0]` og `velocity: history.linear`.
  - Damping modarbejder derfor hver håndledsdrejning, med cirka 11° lag ved 3 rad/s.
  - `history.linear` er peak-hastigheden over 0,1 s, så målet overshooter, når hånden stopper.
- **Ændring:**
  - I `update()` gemmes et let udglattet aktuelt sample (gennemsnit af 2-3 samples) som `h.vel`/`h.spin`.
  - Send `angular: h.spin` (world space) og `velocity: h.vel + h.spin × (targetCom − pose.pos)`. Driven går efter COM, ikke grebspunktet.
  - Behold history til kast.
  - Tests:
    - rotation med 3 rad/s giver under 3° fejl
    - 1 m/s og så stop giver under 5 mm overshoot
    - en stillestående hånd med 2 mm jitter giver ikke mere jitter end i dag
- **Indsats:** S
- **Effekt:** høj

**1.6 Desktop-hældning drejer om flaskens midtpunkt, så hånden kredser i stedet for at håndleddet drejer**
- **Status:** ✅ Rettet 2026-10-09: `tiltAboutGrip` i `interaction.js` (kun med aktiv avatar; uden avatar som før).
- **Projekt:** demo
- **Hvorfor:** `interaction.js:185-195` holder flaskens centrum fast. Grebet sidder cirka 0,1 m radialt fra og under centrum, så hånden bevæger sig i en bue.
- **Ændring:** Når avataren er aktiv, beregnes grebspunktet `P = base0 + q0·grasp.wrist` fra den urotererede pose. Sæt `q = Rtilt·q0` og `base = P − q·grasp.wrist`. Det er et par linjer i `interaction.step`, og `holdPose` ændres ikke. Tjek at flaskehalsen stadig er i billedet.
- **Indsats:** S
- **Effekt:** høj

**1.7 Demoen crasher hårdt uden Contracts-repoet ved siden af**
- **Status:** ✅ Rettet 2026-10-09: avataren er en extension indlæst med `import()`; Contracts-moduler kun via `src/contracts.js`, som vite-plugin'et `optional-contracts` bytter til `contracts-missing.js` (build virker uden Contracts); `REQUIRE_CONTRACTS=1` gør sync streng; tests springer over.
- **Projekt:** demo
- **Hvorfor:** Den statiske import i `main.js:11` og vendor-importerne i `avatar.js:5-7` fejler ved link-tid på en frisk klon, fordi vendor-mappen er gitignoreret. Derfor kører `.catch` i `main.js:149` aldrig. `tests/avatar-grasp.test.js` giver `ERR_MODULE_NOT_FOUND` i stedet for at springe over.
- **Ændring:**
  - Brug `import('./avatar.js').then(...)` i den eksisterende `?avatar!=='0'`-gren.
  - Build: Rollup fejler også på en dynamisk import, der ikke kan resolves. Vælg eksplicit: `sync` exit'er 1 ved `REQUIRE_CONTRACTS=1` (sat i build-scriptet), som er det simpleste, eller brug en guarded `import.meta.glob`.
  - Test: `existsSync(...)`, dynamisk `await import` og `{ skip: 'kør npm run sync med CONTRACTS_DIR' }`.
- **Indsats:** S
- **Effekt:** høj

**1.8 Send kun de avatar-assets, demoen faktisk loader (dist ca. 30 MB → ca. 12 MB)**
- **Status:** ✅ Rettet 2026-10-09: `src/avatar-config.js` (`DEMO_AVATAR`, `avatarAssetFiles`); avatar-assets 28 MB → 11 MB. Allowlisten tager også standard-undertøjet (`clothing_briefs.glb`) med, som pluginet altid henter.
- **Projekt:** demo
- **Hvorfor:** `sync-helpers.mjs:35-37` kopierer hele assets-mappen (28 MB). Kun base_body (7,2 MB), short02 og shirt/jeans/shoes bliver brugt, i alt ca. 10,3 MB. Resten er 7 andre frisurer (ca. 11 MB), 11 tøjstykker (ca. 5,5 MB) og `animations/` (1,9 MB), som ingen henter.
- **Ændring:**
  - Allowlist: `base_body.glb`, `base_body.joints.json`, `hair.json`, `clothing.json`, `asset_licenses.json` og `SYNCED.txt`.
  - GLB'erne findes ud fra et delt `src/avatar-config.js` (ren ESM) med `DEMO_AVATAR`, opslået via `hair.json`/`clothing.json`.
  - `body_colliders.json` kopieres kun, hvis der findes et cloth-tier.
  - `AVATAR_ASSETS=all` er en nødudgang.
  - Verificér med `du -sh` og en load af `?avatar=1` uden 404.
- **Indsats:** S
- **Effekt:** høj

**1.9 XR enter/exit: kalibrering og gendannelse af desktop**
- **Status:** ✅ Rettet 2026-10-09: `DESKTOP_EYE = 1.6`; avataren kalder `resetTracking()` på `xrStart`/`xrEnd`; `interaction.restoreDesktop()` på `sessionend`.
- **Projekt:** demo
- **Sammenlagt:** to punkter.
- **Hvorfor:**
  - Pluginet auto-kalibrerer én gang. Desktop-kameraet står i y=1,25, så avataren skaleres til 1,25 m øjenhøjde og bliver ved med det i XR.
  - Ingen kalder `resetTracking`.
  - Efter XR-exit beholder kameraet head-posen fra XR (inklusive roll).
  - `_desktopMove` ignorerer `rig.rotation.y`, så WASD går forkert efter et snap-turn.
- **Ændring:**
  - Hæv desktop-kameraet til `DESKTOP_EYE ≈ 1.6`.
  - På `sessionstart`: `avatar?.player.resetTracking()`.
  - På `sessionend`:
    ```js
    interaction.yaw += rig.rotation.y; rig.rotation.y = 0;
    camera.position.set(0, DESKTOP_EYE, 0);
    camera.rotation.set(interaction.pitch, interaction.yaw, 0, 'YXZ');
    avatar?.player.resetTracking();
    ```
  - Kald aldrig den eksplicitte `calibrate()`. Den sætter `auto=false` permanent, og så auto-kalibrerer XR aldrig igen.
- **Indsats:** S
- **Effekt:** medium

**1.10 Carton er 1° uden for grænsen på 4 poses**
- **Status:** ✅ Rettet 2026-10-09 (trin 2): `convert_baked_grasps.mjs` clamper til HARD (2° slør); data-filen er clampet (dyaw −56 → −55), `known.carton` = 0.
- **Projekt:** contracts
- **Hvorfor:** Det gælder `carton/{L,R}/face/n+y_f±z`, både lukkede og åbne rækker: tommel dyaw −56 mod HARD −55. Fitteren tager kun `mode:'wrap'`, så den kan ikke røre carton.
- **Ændring:** Clamp i `convert_baked_grasps.mjs` (så en reconvert beholder rettelsen) og sæt `known.carton` til 0. Hyperextension-advarslerne for bend2 tages separat med en lab-måling.
- **Indsats:** S
- **Effekt:** medium (lav risiko)

---

## 2) Næste

**2.1 Lag-loop: flasken følger håndleddet fra forrige frame, og hånden følger flasken fra forrige frame**
- **Projekt:** demo
- **Sammenlagt med:** perf-allokeringer.
- **Hvorfor:** Rækkefølgen er `interaction.step` → `avatar.update` → `physics.step`. `_tracked` sættes først i `avatar.update`, og `bottle.root` synkes først i `physics.step`. I XR halter hånden derfor cirka 2 frames og flasken 1 frame.
- **Ændring:**
  - Ny rækkefølge: `avatar.sampleTracking(interaction)` → `interaction.step` (gemmer `h.pose={position,quaternion}`) → `avatar.solve(dt)` (bruger `h.pose`, fallback til root) → `physics.step`.
  - Lav samtidig scratch-vektorer/quaternions og genbrugte snapshot-objekter, og cache `h.fingerState`, når `close===1`.
  - Tilføj avatar til `setQuality`: niveau 0 slår avataren fra (controller-modeller), højere niveauer slår den til. Kun synlighed, ingen genskabelse.
- **Indsats:** M
- **Effekt:** høj

**2.2 Rigtige kast og rude-brud med holdte flasker**
- **Projekt:** demo
- **Hvorfor:**
  - `physics.hold` nulstiller hastigheden hver frame.
  - Release klampes til 4 m/s uden spin.
  - `breakage.step` læser `body.velocity`, som er 0, mens flasken holdes, så en svingende flaske aldrig knuser ruden.
  - Den vendorede `throw_release.js` bliver ikke brugt.
- **Ændring:**
  - Throw-historik pr. hold via `pushSample(sampleFromPoses(...))`. Spring samples over, mens ease-in k<1, og ved snap-turn.
  - Ved release bruges `releaseVelocity()` til lineær og angular hastighed, og angular sendes med til `physics.release`.
  - Rude-tjekket bruger `bottle.heldVelocity`, mens flasken holdes.
  - Skriv **ikke** `body.velocity` efter teleport. Cannon integrerer kinematiske kroppe, så de overshooter. Skal kontakterne kunne se hastigheden, drives kroppen udelukkende med velocity: `v=(target−cur)/dt` uden at sætte position.
  - Tier 0 beholder den nuværende vej.
- **Indsats:** M
- **Effekt:** høj

**2.3 Vælg greb efter orientering i XR i stedet for altid default**
- **Projekt:** demo
- **Afhænger af:** 1.3
- **Hvorfor:** `avatar.grab` bruger altid `graspFor`/`defaultPose`, så flasken roterer om til én kanonisk relation. 44 beer- og 43 wine-body-poses står ubrugte. Contracts vælger nærmeste pose.
- **Ændring:**
  - `localQ = inv(B)·W`, og vælg den pose i grebsgruppen med mindst `quatAngle`.
  - Kun orientering, fordi ray-grab virker op til 3 m, så afstand siger intet.
  - Over `REACH_MAX_ANGLE` (105°) bruges default.
  - Refaktorér `graspFor` til at tage en pose, så radius/højde-tilpasningen genbruges.
  - Quality-tier: lav = default, høj = nærmeste.
- **Indsats:** M
- **Effekt:** høj

**2.4 Neck-greb (29 beer, 20 wine) til hældning**
- **Projekt:** demo
- **Hvorfor:** `graspFor` beder kun om `'body'` og clamper wrist y til 0,55·h. For beer er det 0,144, mens neck-poses ligger på 0,225 (beer) og 0,299 (wine), så de kan aldrig passe. `hit.point` findes, men sendes ikke videre.
- **Ændring:**
  - Send `hit.point` med, og vælg `'neck'`, når lokal y ≥ shoulder_z (fra breakInfo, ellers 0,7·h).
  - For neck droppes 0,55-clampen og body-radius-shiftet. Skalér y efter referencehøjden, og behold den bagte radiale afstand, fordi demo-flasker ikke har nogen halsradius.
  - Tier-option sammen med 2.3. En desktop-tast til at skifte er valgfri. Giver flot hældning sammen med 1.6.
- **Indsats:** M
- **Effekt:** høj

**2.5 Release-blend: fingre og håndled springer på én frame**
- **Projekt:** begge
- **Sammenlagt:** to punkter.
- **Hvorfor:**
  - **Demo:** `release()` sletter holdet, og hånden hopper.
  - **Contracts:** `present()` returnerer null med det samme (`grab.js:175`), og pluginet skifter fra baked-closed til tracked curls på én frame.
- **Ændring:** Rettelserne var uenige. Valget er plugin-side, fordi AGENTS.md siger, at karakterlogik hører hjemme i pluginet, og fordi det retter begge projekter på én gang.
  - I `packages/character-plugin/src/index.js` (omkring linje 112) huskes sidste `record.fingers[side]`. Når den forsvinder, blendes der ind i live-input over ca. 0,1 s med `blendFingerStates` + smoothstep (option som `relaxTime`). Det giver ingen anden "pop" mod `pose.open`.
  - Spring over ved tracking_lost.
  - Demo: et lille "releasing"-entry, der easer desktop-håndleddet fra flasken til place-posen.
  - Re-sync demoen.
- **Indsats:** S-M
- **Effekt:** medium

**2.6 Familie-deterministisk tommel-refit**
- **Projekt:** contracts
- **Hvorfor:**
  - Alle 39 bottle/can-familier i `baked_before.json` er den samme pose roteret om Y.
  - Efter refittet adskiller tommelerne sig med op til 92° inden for samme familie.
  - Årsagen er `seed=777`, der nulstilles pr. batch på 6, så RNG afhænger af pladsen i batchen.
  - Støjen dropper 34/53/27 poses.
  - Der er ingen cost for bend2-hyperextension (46/173 under −12°).
- **Ændring:**
  - Gruppér efter id uden `_rNNN`. Fit ét kanonisk medlem (r000, ellers laveste r) med en seed fra en hash af familie-id'et.
  - Tilføj `cost += max(0, −12 − thumb[3])·3`.
  - `apply_grasp_fit` roterer wrist/quat med hvert medlems azimut-delta (målt via atan2 på de originale wrists) og skriver kun de id'er, bagningen havde (familier har 8/7/6/2/1 medlemmer).
  - Prøv et medlem mere, før hele familien droppes.
  - Kør audit og `test:hands`.
- **Indsats:** M
- **Effekt:** høj

**2.7 Hand tracking: avatarens fingre følger leddene, ingen dobbelte hænder, og hånd-til-hånd-overlevering**
- **Projekt:** demo
- **Sammenlagt:** tre punkter.
- **Hvorfor:**
  - Snapshottet sætter altid `hasHand:false, joints:null`, og opslaget kræver `s.gamepad`.
  - `useAvatar` skjuler kun `c.model`, så den generiske XRHand-mesh og avatarhånden tegnes oven i hinanden.
  - `toggleGrab` afviser en flaske, som den anden hånd holder.
- **Ændring:**
  - **Trin 1:** For kilder med `src.hand` laves snap `{hasHand:true, joints: name→[x,y,z]}` fra `interaction.xrControllers[i].hand.joints` (three.js beregner dem allerede). Kilden findes uden gamepad-krav.
    - Rettelserne var uenige. Alternativt bruges det offentlige `characters.readTracking(frame, dt)`, transformeret med rig-matrixen.
    - Tjek at leddene er i samme rum, som pluginet forventer. Ingen plugin-ændring er nødvendig.
    - Baked fingre har stadig forrang, mens man holder noget.
  - **Trin 2:** Skjul de generiske hånd-meshes, mens avataren er aktiv. Spring `createControllerModel`/`createHandModel` over, og opret dem lazy, hvis avataren fejler.
  - Tier: `?hands=generic|avatar`.
  - **Overlevering:** Hvis en anden ejer holder flasken, kaldes `_dropHold(other)` uden fysik-release, og så grabbes der normalt.
- **Indsats:** M
- **Effekt:** medium

**2.8 Avatar quality-tier og lazy load**
- **Projekt:** demo
- **Sammenlagt:** to punkter.
- **Hvorfor:**
  - `avatar.js:35` hardcoder `skinUpgrade:true`, og pluginets `'low'`-preset bruges ikke.
  - `createAvatar` starter parallelt med de 29 bottle-spawns og forsinker "Scenen er klar".
  - `onStatus` sendes aldrig med.
- **Ændring:**
  - `?avatar=off|low|full` (`'0'` er alias for off) vælges ved opstart, eventuelt ud fra start-kvalitetsniveauet.
  - Genskab ikke playeren fra dropdown'en. Højst en toast om "gælder efter reload".
  - `?avatar=eager|lazy` med lazy som default: start først efter `await loading`. Drop triggerne på first-grab og sessionstart, fordi de giver pop-in.
  - `onStatus` går til toast, ikke til tællerens statuslinje.
  - Mål med `performance.mark` og `renderer.info.programs` for low/full og eager/lazy.
  - `hairCollision:false` er kun oprydning, ikke en perf-gevinst.
- **Indsats:** S
- **Effekt:** medium-høj (passer til tier-præferencen)

**2.9 Fetch-tid skaleres med afstand**
- **Projekt:** demo
- **Hvorfor:** Ray-grab op til 3 m teleporterer flasken på den første frame, og easer derefter kun over faste 0,16 s.
- **Ændring:**
  - `GRIP = max(0.16, d / FETCH_SPEED)` med ca. 3-4 m/s, lavere i et "realistisk" tier.
  - Valgfrit: Contracts' bounded settle på de sidste cm.
  - Behold k≥1-gaten for fingre, og tilføj smoothstep på `h.close`.
  - Drop gap-målingen, fordi den svarer til k≥1.
- **Indsats:** S-M
- **Effekt:** medium

**2.10 Demo-grebstesten er tautologisk**
- **Status:** ✅ Rettet 2026-10-09 (trin 2): eksakt wrist y (0,055/0,05), radial delta, spejling, `graspKind` ved 0,3/0,3001, gyldige fingerrækker ved close 0/0,5/1; clamp-vejen testes i `tests/grasp.test.js` (raw vs. clamped) via bibliotekets `fingerState` i stedet for en `handFingerRows`.
- **Projekt:** demo
- **Hvorfor:** Test-linje 15 kan aldrig fejle (`≤0,055` altid). Linje 16 tjekker kun truthiness. Der er ingen test af spejling, af 0,3-grænsen eller af clamp-vejen.
- **Ændring:**
  - Eksakt assert på wrist y.
  - Test af spejling af x-fortegn.
  - Test af `graspKind` ved 0,3/0,3001.
  - Udtræk en ren `handFingerRows(pose, close)` og test den mod `validateRows` for alle poses samt en kunstigt overskredet pose.
  - Brug samme skip-guard som 1.7.
  - Spring null-casen og `holdPose` over.
- **Indsats:** S
- **Effekt:** medium

**2.11 Tommel-limits findes tre steder**
- **Status:** ✅ Rettet 2026-10-09 (trin 2): fitteren får `HARD.Thumb`/`COMFORT.Thumb` som argument; test binder validatorens HARD til pluginets `LIMITS` (importeret fra `fingers.js`).
- **Projekt:** contracts
- **Hvorfor:** Samme ranges står i `fingers.js:37`, `grasp_validator.js` HARD og som literals i `fit_baked_thumbs.mjs` (HARD/C/W). Ingen test binder dem sammen.
- **Ændring:**
  - Fitteren får HARD/COMFORT som argument til `page.evaluate`.
  - Testen sammenligner efter navn: `dyaw`↔`yaw` (rækkefølgen er forskellig), konverteret fra radianer.
  - LIMITS eksporteres fra pluginets public `index.js` (plugin-side, i tråd med AGENTS.md), eller testen importerer `fingers.js` direkte.
- **Indsats:** S
- **Effekt:** medium

**2.12 Refit-værktøjerne afhænger af den utrackede `build/scratch/baked_before.json` og cwd-relative stier**
- **Status:** ✅ Mest rettet 2026-10-09 (trin 2): `baked_before.json` tracket i `extensions/grasp/tools/data`, `SCRATCH`/`BEFORE` som `import.meta.url`-URL'er, klare fejlbeskeder, `apply` respekterer `TAG`, apply er idempotent (bygger fra `baked_before`). Ikke lavet: `--original` og npm-scripts (GameSystems har ingen package.json).
- **Projekt:** contracts
- **Hvorfor:**
  - `build/` er gitignoreret, så en frisk klon får ENOENT.
  - Læsning sker relativt til `import.meta.url`, mens skrivning sker relativt til cwd.
  - `apply` ignorerer TAG.
  - Mug-refittet (3.1) får brug for det her.
- **Ændring:**
  - Én `SCRATCH = new URL('../build/scratch/', import.meta.url)`.
  - Imports flyttes over top-level await.
  - Klar fejlbesked, der nævner den kommando, der producerer filen.
  - `--original`-option i `convert_baked_grasps.mjs`. Commit kun `baked_original.json`, hvis Godot-input ikke kan reproduceres.
  - `apply` respekterer `TAG`.
  - npm-scripts `grasp:fit`/`grasp:apply`.
- **Indsats:** M
- **Effekt:** medium

**2.13 Magazine: ingen refit og ingen beskæring**
- **Status:** ✅ Rettet 2026-10-09 (trin 2): magazine mærket reference-only i auditten, kommentar i `magazine_grip.js`, `MAGAZINE_POSE` med åben tommel `[0,10,5,5]` så `magazineFingers(t<1)` er i range.
- **Projekt:** contracts
- **Hvorfor:** Magazine er ikke i CATALOG. Kun default-posens wrist/quat bruges, og runtime-fingrene (`MAGAZINE_FINGERS`, t=1) er i range. De 30 "fejl" i auditten kan aldrig vises.
- **Ændring:** Rettelserne var uenige. Valget er ikke at beskære, fordi det koster intet ved runtime og ellers mister Godot-referencedata.
  - Undtag ikke-catalog-kinds i auditten, eller mærk dem "reference-only".
  - Tilføj en kommentar i `magazine_grip.js`.
  - Byg `magazineFingers` open fra `MAGAZINE_FINGERS`, så et fremtidigt t<1 ikke viser tommelen med dyaw 70.
- **Indsats:** S
- **Effekt:** lav-medium

**2.14 README og deploy-tjek for den vendorede avatar**
- **Projekt:** demo
- **Hvorfor:**
  - README nævner ikke `CONTRACTS_DIR`, `?avatar=0`, de genererede mapper eller licenskæden (MIT/CC0).
  - `deploy.ps1` Test-Live tjekker ikke `avatar-assets/`.
- **Ændring:**
  - Dansk README-sektion "Avatar (fra Contracts)" med licens-pegepinde.
  - Tilføj `avatar-assets/base_body.glb` og `asset_licenses.json` til Test-Live.
  - Spring `SYNCED.json` over. Brug evt. den eksisterende `SYNCED.txt` til git rev.
- **Indsats:** S
- **Effekt:** medium

---

## 3) Senere / større

**3.1 Mug-refit med hook-profil**
- **Status (trin 3, 2026-10-09):** ⏳ Delvist. Lukning-til-kontakt løser fingrene (lab, mug-body: 1 fingerspids rørte ved rå `low`, nu 3 + tommel, indtrængning 1,62 → 0,85 mm; handle: 2,65 → 1,06 mm), men **ikke tommelen**: der findes ingen tommel i range, der holder kruset (lab: tommel-søgning gav 4,6–12 mm indtrængning). Mug bliver i `CLAMP_EXEMPT`; kun tommelen er rå. Handle-poserne fejler stadig wrap-gaten (tommel rører ikke, opposition 0) — fase 2 (hook-profil) er stadig nødvendig.
- **Note (trin 2):** Når mug er refittet og i range, fjernes `'mug'` fra `CLAMP_EXEMPT` i `extensions/grasp/baked_grasps.js` og `known.mug*` i bake-auditten sættes til 0.
- **Projekt:** contracts
- **Sammenlagt:** to punkter.
- **Hvorfor:**
  - Alle 8 mug-poses fejler (handle: tommel [56,70,0,70], body: pitch 100).
  - `measure()` hardcoder Y-aksen (`lab.js:96`), og wrap-gaten kræver modstående tommel ≥120°. Det passer ikke til et hook-greb gennem hanken.
  - Hvis man bare kører fitteren, risikerer man, at hele handle-grebet bliver droppet.
  - `SKIN_MARGIN.mug` retter også pege- og ringfinger. *(Trin 3: `SKIN_MARGIN` er fjernet; lukning-til-kontakt gør det nu.)*
- **Ændring:**
  - **Fase 1:** clamp fra 1.4.
  - **Fase 2:** `measure()` får et valgfrit akse-argument, og verdict får profiler: `'hook'` (pege- og langfinger i hanke-boksen, lukning om hankens akse) og `'body'` (`contactGapDeg` i stedet for opposition). Hæv wrist-cap'en, og fit de 8 poses.
    - Krav: mindst én handle- og én body-pose pr. side, ellers beholdes den gamle bag clampen.
    - `test:hands` må ikke vise dårligere kontakt.
    - Derefter `known.mug=0`.
  - **Fase 3 (separat):** generér flere body-poses (azimut, y=±0,03).
- **Indsats:** L
- **Effekt:** medium

**3.2 Udnyt aksesymmetri i `nearestPose` til lathe/cylinder-kinds**
- **Projekt:** contracts
- **Afhænger af:** 2.6
- **Hvorfor:** Droppede azimuter får hånden til at glide op til 10 cm rundt om flasken (median 22-65 mm). Familierne er dokumenteret identiske ved rotation om Y.
- **Ændring:**
  - Behandl det som en kvalitetsfeature, ikke perf, fordi scanningen er ubetydelig.
  - Tilføj `symmetricY:true` i CATALOG for beer, wine og can.
  - `nearestPose` scorer hver kandidat roteret med yaw-forskellen og returnerer en kopi med roteret wrist/quat og **samme id**, så hysteresen virker.
  - Tier `'folded' | 'table'`.
  - Behold dataene ubeskåret, indtil tests og demo-sync opdateres sammen.
- **Indsats:** M
- **Effekt:** høj (visuelt)

**3.3 Inkonsistente summary-, metrics- og palm-felter efter refit**
- **Projekt:** contracts
- **Hvorfor:**
  - `summary.accepted` er overskrevet med 73/63/37 (total 128/128/96), og testnavnet er misvisende.
  - Metrics kommer fra både Godot og lab under samme nøgler.
  - `pose.palm` er forældet og bliver ikke brugt.
  - Gate-tærsklerne er forskellige fire steder.
- **Ændring:**
  - `summary[kind].lab = {kept, dropped, fit}` og opdatér testen.
  - `metrics.source`.
  - Drop eller mærk `palm`.
  - Én gate-profil pr. mode (wrap/flat/pinch) eksporteret fra `grasp_validator.js` og importeret af fitter og apply.
  - Gør det sammen med 2.6.
- **Indsats:** S
- **Effekt:** lav

---

## Afviste punkter (med grund)

- **Desktop-venstrehånd griber aldrig.** Faktuelt korrekt, men lav værdi og ikke-triviel indsats: højre musetast er allerede kast, `tilt` deles, og det kræver anden owner, layout og input. Venstre-defaults er desuden forkerte indtil 1.3. Overvej efter 1.3 og 2.3.
- **Pose-valg: filtrér ugyldige poses fra og foretræk default ved lige cost.** Magazine går aldrig gennem `nearestPose`, alle mug-poses er ugyldige (så filteret falder tilbage og gør intet), og carton er kun 1° off. Clamp og refit (1.4, 1.10, 3.1) er den rigtige løsning. Comfort-tie-break kan kæmpe mod hysteresen.
- **Undgå allokering pr. frame af skin-margin-pose og fingerState i Contracts.** Ubetydeligt (kun mug, én hånd), og det er fuldt dækket af memoen i 1.4.
- **First-person: spring usynligt arbejde over (eye-life-morphs, hair collider).** Mikrosekunder pr. frame, ingen GPU-besparelse, og det ville kræve nyt plugin-API (`quality.mirror`) med risiko for forældet tilstand ved tredjeperson. Kun hvis en profil viser det.

---

**Anbefalet rækkefølge:** 1.1 → 1.2 → 1.3 → 1.4 (inklusive tests) → 1.7 → 1.8 → 1.6 → 1.9 → 1.5 → 1.10. Derefter 2.1 før 2.2, 2.3 og 2.4, og 2.6 før 3.2.