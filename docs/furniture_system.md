# Møbelsystemet (`extensions/furniture`, G1)

Datadrevne møbler og interaktive objekter: skabe, skuffer, døre, pengeskabe, skabe med lås, kister. Opt-in extension oven på
`mechanics` (hængsler og slidere), `audio` (knirk og lukkelyd), `grasp` (håndtag og greb) og `backpack` (indhold). Intet i et
spil ændres, før det selv indlæser `furniture`.

## Arkitektur

```
extensions/furniture/
  data/furniture.data.json   konstanter: tiers, delkinds, hængselsider, lås-kinds, afvisningsgrunde, hændelser, tærskler, lyd
  data/types.data.json       byggeklodser (door, drawer) og 12 møbeltyper som ren data
  spec.js                    FurnitureSpec, streng validering (parseSpec), udfoldning af typer/klodser, panel- og celle-geometri
  grips.js                   hvilket greb et håndtag giver (læser grasp-posernes pole/grip, ændrer intet)
  furniture.js               createFurniture(host, spec): kernen. Ingen three.js.
  mesh.js                    buildFurnitureMesh(spec): three-bygger. Eneste fil der importerer three.
  index.js                   engine-fri API + createFurnitureSet + furnitureExtension
```

Kernen er ren logik og kan køre i node (alle tests gør). `mesh.js` importeres separat og er ikke eksporteret fra `index.js`.
Afhængigheder (håndhæves af `webxr-demo/tests/extension-boundaries.test.js`): host, mechanics, audio, backpack, grasp. En ekstra
test sikrer, at kun `mesh.js` importerer three.

### Koordinater og enheder
Meter, kg, radianer, newton. Møblets egen ramme: origo på gulvet, +Y op, forsiden mod +Z. Placering (`position`, `yaw`) gives ved
oprettelse og ligger fast bagefter. Hængsler: `left` (akse 0,-1,0), `right` (0,1,0), `back_top` (-1,0,0); slidere: `front`, `left`, `right`.

## Datamodel (FurnitureSpec, `gamesystems.furniture.v1`)

```jsonc
{
  "schema": "gamesystems.furniture.v1", "id": "safe", "name": "Pengeskab", "category": "storage",
  "size": [0.55, 0.65, 0.5], "mass": 90, "material": "metal", "color": "#33383d",
  "parts": [
    { "id": "body", "kind": "body", "style": "box", "wall": 0.03 },
    { "id": "door", "kind": "door", "size": [..], "position": [..], "material": "metal", "minHands": 2,
      "mechanism": { "type": "hinge", "hinge": "left", "min": 0, "max": 1.8, "openValue": 1.53,
                     "resistance": 22, "damping": 2.5, "spring": 0, "selfClosing": false, "latch": 0 },
      "handles": [{ "style": "wheel", "at": [..], "length": 0.2, "radius": 0.012, "twoHand": true }],
      "interaction": "grab" }
  ],
  "locks": [{ "id": "combo", "kind": "code", "code": "2580", "parts": ["door"], "locked": true, "maxAttempts": 5, "lockoutS": 30 }],
  "tiers": {}
}
```

* **Delkinds:** `body` (stil box/table/frame/door-frame), `shelf`, `door`, `drawer`, `lid`, `slide_door`. Alt flytbart har en `mechanism`.
* **Mekanisme:** `hinge` (pivot, akse, `min`/`max` rad) eller `slider` (akse, `min`/`max` m). `resistance` (N eller Nm, det en hånd skal slå),
  `damping`, `spring` + `rest` (fjeder mod lukket), `selfClosing`, `latch` (vinkel/afstand, hvor delen klikker i), valgfri `seal`
  (pakning: konstant træk mod lukket under en vinkel).
* **Håndtag:** `bar`, `knob`, `lever`, `wheel`, `recessed`; placering, længde, radius, orientering, `twoHand`.
* **Interaktion:** `grab` (træk i håndtag) eller `none`. `minHands` 1 eller 2 for tunge dele.
* **Låse:** `key` (`keyId`), `code` (`code`, `maxAttempts`, `lockoutS`), `power` (`mode` secure/safe). Hver lås har et id og en liste af dele.
  Låse går først i indgreb, når delen er lukket; en strømlås bliver afventende og går i indgreb ved lukning.
* **Indhold (`contents`):** på skuffer, hylder og kroppe: lommer (`capacity`, `maxSize`, `categories`), `openAt` (hvor åben delen skal
  være, før indholdet er tilgængeligt), `behind` (døre der skal være åbne), `proxyMax`.
* **Materialer** er lydmaterialerne fra audio-extensionen (metal, glass, ceramic, plastic, wood, concrete, cardboard, fabric).
* **Validering:** `parseSpec` kaster `TypeError: FurnitureSpec <sti>: ...` ved ukendte nøgler, forkerte typer og fysisk umulige data
  (`minHands 1` kræver, at én hånd kan slå modstanden; `minHands 2` kræver, at én hånd taber og to vinder; en fjeder skal kunne slå
  modstanden under klikvinklen). Normalisering er idempotent.

## Tiers

| Tier | Fysik | Lyd | Indhold | Rigtige genstande |
|---|---|---|---|---|
| minimal | nej: kun tilstand. Et greb skifter åben/lukket, `setOpen` sætter værdien | nej | nej | nej |
| low | kinematisk mekanik (hængsler, slidere, stop, fjeder, lås) | nej | nej | nej |
| mid | + | knirk og lukkelyd | pladser (slots) via backpack | nej |
| high | + | + | + | rigtige flasker i åbne skuffer/hylder, højst 8 (standard) og aldrig over 12 på én gang |

Backpack-tier for beholderne: minimal/low/mid -> `medium`, high -> `high`.

## API

```js
import { furnitureExtension, createFurniture, createFurnitureSet, typeSpec, parseSpec } from './extensions/furniture/index.js';
import { buildFurnitureMesh } from './extensions/furniture/mesh.js';   // kun hvis du bruger three

const set = await host.load(furnitureExtension({ inventory, isBlocked, powerOf, onReject, audio }));  // kræver 'mechanics'
const f = set.add('dresser', { id: 'dresser', position: [0, 0, -3], yaw: 0 });   // type-id eller FurnitureSpec
const view = buildFurnitureMesh('dresser', { position: [0, 0, -3] });             // view.update(f) hver frame
```

`createFurniture(host, spec, options)` virker uden extension-værten (host = `{ mechanics, on, emit, audio?, inventory?, isBlocked?, powerOf?, onReject?, quality? }`).

* **Dele:** `parts`, `moving`, `part(id)`, `state(id)` (`value`, `fraction`, `velocity`, `open`, `locked`, `holders`), `isOpen`, `isLocked`, `centreOf`.
* **Hænder:** `grab(id, owner, worldPoint)` -> `{ ok, reason, hands }`, `moveHand(id, owner, worldPoint)`, `release`, `releaseAll`.
  Kraft pr. hånd er højst 60 N x momentarm (loftet af `holdForce` fra grasp), så en hånd ikke kan flytte et tungt pengeskab. Tunge dele
  kræver `minHands` hænder (ellers `TOO_FEW_HANDS` én gang pr. greb). `setOpen(id, open)` og `toggle(id)` giver et skub med håndens kraft.
* **Greb:** `handleWorld(id, i)`, `nearestHandle(point)`, `gripFor(id, i, side)`, `gripsOf(id)`; `handleGrip`/`partGrips` i `grips.js`.
  Bar/greb/hjul bruger de procedurale `pole/grip`-poser (kun læsning; den valgfri `setProceduralGrasps()` røres ikke). Knob giver et
  knibe-descriptor, nedfældet håndtag et fingerspids-descriptor, uden poser.
* **Låse:** `tryKey(lockId, keyId)`, `enterCode(lockId, code)`, `setLocked(lockId, bool)`, `setPowered(lockId, bool)`, `lockState(lockId)`.
  Afvisninger kalder `host.onReject({ reason, partId, ... })` og udsender `rejected`. Grunde: LOCKED, NOT_CLOSED, BLOCKED, WRONG_KEY,
  WRONG_CODE, LOCKED_OUT, NOT_KEYED, NO_INVENTORY, UNKNOWN_PART, UNKNOWN_LOCK, NOT_A_CONTAINER, TOO_FEW_HANDS, POWERED, NO_POWER.
* **Indhold:** `store(itemId, partId, { pocketId, expectedOwner })`, `retrieve(partId, { itemId, pocketId, newOwner })`, `contents`,
  `itemCount`, `isAccessible`, `containerIds`, `ledger`, `cellWorld`, `proxies(budget)`, `contentView`. Hver beholderdel har sit
  eget backpack-stash (profil-id `<møbelId>.<delId>`), så afvisningsgrundene er backpack'ens (FULL, WRONG_ITEM, TOO_LARGE, NOT_ACCESSIBLE ...).
  Adgang åbnes af dør-/skuffefraktionen med hysterese og lukkes igen, når delen lukker.
* **Checkpoint:** `capture()`/`prepareRestore(raw)`/`restore(raw)` (`gamesystems.furniture-state.v1`): kun møblets eget (værdier, lås,
  forsøg, lockout, indhold). Tilstand valideres først; en fejlet gendannelse ændrer intet. Hastigheder gendannes som 0.
  `createFurnitureSet` har samme tre kald for hele sættet.
* **Hændelser** (via `f.on(type, cb)` og på bussen som `furniture:<type>`): `opened`, `closed`, `locked`, `unlocked`, `itemStored`,
  `itemRemoved`, `rejected`, `clunk`, `blocked`, `grabbed`, `released`, `restored`.
* **Blokering:** `host.isBlocked(info)` (`furnitureId, partId, kind, value, previous, position, size, yaw`) kaldes, når en del har bevæget sig;
  returnerer den sand, sættes delen tilbage og `blocked` udsendes (ét billedes forsinkelse).
* **Livscyklus:** `step(dt)` (kald det og `mechanics.step`; extensionen gør det via `update`), `setQuality(tier)`, `dispose()` (idempotent).

### Lyd
Stop mod grænsen og lukning giver `audio.contact({ material1, material2, speed, position, sourceId })` med delens og stoppets materiale
(skuffer: træ/træ, pengeskab: metal/metal). Hastigheden skaleres, så en blød lukning er svag og et smæk hårdt. Knirk (`door_hinge_creak`
til hængsler, `drawer_creak` til slidere) udløses af audio-extensionens egen lytter på `mechanics:changed`; uden audio-extension bruger
møblet `createCreakTrigger` selv, hvis en `audio` er givet. Uden lyd virker alt stumt.

## Typekatalog

| Type | Mål (b x h x d m) | Bevægelige dele | Særligt |
|---|---|---|---|
| `cabinet` | 0,9 x 1,8 x 0,45 | to døre | to hylder |
| `kitchen_cabinet` | 0,6 x 0,9 x 0,58 | skuffe + låge | indhold i skuffen |
| `dresser` | 0,9 x 1,0 x 0,5 | fire skuffer | 4 flasker pr. skuffe |
| `wardrobe` | 1,2 x 2,0 x 0,6 | to store døre | stanghåndtag, to hænder |
| `desk` | 1,4 x 0,75 x 0,7 | tre skuffer + smal skuffe | bordstel |
| `fridge` | 0,6 x 1,7 x 0,65 | dør | selvlukkende, pakning, klik ved 0,12 rad |
| `safe` | 0,55 x 0,65 x 0,5 | tung dør | kodelås 2580, hjul, `minHands` 2, 5 forsøg, 30 s lockout |
| `locker` | 0,4 x 1,8 x 0,5 | dør | nøglelås `key_locker` |
| `chest` | 0,9 x 0,5 x 0,5 | låg | nøglelås `key_chest` (låst op fra start) |
| `door` | 0,92 x 2,1 x 0,1 | dør | karm, klinke; kan få strømlås |
| `sliding_door` | 1,8 x 2,2 x 0,14 | skydedør | slider |
| `drawer` | 0,45 x 0,27 x 0,4 | skuffe | natbord |

`drawer` og `door` findes også som genbrugelige byggeklodser (`BLOCKS`, `expandBlock`, `mergeBlock` i `spec.js`): en type skriver blot
`{ "use": "drawer", "id": "drawer1", ... }` med de felter, der adskiller sig.

## Sådan tilføjer du et møbel
1. Tilføj en post i `data/types.data.json` i listen `types` (brug `"use": "drawer"` eller `"use": "door"` for skuffer/døre). Eller giv `createFurniture`/`set.add` et
   FurnitureSpec direkte uden at røre extensionen, f.eks. `typeSpec('door')` med egne `locks`.
2. Kør `parseSpec`: fejlene peger på stien. Typen er nu i `TYPE_IDS`, og testen "alle typer bygger geometri" dækker den automatisk.
3. Den procedurale geometri følger af data (`bodyPanels`, delenes størrelse, håndtagets stil). Nye håndtagsstile tilføjes i
   `HANDLE_STYLES` (data), `grips.js` (greb) og `handleGeometries` i `mesh.js`.

## three-bygger
`buildFurnitureMesh(spec, { position, yaw, shadows })` slår alle statiske plader sammen til ét mesh pr. materialeklasse (matte/metal/glas) og
laver pr. bevægelig del ét mesh (del + håndtag, vertex-farver) under en pivot-gruppe. Geometri deles mellem ens stykker (cache), de tre
materialer deles af alle. Måling: de 12 typer bruger 2-5 draw calls hver, 34 i alt for én af hver. `update(furniture)` skriver kun pivotens
position/quaternion (ingen allokering; målt i test). Flaskerne i skufferne tegnes i demoen som ét `InstancedMesh` (højst 12).

## Mekanik-krog (additiv ændring i en eksisterende extension)
`mechanics.moveHand(id, owner, point, stiffness = 80, maxForce = Infinity)`: den nye valgfrie `maxForce` begrænser håndens kraft. Standard
(uendelig) er uændret adfærd; alle eksisterende tests og golden-resultater er uændrede. Brugt til at holde en hånd under 60 N x arm.
Ingen ændringer i audio eller backpack (kun læsning af deres API).

## Demo og test
* `webxr-demo/furniture.html` + `src/furniture-lab.js`: rum med alle 12 typer, flasker i fire skuffer, nøgler på skrivebordet, kodepanel,
  musetræk (Shift = anden hånd) og VR-controllere (trigger/grip tager fat; stråle mod flasker, nøgler og kodepanel). `?audio` slår lyd til.
  Desktop-panel: smæk, nøgler, kode, kvalitet, gem/indlæs. `window.__furniture` til scripts. `?furniture` på hovedsiden er ikke lavet (se mangler).
* Tests: `webxr-demo/tests/furniture.test.js` (28 tests: validering, skuffe/dør/fjeder/pakning, to-hånds pengeskab, dt-uafhængighed ved
  36/72/144 Hz, nøgle/kode/strøm, indhold og afvisninger, tiers, lyd med falsk audio, blokering, checkpoint, sæt, greb, geometri for alle
  typer, ingen allokering) og `extension-boundaries` (furniture i DEPS + kernen uden three). webxr-demo `npm test`: 896 grønne (før 866).
* Hub-testen `demo-moebler` (`tools/headset-lab/hub/tests.js`, trin under «Flasker i demoen») med links `/demo/furniture.html`.
* Synk: `scripts/sync_lib.mjs` (`SYNC_SUBDIRS`: backpack og furniture `data`) og `webxr-demo/scripts/sync-helpers.mjs` (`EXTENSIONS`
  += backpack, furniture) spejler extensionen til `webxr-demo/src/vendor/extensions`.

## Contracts (ikke tilføjet)
Standarden i Contracts er uændret. En sync er ikke triviel: `tools/sync_extensions.mjs` har `EXTENSIONS = [grasp, humanoid, avatar,
character-cc, host, bottles, ai, audio]`, og `furniture` kræver også `mechanics` og `backpack` (som Contracts ikke har), samt `SYNC_SUBDIRS`
for `data/`-mapperne, nye poster i `SYNCED.json`/`tests/extensions-sync.test.mjs` og et sted i spillet, der indlæser den (opt-in-flag).
`node tools/sync_extensions.mjs --check` viser allerede forskelle i `SYNCED.json` for alle eksisterende extensions, så der skal først
afgøres, om Contracts' kopier skal opdateres. Derfor er hverken `sync:extensions` eller Contracts' tests kørt for G1.

## Godot-port (beskrivelse)
* Datamodellen (JSON + schema) bruges uændret: `types.data.json` er ressource-kilden. En `FurnitureSpec`-Resource (GDScript) parser og
  validerer med de samme regler som `parseSpec`.
* Kernen (`furniture.js`) portes 1:1 til en GDScript-klasse `Furniture` (ren logik, ingen noder): hængsel/slider som 1-DOF med de samme
  parametre, gerne via en delt `Mechanism1D`-klasse; backpack-stash via den eksisterende containerkerne.
* Visning: en `FurnitureNode` (Node3D) bygger `MeshInstance3D` pr. del under `Node3D`-pivots (procedurale `BoxMesh`/`CylinderMesh` sat
  sammen med `ArrayMesh`/`MultiMesh`, ét materiale pr. klasse). Fysik: `AnimatableBody3D` pr. bevægelig del til kollision, drevet kinematisk.
* Greb: `XRController3D`-tryk finder nærmeste håndtag (`nearest_handle`), samme kraftloft; to hænder for `min_hands` 2.
* Lyd: `AudioStreamPlayer3D` pr. kontakt, materiale-par som tabel; knirk som loop med volumen efter hastighed.
* Checkpoint: samme felter som `capture()` som `Dictionary`/JSON; tests porteres som GUT-tests med de samme data.
* Tiers: samme fire; `high` bruger rigtige `RigidBody3D`-flasker i åbne skuffer, højst 12.

## Kendte mangler
* Kun to knirkelyde (hængsel, slider); ingen lås-klik, nøglelyd eller hjul-drejelyd. Lydfilerne er audio-extensionens eksisterende.
* Ingen tyngdekraft på døre (en dør der står åben, falder ikke); klik ved `latch` og fjeder lukker i stedet.
* Blokeringskrogen har et billedes forsinkelse og kender kun én blokering ad gangen; ingen kollision mellem to møbler.
* Placering ligger fast efter oprettelse; flytbare møbler kræver et nyt møbel.
* Genstande i en skuffe kan kun ligge i faste celler (ikke frit placeret); slots bliver i inventaret efter `dispose`.
* Hastighed gendannes ikke fra checkpoint (alt gendannes i hvile).
* Grebsposerne er udviklet til en stang med radius 0,022; andre radier giver kun omtrentlig pasform. Håndtagene er ikke koblet til avatar-/`interaction.js`-hænderne, så labbet bruger eget mus- og controller-greb (ingen håndmodel i labbet).
* Kodepanelet og nøglerne er enkle ray-mål; ingen tastaturanimation og ingen nøgle, der kan bæres i hånden.
* VR har intet panel: kvalitet, gem/indlæs, «Smæk» og strømlås kan kun prøves på skrivebordet.
* `?furniture` på hovedsiden er ikke tilføjet (kræver en ny scene i `main.js`; ikke enkelt nok til G1).
* Afprøvet kun i node (28 tests) og headless Chrome (labbet starter uden fejl og kører et scriptet scenarie). Intet i rigtigt headset.

## Quest-testtrin
Start labben (skrivebordsgenvejen «GameSystems testlab»), åbn hub-testen `demo-moebler` (eller `https://<pc-ip>:8443/demo/furniture.html`),
tryk Enter VR og følg trinnene i hub-testen: åbn kommodens skuffe, tag og læg en flaske, lad køleskabet lukke selv, prøv nøgler og kode,
åbn pengeskabet med to hænder (én hånd skal give `TOO_FEW_HANDS`), og vurdér knirk og dunk med `?audio`. Skriv i noten, hvor
grebet føles forkert (håndtagshøjde, kraft) og frame-tiden med flere åbne skuffer.
