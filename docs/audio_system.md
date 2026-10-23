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
- `bottle_adapter.js` `createBottleAudioAdapter(audio, { volume, defaultVolume, position })` giver `{ play(key, minGapMs) }`
  til bottles-extensionens `audio`-option. `BottleAudio` er uændret og virker som før uden adapteren.
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
audio.setListener(x,y,z, fx,fy,fz, ux,uy,uz) | listenerFromMatrix(m.elements);  audio.setListenerRoom('bar');
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
`normal` gemmes ikke endnu og påvirker ikke valget (kendt mangel).

### Akustik
`acoustics` (api eller `() => api`; extensionen bruger `ctx.get('acoustics')`) + `setListenerRoom(rum)` + `room` på lyden:
er rummene forskellige bruges `acoustics.path(rum, lytterrum).lossDb` (cachet 0,25 s). Gain gange `10^(-dB/20)`; på `high`
sættes lowpass til `18000 * 10^(-dB/25)` (min 350 Hz). Intet spor, eller tab over 60 dB, betyder at lyden ikke afspilles.
Åben dør (2 dB) giver næsten ingen dæmpning, lukket (35 dB) mumlen. Forsinkelse (lydens fart) bruges ikke.

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

## Demo (`webxr-demo`)
`?audio` loader extensionen før bottles og giver bottles `createBottleAudioAdapter(audio)` som `audio`-option (samme nøgler og
volumener som BottleAudio, men puljet, med varianter). `main.js` ombryder `factory.onImpact`: efter breakage-systemet kaldes
`audio.contact` med flaskens materiale (glas/plast/keramik), overfladen den ramte og slaghastigheden (bortset fra en flaske der
lige er knust). Grib/slip giver hånd-lyd via `grab`/`release`-eventene; en tabt pistol giver metal-kontakt. `window.__audio`
er api'et til fejlsøgning. Uden `?audio` er adfærden uændret. Contracts er ikke rørt.

## Tests
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
- BottleAudio-adapterens `play(key)` får ingen position fra bottles (breakage sender den ikke), så de lyde er ikke rumlige
  før bottles udvides (ejes af en anden agent). Kontaktlyden i demoen er rumlig.
- Ingen forsinkelse efter lydens fart, ingen efterklang/rumklang, `normal` bruges ikke, loops får ikke akustik-opdatering
  (kun ved start), kun én lytter. Skrab/slide udløses ikke automatisk af physics (ingen tangentiel hastighed i kontakt-eventet).
- Fodtrin, knirk, pap-fold og slide-loops har lyde og API men ingen kobling i demoen/Contracts. Contracts' `grab.js` er ikke rørt.
- `things`-tabellen er et første bud; materialer i `extensions/materials` (wood/metal/concrete/fabric) matcher navnene, men
  systemerne er ikke koblet (surface-materialet kan gives direkte som `material2`).
