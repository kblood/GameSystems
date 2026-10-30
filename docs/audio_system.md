# Lydsystem (extension `audio`)

Materialelyde, kontaktstyrke og rumlig lyd. Opt-in: intet i et spil ændres før det loader extensionen
(demoen: `?audio`). Kode: `extensions/audio/`. Lydfiler: `audio/ogg/` (katalog i `audio/catalog.json`).

## Arkitektur

```
spil / bottles / grab  ->  audio.contact() / play() / startLoop() / grab() / footstep()
                                |
   sound_materials.json  ->  system.js: voice-pool + buffer-cache + rate-limit + prioritet
                                |   (AudioContext: source -> [lowpass] -> gain -> [panner] -> master -> [kompressor] -> out)
   acoustics.path(rum, lytterrum) -> tab i dB -> gain + lowpass (kun high har filter)
```

- `system.js` `createAudioSystem(options)`: selve motoren. Ren JS uden three.js og DOM; AudioContext gives ind
  (`context` / `createContext`) eller oprettes lazily af `globalThis.AudioContext`. Uden AudioContext (node, worker) er alt
  tavst og kaster ikke.
- `index.js`: host-extension (`host.load(audioExtension, options)`). Lytteren følger `ctx.camera.matrixWorld` hver frame
  (hoved/XR-kamera). Lytter på `grab`/`release` (hånd-lyd ved flasken), `audio:play`, `audio:contact` og `xrStart`
  (genoptager AudioContext). `installUnlock` genoptager ved første brugerhandling (pointerdown/keydown/touchend/click).
- `bottle_adapter.js` `createBottleAudioAdapter(audio, { volume, defaultVolume, position })` giver `{ play(key, minGapMs, at?) }`
  til bottles-extensionens `audio`-option, med position (se "Spil-kobling"). `BottleAudio` er uændret og virker som før.
- `footsteps.js` `createFootstepTracker(audio, { stride: 0.7, gain, surfaceAt, floorY })`: fodtrin efter gået afstand.
- `creaks.js` `createCreakTrigger(audio, opts)`: knirk fra `mechanics:changed` (indkoblet af index.js).
- `sound_materials.json`: alle data (materialer, ting->materiale, styrkegrænser, akustik, navne, prioriteter). Rediger her.

### Ingen allokering i hot path
Stemmerne (gain, evt. biquad og panner) oprettes lazily op til tierens loft og genbruges. `play`/`contact` bruger kun skalar
matematik, forudslåede opslag (materiale -> lydposter) og `Map`s der ikke vokser efter opvarmning. Det eneste der oprettes pr.
lyd er `AudioBufferSourceNode` (Web Audio kan ikke genbruge dem) og options-objektet kalderen sender. `chooseContact(.., out)`
og `lastContact` genbruger ét objekt. Buffere dekodes én gang (`preload`), afspilning af en ikke-indlæst lyd springes over
(køes ikke) og starter indlæsning til næste gang.

## Tiers (`AUDIO_QUALITY`, host-niveau 0..3 -> off/low/mid/high)

| tier | stemmer | panning | filter | øvrigt |
|---|---|---|---|---|
| `off` | 0 | - | - | tavs, opretter ingen AudioContext, `update` kaldes ikke af hosten |
| `low` | 16 | ingen (kun afstandsgain) | nej | ét lag pr. kontakt, ingen kompressor |
| `mid` | 32 | `StereoPannerNode` (pan fra lytterens højre-vektor) | nej | kompressor på master |
| `high` | 48 | `PannerNode` HRTF, inverse afstand (ref 1 m, max 40 m) | lowpass pr. stemme (akustik-dæmpning) | andet materiale lægges som svagt lag |

`setQuality(tier)` stopper alle stemmer og bygger puljen om. Når puljen er fuld stjæles stemmen med lavest prioritet
(ældst ved lighed) med 12 ms udtoning; er alt kørende mere vigtigt end den nye lyd, droppes den nye (`stats().culled`).

## API

```js
const audio = await host.load(audioExtension, { assetURL, preload: ['contacts','hand','bottles'], acoustics, unlock: true });
audio.play('glass_shatter_large' | 'shatter' | ..., { position, gain, rate, variantSeed, priority, minGap /*s*/, sourceId, room });
audio.contact({ material1, material2, speed /*m/s*/, normal, position, sourceId, room, variantSeed, gain });
audio.startLoop('slide_loop_wood', { position, gain, rate }) -> handle;  audio.updateLoop(handle, { position, gain, rate });  audio.stopLoop(handle, fade);
audio.grab({ position }); audio.release({ position }); audio.footstep({ surface: 'wood', position, speed });
audio.setListener(x,y,z, fx,fy,fz, ux,uy,uz) | listenerFromMatrix(m.elements);  audio.setListenerRoom('bar');  // kørende loops opdateres
audio.delayBySpeed = true;   // option ved oprettelse: { delayBySpeed, speedOfSound: 343, maxDelay: 0.25, sharedContext: () => ctx }
audio.preload(['contacts', 'footsteps', 'all', 'cork_pop']) -> Promise<antal>;  audio.resume();  audio.setQuality(tier);
audio.chooseContact(m1, m2, speed, out) ; audio.materialOf('mug') ; audio.stats() ; audio.dispose();
```
Positioner er `[x,y,z]` eller `{x,y,z}` (også three `Vector3`). Uden position lyder lyden ved lytteren. Via hosten:
`host.emit('audio:contact', {...})` og `host.emit('audio:play', { key, ... })` uden at kende api'et.

### Kontaktvalg
1. Navne slås op: materiale (`wood`), ting (`mug` -> `ceramic`, via `things`) eller ukendt -> `defaultMaterial` (`concrete`).
2. Parret: et dæmpende materiale (`damp` > 0: stof 2, pap 1) sluger den andres ring og vinder; ellers vinder højest `rank`
   (metal 9 > glas 8 > keramik 7 > plast 5 > træ 4 > beton 3). Den anden lægges som lag (gain 0,45, ét styrketrin lavere) på `high`.
3. Styrke fra `speed`: under `minSpeed` 0,25 m/s ingen lyd; let < 1,2; medium < 3,5; ellers hård. Inden for båndet
   interpoleres gain 0,55-1 og tonehøjde 1,10-0,90 (let = lidt højere) plus ±4 % tilfældig tonehøjde.
4. Variant: `variantSeed` giver deterministisk valg, ellers tilfældig uden umiddelbar gentagelse.
5. Rate-limit: pr. lyd (`gap`, kontakter 40 ms) og pr. kilde (`sourceId`, 30 ms); BottleAudios `minGapMs` videregives som `minGap`.
`normal` gemmes ikke og påvirker ikke valget (bevidst ikke brugt endnu: `speed` er allerede slaghastigheden langs normalen i demoen/Contracts).

### Akustik
`acoustics` (api eller `() => api`; extensionen bruger `ctx.get('acoustics')`) + `setListenerRoom(rum)` + `room` på lyden:
er rummene forskellige bruges `acoustics.path(rum, lytterrum).lossDb` (cachet 0,25 s). Gain gange `10^(-dB/20)`; på `high`
sættes lowpass til `18000 * 10^(-dB/25)` (min 350 Hz). Intet spor, eller tab over 60 dB, betyder at lyden ikke afspilles.
Åben dør (2 dB) giver næsten ingen dæmpning, lukket (35 dB) mumlen.

**Loops følger lytterrummet.** `setListenerRoom(rum)` rydder rum-cachen og opdaterer straks alle kørende loops (med `room`):
gain (`gain * 10^(-dB/20) * afstand`) og, på high, lowpass. `step(dt)` tjekker desuden hvert 0,25 s om akustik-stien er ændret
(en dør åbnes), og `updateLoop` bevarer dæmpningen. Uden sti (eller over 60 dB) kører loopet videre, men lydløst (gain 0), og bliver
hørbart igen når stien findes. Loops uden `room` er upåvirkede.

**Forsinkelse efter afstand (`delayBySpeed`, standard fra).** Slået til starter en enkeltlyd med position `afstand / 343 m/s`
senere, højst `maxDelay` 0,25 s (ved max-afstanden 40 m er det 0,12 s, så loftet bruges kun med en langsommere `speedOfSound`).
Kun lyde med position; loops og lyde uden position forsinkes ikke. Kan skiftes live: `audio.delayBySpeed = true`.
Contracts: `?audio=delay`.

## Lydkatalog (160 nye filer, 271 i alt, 3,0 MB)

| lyd | var. | indhold |
|---|---|---|
| `contact_<materiale>_<light\|medium\|hard>` | 5 | træ, metal, beton, keramik (krus), pap, plast (hård), stof/læder. Hård har 1-2 efterklang for stive materialer. 0,15-1,0 s |
| `hand_grab`, `hand_release` | 5+5 | hud-klap + stof-raslen / let raslen |
| `cardboard_fold` | 4 | pap/papir foldes |
| `slide_loop_hard`, `slide_loop_wood`, `slide_loop_soft` | 3 hver | skrab/slide-loops (2 s, sømløse; stick-slip) |
| `footstep_concrete`, `_wood`, `_metal`, `_grass` | 6 hver | hæl + tå, 0,3-0,4 s |
| `door_hinge_creak`, `drawer_creak` | 4+4 | knirk 0,7-1,3 s |
| glas/flaske/væske/skud | 111 | uændret (se `audio/README.md`); glas bruger `glass_clink_soft/hard` og `glass_impact_thud` som kontaktsæt |

Kvalitet (`audio/metrics.json`): ingen NaN, ingen klipning; toppe efter styrke -14 / -9 / -4 dBFS (let/medium/hård), loops
`loop_disc` 0,34-0,64 (<= 1: sømmen er ikke større end et normalt sampletrin). De 111 gamle filer er uændrede (samme metrics).
Syntese: `audio/synth_materials.py` (importeres af `synth_all.py`, samme `@sound`-register og stil som `synth_sounds.py`).

## Sådan tilføjer du ...
- **Et materiale**: skriv en opskrift i `MATERIALS` i `audio/synth_materials.py` (eller en ny `@sound`-funktion), kør
  `python audio/synth_all.py --no-preview`, tilføj lydene til `sounds` i `extensions/audio/sound_materials.json` (variants skal
  passe med `catalog.json`, testen fanger forskelle), tilføj posten i `materials` (`contact`: præfiks eller `{light,medium,hard}`,
  `rank`, `damp`) og de ting der hører til i `things`.
- **En lyd**: `@sound(navn, antal, peak_db, loop=..)` i synth-scriptet, kør scriptet, tilføj til `sounds` (+ evt. `groups`,
  `aliases`, `footsteps`, `events`). `copy-assets.mjs` kopierer grupperne `contacts`, `hand`, `bottles` til builden.
- **En ting -> materiale**: ret `things` (JSON). Spillet kan også give materialenavnet direkte.
- Synk til Godot: `powershell -File audio/sync_godot_audio.ps1 [projekt]` (standard `tests/godot_audio`; kopierer wav + catalog).
  Ind i NightfallContractsGodot kun ved at give projektstien eksplicit; det blev ikke gjort.

## Spil-kobling (alt opt-in; uden `?audio` ændres intet)

- **Flaskers position.** bottles kalder `audio.play(key, minGapMs)` uden position (breakage/pour/factory; ikke rørt, og intet i
  `bottles/pour*`, `bottle_liquid*`, `liquid_*` er ændret). Adapteren finder selv en position: 3. argument, ellers `focus`
  (`adapter.withFocus(flaske, () => ...)`), ellers `position(key)`-optionen, ellers den holdte flaske (`adapter.bind(host)` følger
  `grab`/`release`; spil med egne events bruger `hold(flaske)`/`drop(flaske)`). Hæld og prop kommer dermed fra flasken i hånden.
  Uden noget af det sidder lyden på lytteren som før. Demoen ombryder `factory.onImpact` med `withFocus`, så klink/brud lyder ved
  den flaske der blev ramt. En udvidelse af bottles er ikke nødvendig; adapteren tager imod positionen som 3. argument, hvis
  bottles en dag sender den.
- **Fodtrin.** `createFootstepTracker(audio, { surfaceAt })` får hovedets position hver frame (`update(pos, dt)`): et trin pr. 0,7 m
  vandret, placeret ved gulvet (y = 0) skiftevis lidt til hver side, gain 0,35-0,4, hastigheden styrer styrken. Ingen trin ved
  stilstand/drift (< 0,15 m/s) eller teleport/hurtigt hop (> 6 m/s). Materiale: `surfaceAt(x, z)` (demoen: stråle mod
  `physics.surfaces`, tagget `surface`; Contracts: `world.surfaceAt`, som er beton), ellers beton.
- **Knirk.** Audio-extensionen lytter på `mechanics:changed` (extensions/mechanics): hængsel -> `door_hinge_creak`, slider ->
  `drawer_creak`, kun mens `|velocity|` er over 0,25 rad/s (hængsel) / 0,08 m/s (slider), højst hvert 0,6 s pr. mekanisme, højere
  og lysere jo hurtigere; aldrig loop. `{ creaks: false }` slår det fra. Hverken demoens hovedside eller Contracts har døre/skuffer;
  kun `fire-lab.html` har en hængslet dør, og den loader ikke audio (ingen kobling endnu).
- **Pap-fold.** Contracts: grib af kartonen (`grasp` med `kind: 'carton'`) giver `cardboard_fold` oven i hånd-lyden. Demoen har ingen
  karton. **Slide-loops** har API (`startLoop`/`updateLoop`) men ingen udløser: kontakt-eventet har ingen tangentiel hastighed.

## Demo (`webxr-demo`)
`?audio` loader extensionen før bottles og giver bottles `createBottleAudioAdapter(audio)` som `audio`-option (samme nøgler og
volumener som BottleAudio, men puljet, med varianter). `main.js` ombryder `factory.onImpact`: efter breakage-systemet kaldes
`audio.contact` med flaskens materiale (glas/plast/keramik), overfladen den ramte og slaghastigheden (bortset fra en flaske der
lige er knust). Grib/slip giver hånd-lyd via `grab`/`release`-eventene; en tabt pistol giver metal-kontakt. `window.__audio`
er api'et til fejlsøgning. Bottles-adapteren får flaskens position (se ovenfor), og hovedets gang giver fodtrin
(`window.__demo.footsteps`). Uden `?audio` er adfærden uændret.

## Contracts (`?audio`)
`audio` er en synkroniseret extension i Contracts (`tools/sync_extensions.mjs`: `EXTENSIONS` + `AUDIO_GROUPS`, som kopierer alle
varianter af grupperne contacts/hand/footsteps/creaks/bottles til `assets/gamesystems/audio/ogg`; GameSystems' `contracts-sync`-test
dækker extensionen og lydfilerne). `src/main.js` importerer `src/game/audio.js` dynamisk, kun med `?audio` (ellers hverken import
eller download af lydene). Spillets egen `AudioContext` (rekvisitbordets, `props.audioContext`) lånes via `sharedContext`: systemet
opretter, lukker eller erstatter den aldrig, og våben-/soundscape-lyden (`weapons/audio.js`, `game/soundscape.js`) er urørt.
Koblet: flaskerne (`audio`-option = adapteren, slag -> materiale-kontakt ved flasken), hånd-lyd og pap-fold ved grib/slip (grab-eventene),
fodtrin (kun mens missionen er aktiv og ikke på pause) og lytter fra kameraet. Kvalitet: spillets `?quality` 0..3 -> lydtier
low/low/mid/high (aldrig off). `?audio=delay` slår forsinkelse efter afstand til. Contracts har ingen døre/skuffer.

## Tests
`webxr-demo/tests/audio-game.test.js` (8 tests): fodtrin-tæller (afstand, materiale, gain, ingen trin ved stilstand/teleport),
rumskift for loops (lukket/åben dør, ingen sti, loop uden rum), `delayBySpeed` (standard fra, 343 m/s, loft, loops/uden position),
adapter med position (argument, focus, holdt flaske, `position`-option), knirk (hængsel/slider, tærskel, gap, mechanics-event,
`creaks: false`), lånt AudioContext. Contracts: `tests/game-audio.test.mjs` (5 tests: opt-in, fodtrin, hånd/karton, flaskeslag,
lånt context). Hub-testene `demo-lyd` og `contracts-lyd` (`tools/headset-lab/hub/tests.js`) er lyttetrin i headsettet.

`webxr-demo/tests/audio.test.js` (17 tests, fake AudioContext i `tests/fake-audio.js`): data mod `catalog.json` og filer på disk,
stemmeloft pr. tier og panner-type, tierskift, prioritet/stjæl/drop og nodegenbrug, rate-limit, materialepar og styrke,
varianter, ikke-indlæst/suspenderet/fejl ved indlæsning, cache, rumlig lyd (HRTF-position, stereopan, afstand), akustik
(lukket/åben dør, intet spor, ingen filter under high), loops, dispose, ingen AudioContext, bottle-adapter, extension i hosten,
unlock. Grænsetesten kender `audio` (kun afhængig af `host`, ren uden three).

## Kendte mangler
- Ikke afprøvet i headset: HRTF/rumlig kvalitet og pris på Quest, `AudioContext`-unlock på Quest-browseren (vi genoptager på
  første gesture og `xrStart`, men det er ikke set virke på enheden), antal samtidige stemmer vs. CPU, lyd i VR-sessionen.
- Desktop-Chrome (headless) er set: 199 buffere dekodet, kontakt/grab afspillet, ingen konsolfejl. Selve lyden er ikke aflyttet;
  lydene er syntetiske og bør høres og finpudses (særligt stof, plast, hængsel/skuffe).
- Bottles sender stadig ingen position til `audio.play`; adapteren løser det (focus / holdt flaske). Breakage-lyde uden for et
  flaskeslag (skud på rude) og flasker der hverken holdes eller er ramt ligger på lytteren.
- Ingen efterklang/rumklang, `normal` bruges ikke, kun én lytter. Skrab/slide udløses ikke af physics (ingen tangentiel hastighed i
  kontakt-eventet). Ingen døre/skuffer i demoens hovedside eller Contracts, så knirk er kun koblet til `mechanics:changed`.
  Kontaktlyde for krus/dåse/karton i Contracts mangler (solveren sender ikke kontakt-events for dem); kun flasker har dem.
- Ikke hørt i headset: fodtrin-gain 0,35-0,4, forsinkelse (`?audio=delay`), retning af flaskelyde, Quest-pris med lyd.
- `things`-tabellen er et første bud; materialer i `extensions/materials` (wood/metal/concrete/fabric) matcher navnene, men
  systemerne er ikke koblet (surface-materialet kan gives direkte som `material2`).

## Pending load/disposal audit — source review 2026-10-26

A pending fetch previously dereferenced ctx after dispose had cleared it, then recorded a failed sample and emitted audio:error on the retired owner. Load now captures its decoding context and checks terminal liveness before starting fetch, consuming a native response body, decoding, publishing samples or reporting load failure. Already-running custom fetch/decode work is allowed to settle silently; no cancellation contract is imposed on caller fetchBuffer or shared AudioContext. Promise cleanup only removes its own pending entry. Successful late decodes were already excluded from the cache and never started playback; that behavior is preserved.

Dispose marks the owner retired before voice teardown, clears failed samples as well as caches, and leaves caller/shared contexts open. Preload resolves zero if its owner retired before completion. Pending resume completion now returns false after disposal rather than dereferencing the cleared context. Normal live fetch/decode errors still increment loadErrors and emit the existing error event. There is no reset API: stopAll and quality changes deliberately retain reusable sample caches and pending loads; no generation reset was added to those operations.

Canonical source was synced to advanced Nightfall Contracts using the selected audio extension workflow. Baseline has no import of this audio system. Static source review and targeted diff check only; no tests or gameplay/runtime imports. In-flight network/decode allocation may persist until the browser or custom provider settles; this change prevents retired publication and callbacks, not guaranteed immediate cancellation.

## Explicit failed-sample retry — source review 2026-10-26

retryFailedSamples() snapshots failed sample IDs (the same IDs that resolve the sample URLs), deduplicates aliases and returns one shared in-flight promise. It retries only that snapshot, waiting for any previous failed load cleanup first. Failed flags remain until successful decode/cache publication; normal preload/play cannot start automatic retries. Successful buffers, voices, rate limits, quality and the shared context are untouched. The returned {attempted,recovered,remaining,disposed} is an outcome snapshot; failedSampleCount exposes the current failure count for callers that must include other loads failing during retry. No failure-ID/URL list is exposed.

The retry batch waits for every job to settle, including exceptional custom-provider cases, before releasing its single-flight slot. Disposal suppresses late results through the existing live-owner guards. No public reset, timer, automatic retry or new context/resume policy was added. Static source review/diff check only, no tests/runtime. Selected advanced audio sync only.

## 2026-10-27 - Protect the primary contact voice from its own layer (static only)

- The canonical allocator already reclaims expired voices and selects an idle voice before growing or stealing. At full capacity it chooses the lowest priority, then oldest start, and refuses to steal a higher-priority voice. No idle-first correction was needed.
- Confirmed a separate high-quality layering defect: a light metal/concrete contact has two priority-0.3 sounds. If all other voices have higher priority, its optional secondary layer could immediately steal the primary just allocated by that same contact call (including its scheduled fade-in). The internal allocation now excludes that primary from the secondary layer's stealing candidates. Idle capacity and other eligible victims remain available; if none exists, only the optional layer is culled.
- Public APIs, pool limits, positional routing, gain/mute, delay/pause cancellation, sample retry/disposal and gameplay are unchanged. Advanced WebXR uses the canonical high tier at quality 3; low/mid have no secondary layer. The maintained audio extension is synced through the selected project workflow; no baseline/native change is required.
- Static source review and targeted git diff --check only. No tests, runtime/import checks or listening checks; audible behavior under saturation remains unverified.

## 2026-10-27 - Break versus contact voice priority audit (static only)

- No contact-versus-break priority defect was found in shipped canonical data or advanced host wiring. Bottle/pane breakage requests smallShatter/shatter, resolved to glass_shatter_small/large at priority 1.0. Material contacts are priority 0.3/0.5/0.8, with glass clink/thud at 0.5. The secondary layer uses a lower strength level, and neither the advanced contact host nor bottle adapter overrides these priorities.
- The allocator first reclaims expired/idle capacity, then chooses the lowest-priority active voice (oldest for ties) and permits stealing only when victim.priority <= incoming.priority. Thus ordinary contacts/layers cannot steal active priority-1.0 break tails, while a loaded/admissible break can replace ordinary contact capacity. The previous same-contact primary protection remains intact. Advanced skips its post-impact material contact when the bottle has broken.
- No runtime/canonical/sync change was justified. Equal-priority non-contact cues or another break may still replace a break under the general policy; this audit does not claim absolute break reservation. Rate limits, missing samples, distance/room culling and suspended context may also prevent playback independently of pool priority.
- Source inspection and targeted git diff --check only; no tests/imports/runtime or listening checks. Positional routing, mute/pause cancellation, sample ownership and physics remain unchanged.

## 2026-10-27 - Single pane-shot damage/break audio owner (static only)

- Confirmed a canonical duplicate in BreakageSystem.shoot: breakPane already requests glassHit for chip/cracked/punched or smallShatter/shatter for shattered, but shoot then unconditionally requested glassHit again. On shattered panes that produced a separate nonbreaking impact cue after the break sound; duplicate same-key calls on lesser damage could be hidden by adapter rate limiting rather than correct event ownership.
- shoot now leaves those four outcomes' audio to breakPane, retaining its previous projectile-only glassHit fallback for other results. Nonbreaking material hits, penetration/remaining energy, assessment, AI/host events, geometry, break timing and positional adapter context are unchanged. Physical bottle-versus-pane contacts still use breakPane directly; a simultaneous bottle and pane break is two physical breaks, not deduplicated.
- Changed canonical GameSystems/extensions/bottles/breakage.js and synced only the maintained bottles extension/manifest through the project tool. Advanced's current prop bullet hook uses bottle shatter rather than the full canonical pane shoot route, so this is a corrected shared path, not a claim that current contract panes exercised the bug.
- Static source review and targeted git diff --check only; no tests/imports/runtime/listening checks. No priority, gain, mute, pause or sample policy change.

## 2026-10-27 - Bottle-shot break sound uses the captured hit point (static only)

- Confirmed current advanced path: shatterBody passes the world-space shot point to api.shatter, which directly invokes canonical breakBottle without factory.onImpact's audio focus wrapper. breakBottle captured hitPoint, then removed the bottle before requesting positionless smallShatter. The spatial adapter could therefore use another held bottle or the listener as origin.
- Canonical breakBottle now supplies its existing captured hitPoint as the optional third audio.play argument. The adapter already prioritizes this argument over transient focus/held fallback. Omitted minGap remains undefined so each player's existing default is preserved; standalone BottleAudio ignores the extra spatial argument. Breaks without a supplied impact point use the already-captured bottle position.
- No change to cue, gain/priority, break timing, physical impulse, liquid accounting or resource ownership. The local Vector3 survives synchronous removal/ownership callbacks and is consumed immediately by the audio system. Canonical bottles and the audio-adapter contract comment were synced through the selected extension workflow.
- Static source review and targeted git diff --check only; no tests/imports/runtime/spatial listening checks. Splash and other non-break cues retain their existing positioning contracts and are not claimed fixed by this change.

## 2026-10-27 - Direct-shot splash audio audit: no emitted cue (static only)

- Corrected the prior follow-up assumption: breakBottle calls pour.splash before its smallShatter cue, but splash is a liquid simulation method, not an audio event. It emits bounded droplet flights at the supplied hitPoint. Neither splash nor land requests audio, and the advanced audio host does not convert onDeposit into splash sound.
- A splash/liquid_splash asset alias exists, but no production call in this direct-shot chain plays it. Consequently there is no separate splash cue falling back to the listener/held bottle, and no justified spatial-audio code or sync change. The preceding smallShatter hit-point fix remains valid and independent.
- No new sound, volume, priority, liquid accounting or physics behavior added. This audit does not claim splash audio is implemented. Source inspection and targeted git diff --check only; no tests/imports/runtime/listening checks.

## 2026-10-27 - Pour/leak audio uses its actual outlet (static only)

- Confirmed spatial mismatch: _drain processes every live bottle's rim overflow and leak-hole requests, including free bottles, but requested positionless pour audio. The optional spatial adapter could consequently choose another held bottle or the listener. The previous adapter comment incorrectly assumed pouring only occurred while held.
- Each admitted pour cue now supplies the existing request's r.point (world-space rim outlet or leak outlet) as the optional third play argument. This is the same current point used for liquid emission/stream rendering, not an inferred held-body pose. The spatial adapter already gives explicit positions priority; standalone HTML audio ignores the extra argument.
- The existing 650 ms per-bottle check, 300 ms global key gap, selected request order, gain, sound variant, priority and mute remain unchanged. This corrects the location of admitted cues; it does not promise separate simultaneous audio for every draining bottle or alter rate-limit fairness. No liquid accounting, physics, timing or new cue added.
- Canonical pour.js and adapter contract comments synced through selected bottles/audio workflow. Source inspection and targeted git diff --check only; no tests/imports/runtime/listening checks.

## 2026-10-27 - Fair bounded pour audio attempts (static only)

- Confirmed starvation: simultaneous bottles updated lastPour even when the shared pour key rejected playback inside its 300 ms gap. On the next 650 ms eligibility window, fixed iteration order favored the same first bottle again.
- Positive outflow now contributes one current outlet per bottle to a step-local candidate map. After liquid substeps, the least recently attempted eligible live bottle receives one audio attempt, at most once per 300 ms across this pour system. Existing per-bottle >650 ms accepted-attempt cooldown remains. Ties retain stable source order, then rotate through weakly held attempt timestamps. Removed/broken bottles are excluded; inactive outlets are not retained or replayed.
- An explicit false return (as supplied by advanced canonical audio for rate limit, missing sample, culling or suspension) does not spend lastPour. Its turn still rotates, preventing a rejected source from starving others. Legacy void mixers retain accepted-attempt semantics: this is not a promise that asynchronous HTML audio actually played. No new AudioContext or sample handling. clear resets scheduling metadata; weak keys do not retain removed bottles.
- Liquid integration, amounts, physics, sample/gain/priority, positional outlet and mute are unchanged. Audio admission moves to the end of the same liquid substeps; no timer queue/catch-up or extra cues. Existing global mixer rate limiting remains in force. Canonical bottles synced through selected workflow.
- Static source review and targeted git diff --check only; no tests/imports/runtime/listening checks. Fairness means each continuously eligible source gets bounded attempts, not guaranteed audibility under culling or unavailable audio.

## 2026-10-27 - Standalone bottle audio reports synchronous admission (static only)

- BottleAudio.play previously returned undefined for both rejection and a dispatched HTMLAudioElement play request. The pour scheduler's legacy-void compatibility therefore spent the per-bottle cooldown even for missing Audio/unknown keys or a rejected key gap.
- play now returns false for those synchronous rejection paths and synchronous construction/volume/play exceptions, and true only after dispatching play and attaching its rejection handler. The key cooldown is committed only for an admitted request. Later autoplay/network rejection remains silently handled and does not retroactively rewrite admission or trigger retry; true is not proof of audible playback.
- Standalone BottleAudio has no WebAudio context, master mute API, disposal state or bounded voice pool to query. Zero configured gain still represents admitted silent playback. No new lifecycle/capacity/mute policy is invented. Advanced's borrowed-context audio adapter already returns its own boolean and is unchanged; callers ignoring the result remain compatible. The pour scheduler still treats third-party legacy void returns as accepted attempts.
- Canonical bottles audio.js synced through the selected workflow. Source inspection and targeted git diff --check only; no tests/imports/runtime/browser playback checks. Async audibility remains unverified by design.

## 2026-10-27 - Owned standalone media cleanup on bottle reset/disposal (static only)

- Confirmed ownership gap: standalone BottleAudio created HTMLAudioElements without retaining them, so bottle-system reset/disposal could not stop old-scene playback or pending media requests. It now tracks its own players; ended/error/play-promise rejection retires only that element. Retirement removes handlers, pauses, removes src and calls load to abandon pending media activity. Repeated or late callbacks are idempotent through set membership.
- reset retires current owned players and clears key cooldowns; dispose also permanently rejects new admission. The bottle system calls these methods only when it created the default BottleAudio itself. Caller-supplied/custom/advanced shared audio is neither reset nor disposed. Reset remains reusable; a late old promise cannot touch a new element. Active standalone tails are intentionally stopped on world reset/disposal, not ordinary gameplay pause.
- Also confirmed a synchronous stale-cue path: onBroken can reset/dispose before breakBottle reaches its sound. The existing break generation check now also precedes the cue after removal, preventing that retired operation from creating new playback after cleanup. The later post-audio generation check remains for reentrant custom mixers. Normal break timing and material/physics behavior are unchanged.
- Admission stays synchronous: true only means a play request was issued; later browser rejection cleans ownership without claiming success or retrying. There is still no standalone master mute/voice cap. Selected canonical bottles sync completed; source inspection and targeted git diff --check only, no tests/imports/runtime/browser playback checks. Broader reentrant callbacks in other bottle producers were not claimed audited.

## 2026-10-27 - Bounded standalone bottle media capacity (static only)

- Confirmed that key rate limits bounded request frequency but not outstanding HTMLAudioElements: repeated admitted requests could accumulate while media/play promises remained pending. Standalone BottleAudio now caps owned active/pending elements at eight. This is a conservative fixed standalone budget, not a measured device optimum.
- Already-ended elements are retired before capacity decisions. Pending/paused elements still occupy a slot. Ordinary contact/pour/cap cues return false at capacity without spending cooldown. Only shatter/smallShatter (actual break keys) may replace the oldest nonbreak element; an all-break pool rejects new requests, preserving active break tails. No idle element is stolen and no second pool or queue exists.
- Existing ended/error/rejection cleanup, synchronous admission bool, reset/dispose and late-callback idempotence remain. Weak per-element cue metadata does not retain retired elements. Priority does not change sound/gain/rate-limit defaults. Caller-supplied audio and advanced's separate WebAudio pool are unchanged. Stealing stops the selected ordinary tail immediately; asynchronous failure of the new request cannot restore it.
- Canonical bottles synced through selected workflow. Source inspection and targeted git diff --check only; no tests/imports/runtime/browser or listening checks. Pending all-break saturation remains bounded but can stay silent until completion/error/reset; no automatic timeout/retry added.
