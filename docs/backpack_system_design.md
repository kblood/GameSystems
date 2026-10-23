# Genbrugeligt backpack-system (afmonterbar rygsæk) — research og designforslag

Status: **P0 og P1 leveret (2026-10-24), se afsnit 8**; resten er forslag. Oprindeligt skrevet 2026-10-23 som research til et backpack-system, som flere VR-spil kan bruge
(NightfallContracts i Godot og three.js/WebXR, men også spil à la *The Walking Dead: Saints & Sinners*).

Konvention gennem hele dokumentet:

- **[V]** = verificeret: jeg har læst koden (fil:linje) eller en ekstern kilde (URL i kildelisten), og det står der.
- **[S]** = skøn/vurdering: min egen slutning eller anbefaling. Ikke bevist.
- **[?]** = ikke fundet/ikke verificeret. Står bevidst åbent.

Linjenumre refererer til filerne som de så ud under auditten.

---

## 0. Kort konklusion

1. **[V]** Godot-siden har en stærk, testet kerne: en ren ejerskabs-ledger (`NightfallGearInventory`), en scene-adapter med atomiske
   reparent-overførsler, en over-skulder-approach-politik og en begrænset håndtagstræk-politik. Men rygsækken er *altid* en
   kropsbundet "rig": den følger hoften hvert fysik-tick, og håndtagstrækket er et guidet udtræk på højst 0,20 m.
2. **[V]** Der findes **ingen** inventory/backpack/holster-kode i `GameSystems/extensions/` (three.js). Holster/pouch findes kun som
   spil-specifik kode (pistolen i `webxr-demo/src/pistol.js`, magasin-pouches i Nightfalls `src/weapons/interaction.js`).
   three.js-siden skal bygges fra bunden, men har næsten alle byggeklodser (grasp, held_drive, two_hand, weight_lag, avatar/vrik,
   audio, mechanics, checkpoint, host/system).
3. **[V]** "Tag af og åbn i luften" er *ikke* en lille udvidelse. Fire ting forhindrer det direkte (afsnit 1.5): rig-transformen
   overskrives hver frame fra kroppen, trækket er loftet til 0,20 m, der findes ingen afmonteret tilstand, og indholdet er
   ledger-ejede *frosne* noder (ikke fysik) hængt på rigens egne ankre.
4. **[S]** Anbefalet første fase: **engine-uafhængig kerne + JSON-kontrakt + golden-vektorer** (tilstandsmaskine, regler, kapacitet,
   checkpoint-format) og derefter **Godot først** (afsnit 6): ledger, adapter og tests findes allerede dér, og risikoen i
   "afmonteret tilstand" ligger i scene-/ejerskabsovergange, som Godot-adapteren allerede har atomiske, testede primitiver til.
   three.js følger som port mod golden-vektorer.

---

## 1. Del 1 — audit af det eksisterende

### 1.1 Godot-addon `gs_backpack` (genbrugeligt lag)

Mappe: `GameSystems/godot/addons/gs_backpack/` (3 scripts, 184 linjer + 2 testfiler + README).

**`gs_backpack_approach.gd` (82 l.) — `GSBackpackApproach`**
- Ren `RefCounted`-politik. Ejer ingen genstande, noder, fysik eller haptik (`:1-5`; README bekræfter).
- Konvention: +X er bærerens højre, +Z er bagud (`:4`).
- Konstanter (`:7-20`): `MAX_SAMPLE_DT 0.15`, `MAX_SAMPLE_JUMP_M 0.30`, `APPROACH_LIFETIME_S 1.25`, `ENTRY_SIDE_MIN_M 0.08`,
  `SIDE_MAX_M 0.50`, `ENTRY_FRONT_M -0.22`, `ENTRY_BACK_M 0.08`, `RETRIEVE_BACK_MIN_M 0.10`, `RETRIEVE_BELOW_SHOULDER_M 0.35`,
  `MIN_PROGRESS_M 0.08`, `PATH_SHOULDER_CLEARANCE_M 0.05`.
- `observe(side, tracked, local_hand, shoulder_y, dt)` (`:28-48`): afgrænset historik; tracking-tab, NaN, hop >0,30 m, hitch dt>0,15 s
  eller sti gennem kroppen nulstiller siden (`:30-40`). "Entry"-zonen er ved/over skulderen, lateralt 8-50 cm.
- `check(...)` (`:50-67`) returnerer `{allowed, reason}`; årsager `back_approach_required|jump|path|expired|wrong_side|too_low|not_behind|no_progress` eller `over_shoulder`.
- `_path_clear` (`:69-79`) interpolerer segmentet ved bag-planet, så en diagonal gennem torsoen ikke slipper igennem.
- Side-symmetri: `lateral = local_hand.x * (1 if right else -1)` (`:44`, `:61`) — venstrehånd er allerede understøttet i politikken.

**`gs_backpack_handle_pull.gd` (48 l.) — `GSBackpackHandlePull`**
- Lokal-rum træk: `PULL_DEADZONE_M 0.035`, **`MAX_PULL_M 0.20`**, `FOLLOW_RATE 14.0` (`:6-8`).
- `begin()` accepterer kun `grip|interact` (`:17-25`). `step()` måler kun bevægelse udad langs rigens -Z:
  `outward = start_local.z - hand_local.z`, `target = clamp(outward - deadzone, 0, 0.20)` (`:34-35`). Tracking-tab annullerer (`:29-31`).
- **Pointen: et gummibånds-offset, ikke en frigørelse.** Der er ingen tilstand hvor tasken forlader kroppen.

**`gs_backpack_interaction.gd` (54 l.) — `GSBackpackInteraction`**
- Komponerer approach med adapterens `request_retrieve()` (`:12-21`, `:34-48`). Kun konfigurerede slots (default `["back"]`) kræver
  over-skulder-vejen (`:29`). Ændrer aldrig ejerskab selv (`:3-4`).
- Tests: `tests/gs_backpack_tests.gd` (34 checks iflg. `godot_port_plan.md`) og `tests/gs_backpack_interaction_tests.gd` (10 checks).

### 1.2 `gs_gear_inventory` — ledger og scene-adapter

**`gs_gear_inventory.gd` (207 l.) — `NightfallGearInventory`** (ren ledger, flytter aldrig noder, `:1-2`)
- Ejere: `OWNERS := ["world","hand:left","hand:right","equipped"]` (`:9`); genstand i slot har ejeren `"slot"`.
- Slots: `add_slot(id, categories, max_size)` (`:19-28`); størrelse sammenlignes efter akse-sortering, så roteret genstand kan passe (`:201-204`).
- Atomiske overgange: `store` (`:61-67`), `retrieve` (`:70-78`), `transfer` (`:81-88`), `unregister_item` (`:92-103`). Synkront
  `ownership_changed` låser mutation under notifikation (`:191-196`).
- Checkpoint: `capture()` (`:113-119`) = kun `{owner, slot}` pr. item + slotclaims, **version 1**. `prepare_restore` validerer uden mutation (`:123-167`),
  `commit_restore` committer (`:169-177`). Scene-referencer og item-state er med vilje udeladt (`gs_gear_inventory/README.md`).
- **Fund:** ledgeren kender ikke "container". Slots er flade og globale; en taske kan ikke selv være ejer.

**`gs_gear_inventory_scene_adapter.gd` (477 l.)**
- `set_owner_root` (`:22-34`) nægter rebind så længe en genstand har den ejer.
- `register_slot(id, anchor: Node3D, cats, max_size, access_hands)` (`:36-54`): en slot er et **ankerknudepunkt**.
- `check_slot_access` (`:56-84`): event-drevet, afstand ≤ reach + ét fysik-ray til ankeret.
- `request_store/request_retrieve` (`:86-103`) er input-indgangene; direkte `store/retrieve` er til betroet kode.
- `store` (`:185-210`) og `retrieve` (`:212-238`): reparent + ledger i én `_busy`-transaktion med rollback. Genstande i slots gøres til
  `freeze=true`, `collision_layer=0`, `mask=0` (`_freeze_in_slot`, `:447-454`) og gendannes til world (`_restore_body_state`, `:462-468`).
- `release_to_world` (`:240-279`): bounded hastighed (`MAX_RELEASE_SPEED_MPS 9`, `MAX_RELEASE_SPIN_RAD_S 22`, `:11-12`).
- `reset_inventory`/`restore_inventory`/`capture` (`:281-318`) holder ledger og scene sammen; signal `reconciliation_failed`.
- **Konsekvens [V]:** genstande i tasken er *frosne børn af et anker* uden fysik, kollision eller egen pose (`node.transform = IDENTITY`, `:199`).
  "Fysiske genstande i åben taske" findes ikke i dag; der er ét objekt pr. slot.

### 1.3 `gs_weapon_loadout` og `gs_weapon_catalog`

- `gs_weapon_loadout.gd` (117 l.): register over levende våbenindgange + atomisk `select(id, can_switch, apply_switch)`; **ejer ikke slots, inventory eller input**
  (README). Forbindelsen til rygsækken sker i spillet via id'er `player:weapon:<id>` og ejeren `equipped` (`player.gd:631`, `:676-681`).
- `gs_weapon_catalog` (99+34 l.): datadrevne våbendefinitioner. Relevant for backpack kun som **kategori/størrelse**.
- **[S]** Begge hører korrekt *uden for* backpack-kernen; backpack må kun kende `category`, `size`, `item_id`.

### 1.4 NightfallContractsGodot — forankring, ejerskab, checkpoint

**Rig (`runtime/backpack_rig.gd`, ca. 1200 l.)**
- Slots (`:42-67`): `back` (tool/medical/long_gun), `left_hip`, `right_hip` (pistol/magasin) og indre lommer `main_tool`, `main_supply`, `main_case`
  under `$MainCompartment/Contents/*`. Hænder pr. slot i `_slot_hands` (`:61-68`).
- Åben/lukket: `CLOSED_BAG = (0,0.08,0.17)` / `OPEN_BAG = (0,-0.02,-0.48)` (`:31-32`), tween 0,24 s (`:433-455`), svejet mod verden i ≤15 mm trin (`:24`);
  indhold tilgængeligt ved 95 % åbning (`:27`).
- **Forankring** (`update_body_anchor`, `:226-247`): `operator_body.get_gear_anchor("holster")`, fast offset `Vector3(-0.23,-0.04,0.03)`, 180° vending, +0,22 m op:
  `desired = Transform3D(anchor.basis*Basis(UP,PI), hips+UP*0.22)` (`:236-237`); trækoffset langs -Z (`:243`); kollisionssvejs (`:266`); `_body_follow_world` + `global_transform` (`:244-246`).
- **`_process` (`:145-152`) sætter `global_transform = _body_follow_world` hver frame** — bevidst, så en forælder ikke kan flytte tasken gennem en væg. Hårdeste enkeltblokering for "afmonteret".
- `get_gear_anchor` (`addons/nightfall_characters/operator_body.gd:321`): fysisk rig-løst gear eller hoftebenet + offset (`:338-354`). **Siddende** løftes holsteret til siddende bælte
  (`_seated_gear`, `:329-336`, `SEATED_EYE_TO_BELT 0.38`). Skulderhøjde til approach = ankeret `"magazine"` − 3 cm (`backpack_rig.gd:217-224`).
- Tracking: hver fysik-tick `palm_proxy.valid[side]`; tab nulstiller approach og annullerer trækket (`:182-203`). Player-rebind er atomisk (`bind_player` `:654-683`, `_configure_roots` `:621-652`).
- Håndtag: `HANDLE_REACH_M 0.16` (`:20`); `step_handle_pull` (`:402-413`) med kollisionsbegrænsning (`:367`).

**Ejerskab og checkpoint**
- Ledgeren ejer slot og genstand; spillet ejer ammo/væske/våbentilstand (`gs_gear_inventory/README.md`, `docs/backpack_runtime.md`). Cargo bæres som registreret node under hånd-roden med ledger-ejer `hand:left|right`
  (`release_cargo` `:967-1003`, `_seat_cargo` `:1004-1011`).
- Checkpoint: `player.gd:894-952` (`capture_magazine_checkpoint`, version 2/3) samler `adapter.capture()` + våbentilstand + verdensmagasiner; restore er transaktionel
  med rollback (`:959-...`). Hånd-bårne magasiner blokerer capture.
- **[V]** `compartment_open` og pull-offset indgår ikke i noget checkpoint: `compartment_open` refereres kun i `backpack_rig.gd` (grep). Rigens pose er altid afledt af kroppen, så intet gemmes i dag.
  En afmonteret taske **får** tilstand der skal gemmes.
- Spillets egen dok kalder det "guided presentation, not a freely simulated rigid backpack" (`docs/backpack_runtime.md`); målet i `docs/vr_backpack_weapon_system.md` er eksplicit
  "ikke en fuld simulation af stof, lynlåse eller løse ting inde i tasken". `docs/improvement_backlog.md:1078-1099` og `:1758-1780` beskriver backpack som løbende delmål;
  headset-accept er **ikke** givet (kun headless: 448 checks).

### 1.5 Hvad forhindrer præcist "tag af og åbn i luften"?

| # | Blokering [V] | Hvor | Nødvendig ændring |
|---|---|---|---|
| 1 | Rig-posen er altid afledt af kroppen og genpåtrykkes hver frame. | `backpack_rig.gd:145-152`, `:226-247`, `:255-264` | En **pose-ejer** med tilstand: `WORN` (krop ejer posen) vs. `HELD/PLACED` (hånd/verden). `_process` må kun reasserte i `WORN`. |
| 2 | Trækket er loftet til 0,20 m og måler kun udad langs -Z. | `gs_backpack_handle_pull.gd:7`, `:34-35` | Behold som *præ-fase* (guidet udtræk, haptisk klik), men tilføj **frigørelsestærskel** (holdt greb + ≥0,18 m i ≥150 ms eller hastighed) → `DRAWING→HELD`. Trækket forbliver loftet. |
| 3 | Ingen afmonteret tilstand; håndtaget sidder på en kropsforankret rig; cargo-hånden kan kun flytte riggen via samme loftede offset. | `backpack_rig.gd:20`, `:402-413`, `:715` | Ny tilstandsmaskine (3.2) med to-hånds greb, `HELD_OPEN`, `PLACED`, `RETURNING`. |
| 4 | Åbning er en tween af en **konstant** forskydning i rigens lokale rum, og sweep-proxyerne antager kropsforankret pose. | `:31-32`, `:433-455`, `:522-600` | Åbning = tilstand på tasken (lukket/åben-fraktion) uafhængig af position; sweep bruger aktuel verdenspose. |
| 5 | Indhold = frosne noder på slotankre (`freeze`, `layer=0`), ét pr. slot, ingen egen pose. | `gs_gear_inventory_scene_adapter.gd:447-454`, `:199` | Mellem-tier: lommer som i dag. Høj tier: nyt container-view der ved åbning materialiserer proxyer/rigids i en afgrænset volumen, uden at ledgeren slipper ejerskabet (3.4). |
| 6 | Ledgeren har flade, globale slots og ingen container-ejer. | `gs_gear_inventory.gd:9`, `:19-28` | Additiv `container`-udvidelse (slots grupperet pr. container-id; container-ejer `worn/hand/world`). Checkpoint v2 der accepterer v1. |
| 7 | Slot-adgang er punkt-reach + ét ray til et anker; en åben taske set oppefra kræver en åbnings-zone. | `check_slot_access`, `:56-84` | `access_volume` (OBB/kegle over åbningen) som alternativ, kun i `HELD_OPEN/PLACED`. |
| 8 | Dobbelt autoritet: `player.gd` kender `backpack_rig` direkte; våben/sling/magasin-flows er flettet ind. | `player.gd:543-548`, `:568-714`, `:894-1190` | Regel: hofte-/back-**mounts** hører til kroppen (3.3), ikke tasken, så flows ikke brydes når tasken er af. |
| 9 | Checkpoint kender kun ledger-ejerskab (v1), ikke taskens pose/tilstand. | `gs_gear_inventory.gd:113-119`; `player.gd:952` | Tilføj `backpack:{state,owner,pose?,open_fraction}`; restore default `WORN`, `PLACED` kun ved gyldig pose. |

### 1.6 three.js — hvad findes, hvad kan genbruges

**[V] Findes ikke:** ingen backpack/inventory/stash/holster-extension i `GameSystems/extensions/` (grep efter holster|stow|sheath|pouch|satchel|backpack
rammer kun `webxr-demo/*` og Nightfalls `src/weapons/*`, `src/game/enemies.js`, `src/interaction/props.js`).

**[V] Spil-specifikt, ikke genbrugeligt som det er:**
- `webxr-demo/src/pistol.js` (`holsterPoint`, `HOLSTER_REACH`, `:181-183`) og `webxr-demo/src/interaction.js:340-371` (squeeze ved hoften tager; slip ved hoften holstrer; ellers drop).
- Nightfall `src/weapons/interaction.js:11-44`: `POUCH_CAPTURE 0.18`, `beltPouchPose(head)` (yaw-ramme fra *hovedet*, offset `[-0.23,-0.90,0.10]`), `shoulderPouchPose`.
  Forankret til hovedets yaw, ikke avatarens hofte — netop koblingen adapteren skal gøre valgfri.

**[V] Genbrugelige byggeklodser:**
- `extensions/host/system.js`: `registry()`, `extension(id, create, options, connect)`, `tierState()`, `SYSTEM_TIERS = minimal|low|mid|high` — skabelon for `extensions/backpack/`.
- `extensions/host/state.js` (`jsonState`, `stateId`, `booleanState`) og `extensions/checkpoint/index.js` (`createCheckpointSystem`: providers med `capture/prepareRestore→{commit}`, rollback, `gamesystems.checkpoint.v1`). Bottles har et eksisterende checkpoint-mønster (`bottles/state.js`).
- `extensions/host/physics.js`: `PHYSICS_METHODS = addBody, pose, velocity, setMass, hold, release, isHeld, onContact, onStep, remove` (`:44`) — fysik-hook til genstande i åben taske.
- `extensions/grasp/*`: `held_drive.js` (`holdForce(hands)`, `driveAcceleration`, `driveAngular`, hånd-bevægelseshistorik), `two_hand.js` (`pickSecondary`, `solveTwoHand`, `secondaryHeld`, `releasedTogether`, `stepBlend`, `handsClearance`),
  `weight_lag.js` (`maxOffset(mass,{hands})`, `lagTarget`, `elbowHintOf`, tier-tilstande), `throw_release.js`, `catalog.js` (masseegenskaber). Datadrevet via `grasp/data/*.json` med Godot-læsere (`gs_grasp_data`) — præcis mønstret backpack bør følge.
- `extensions/avatar/*`: `vrik.js` (`createVRIK`; løsningen har `world`/`joints` for hips/spine/chest/upperChest, `setElbowHint(side, vector, weight)` `:149`), `body_height.js` (posture `seated`, virtuelt crouch),
  `fingerInput.js` (`controllerFingerState`, `relaxedFingerState`), `handprofile.js`/`handskin.js`. **Ingen navngivne gear-ankre** i JS-avataren (Godot har `get_gear_anchor`); de skal udledes fra `joints.hips/chest` + offsets.
- `extensions/audio/system.js`: `play(key,o)`, `contact(c)`, `grab(o)`, `release(o)`, `startLoop/updateLoop/stopLoop` (`:324-366`).
- `extensions/mechanics/index.js`: analytiske 1-DOF `slider|hinge|valve` med `add/state/setValue/drive/grab/moveHand/step` og `prepareRestore` — brugbar til **klap/låg (hinge)** og **lynlås (slider)** med checkpoint.
- `extensions/bottles/*`: flasker med væske/brud som *egne objekter* med egen tilstand; backpack ejer kun placeringen (samme princip som ledgeren).
- Tiers: avatar `off|arms|full` (`avatar/index.js:111`), host `minimal|low|mid|high`, grasp `quality.data.json`, weight_lag tier-tilstande.

**[V] Port-mønster:** JS-kilde → JSON-kontrakt → Godot-læser + golden. `godot/tools/gen_golden.mjs` (genererer / `--check`), `grasp_*_golden.mjs`, `godot/tools/sync_addons.py` til spil.
`docs/godot_port_plan.md` beskriver kontrakterne `humanoid`, `validator`, `closure`, `held_drive`, `catalog`.

### 1.7 Skel: genbrugeligt kernelag vs. Nightfall-specifikt

| Genbrugeligt (ind i backpack-systemet) | Nightfall-specifikt (bliver i spillet) |
|---|---|
| Slotmodel (kategori + størrelse, roteret fit) og ledger med atomiske overførsler | Scenen (`BackpackRig.tscn`), `field_pack.glb`, de 4 visuelle grupper |
| Ejere og checkpoint-format (`items/slots`) | Konkrete slots `main_tool/main_supply/main_case`, `left_hip/right_hip` |
| Approach-regler og håndtagstræk (de tre `gs_backpack`-scripts) | Kropsmål/offsets (`(-0.23,-0.04,0.03)`, +0,22 m) — skal blive *profil-data* |
| Adapter-gating: reach, occlusion, `request_*`, `release_to_world` | Våben-/magasin-/sling-flows (`player.gd`), `equipped`-roden, Kestrel/Morrow/Shear |
| Kollisionssvejs-mønstret (generaliseres til volumen-sweep) | `operator_body.get_gear_anchor`, `palm_proxy`, Valve Frame/Touch input-mapping |
| (nyt) tilstandsmaskine, tabsregler, to-hånds løft, tiers | HUD-labels (`SQUEEZE/INTERACT`), amber håndtag, lomme-tekster |

---

## 2. Del 2 — ekstern research

**Metodenote.** Søgeværktøjet gav få primære kilder. Det jeg ved om spillene ud over kilderne er fra hukommelsen og markeret [S]/[?]; kun det en læst kilde faktisk siger er [V].
Jeg har ikke selv spillet dem i denne opgave. Flere spil (Blade & Sorcery, Contractors, Bonelab/Boneworks, Resident Evil 4 VR, Skyrim/Fallout 4 VR-mods) gav **ingen** brugbare primærkilder om rygsæk/holster-detaljer og står som [?].
Kilder mærket "kun via søgeresultat" er ikke selv åbnet.

### 2.1 Pr. spil

**The Walking Dead: Saints & Sinners**
- [V] Seks "holsters": to på bæltet (våben), to på brystet (lommelygte, journal), ét pr. skulder (rygsæk og tungt våben). Rygsækken har intern plads til et ekstra våben og et "begrænset antal" genstande ([3]).
- [V] Rygsækken gribes over **venstre** skulder, tohånds-våben over højre; genstande snapper til hånden på afstand og lagres lige så hurtigt ved at kaste dem over skulderen ([1]).
- [V] Rygsækkens indhold er en grid-UI; en anmelder kalder det kun spændende én gang at række efter en kniv i rygsækken, mens en zombie er tæt på; grebspunkter kaldes "finicky" ([4]).
- [V] Kapacitet: spillere rapporterer 27 slots, senere 36; én genstand = én slot uanset størrelse; spillerne er splittede mellem enkel slot-model og størrelse/vægt ([2]).
- [?] At tasken "åbner foran kroppen" og tidspres under åbning er **ikke** bekræftet af en læst kilde (min hukommelse [S]: grid/panel foran spilleren mens spillet fortsætter).

**Half-Life: Alyx**
- [V] Forbrugsvarer (ammo, resin, helbred) går i inventory ved at føre dem op til hovedet; særlige genstande i en slot ved højre håndled; ammo vises på venstre handske ([6]).
- [V] Spillere beskriver over-skulder-aflevering af magasin som fiklet: kun den rigtige skulder registrerer; råd: skulder modsat våbenhånden, hånd lidt højere, slip langsomt; delvist brugte magasiner afvist (set som bug); nogle opgiver ([7]).
- [?] Ingen fysisk rygsæk i det læste; skulder-/hovedzonen er "tasken".

**Into the Radius (VR)**
- [V] Rygsæk tages ved at række over skulderen og **returnerer automatisk**, hvis man bevæger sig langt nok væk; stor kapacitet, genstande kan stikke ud af siderne, ekstra primærvåben-hylster; vest med slots, 4 magasinlommer, skalholster, drop-pouch på venstre lår ([8]).
- [V] Kritik: indhold i hovedrummet overlapper forvirrende; trigger-targeting upræcis under pres; bæltet dårligt placeret og akavet at nå — især **siddende** — og lander nogle gange bag ryggen; genstande kan glide ud af kortet ([9]).
- [V] Genstande efterladt i basen forbliver; i Into the Radius 2 giver rygsæk og vest kapacitet uden encumbrance, og man behøver ikke tage rygsækken med på hver mission ([9], [10]). Spillere melder dog blandet om lagrets pålidelighed ([11], kun via søgeresultat).
- [S] Tættest på "taske som afmonterbar ting med verdenstilstand"; peger på at **forsvindende verdensobjekter** er det mest generende.

**Bonelab / Boneworks** — [V] kun community-mods (HolsterResizer skalerer holsters/ammo-pouch/bodylog til avatar) ([12]): slots er avatar-relative. [?] Selve bodylog-design ikke læst.

**Blade & Sorcery** — [V] kun en gammel tråd om at en quiver kan tages af ved hånd mod quiver + trigger ([13]). [?] Holster/rygsæk ellers ikke verificeret.

**Contractors / Pavlov** — [V] Steam-tråd: når kroppen ikke er låst til headsets retning, flytter magasin-/gadgetpositioner sig konstant; ønske om at låse krops-/inventory-rotation til headset ([14]). Feature-request-tavle for et taktisk VR-spil: ønske om venstre-hofte-pistol og uafhængige holsterindstillinger ([15]; brugerønsker, ikke features). [?] Spillenes egne holster-regler ikke læst.

**Skyrim VR / Fallout 4 VR mods** — [V] HIGGS (Skyrim VR): gravity gloves og lagring i et over-skulder-inventory ([16]); VRIK-mod: holsters mange steder, hånd over holster + grip lægger våben ([17]). [?] Ingen kilde til fysisk afmonterbar rygsæk i FO4 VR.

**Zombie Army VR** — [V] Tre våbenpladser (rifler over skulder, pistoler fra taljen) og en satchel til tre genstande, som vises som flydende flad menu og kritiseres for at dræbe indlevelse ([18], [19]).

**Arizona Sunshine 2** — [V] Ammo-pouch på brystet kritiseres: magasin "suges" tilbage i inventory når det kommer tæt på brystet; våben bindes automatisk til den hånd/holster der greb dem; hunden Buddy er ekstra slot ([20]).

**Resident Evil 4 VR** — [?] Ingen VR-kilde fundet (den flade version har attaché-case-grid). Brug ikke som VR-reference.

**Till Dawn (indie)** — [V] Rygsæk kaldes frem ved at holde en controller **bag hovedet** og trykke grip; tasken er så ved hånden; samme gestus lægger den tilbage. 10 slots + 2 våbenslots; valgt frem for menu pga. immersion ([21]).
Eneste fundne eksempel på "kommer til hånden og åbnes i luften".

**Forskning/designråd**
- [V] Taksonomi: Cmentowski, Krekhov, Krüger, *"I Packed My Bag and in It I Put..."* (arXiv:2107.08434): analyse af populære VR-spils inventories og udledte byggeblokke; kun abstract læst ([22]).
- [V] Game Developer ([23]): lad tasken være en synlig container som spilleren trækker frem (ét eksempel: flydende foran spilleren med overfladen som UI, ting kastes ind/hives ud med hånden); indre slots til små, ydre til store ting; åbn med naturlig gestus som at trække af skulderen;
  hyppige ting på lår/bryst giver muskelhukommelse; siddende kan standardslots være svære at nå — tilbyd justerbare positioner; faste slots med én stak.
- [V] De fleste VR-spillere er ikke fuldt trackede og ser kun hænderne, så kropsforankring er et estimat ([24], citat via søgeresultat).

### 2.2 Mønstre

| Dimension | Mønstre set | Evidens |
|---|---|---|
| Attached-only vs. afmonterbar | Attached-only er normen (S&S, Into the Radius, Alyx-skulder). Afmonterbarhed ses som: kald til hånden (Till Dawn), efterlad i basen (Into the Radius 2). Ægte "tag af, hold foran, åbn, sæt på" har jeg **ikke** kunnet verificere i et udgivet spil. | [V]/[?] |
| Åbnes på kroppen vs. i hånden | S&S: gribes over skulder, indhold som grid (ikke fysisk); Till Dawn: i hånden; Zombie Army: flydende menu (kritiseret). | [V] |
| Fysisk vs. slotbaseret | Slotbaseret med fast antal dominerer; fysisk rod i hovedrum giver klager (overlap/targeting). | [V] |
| Tab af genstande | Løse ting og base-lager kan forsvinde; "returnerer automatisk" er modtræk. | [V] |
| Kapacitet | Flade slots (27→36) vs. ikke-grid + encumbrance-grænse. | [V] |
| Hurtig adgang | Bælte/bryst/skulder til hurtige ting; rygsæk til bulk. | [V] |
| Tilgængelighed | Siddende bælter dokumenteret problem; justerbare slots anbefales; venstrehånds-holster er brugerønske. Ingen standard fundet. | [V]/[?] |
| Komfort | Hånd over skulder er kendt men kræver præcis zone; chest-pouch der suger ved nærhed irriterer. | [V] |
| Klager | Finicky grebspunkter; magasin falder ved skulder-slip; uklar skulder; delvise magasiner afvist; akavet siddende; ting bag ryggen; forsvundne verdensting; slots flytter sig når kroppen drejer. | [V] |

### 2.3 Vurdering [S]
- **Slotbaseret kerne + valgfri fysisk visning** giver det spillere roser (hurtig, forudsigelig adgang) uden det de klager over (overlappende rod, upræcis targeting).
- **Ingen læst kilde viser en fuld tag-af/hold/åbn/sæt-på-rygsæk i et udgivet spil.** Det er en differentiator, men en *ukendt* i komfort og indlæring. Brug Till Dawns "kald til hånd" og Into the Radius' "returnerer automatisk" som sikkerhedsnet.
- **Modtræk mod klagerne:** tilgivende zoner med hysterese, tydelig feedback, auto-retur/"tab ikke noget"-regel, justerbar placering, venstre/højre-spejling, og slots der følger **hofte/ryg-løsning** og ikke kun headset-yaw.

---

## 3. Del 3 — designforslag

### 3.1 Samlet arkitektur

```
        ┌──────────────────────────────────────────────────────────┐
        │  KERNE (engine-uafhængig datamodel + regler)              │
        │  states, rules, capacity, policies, checkpoint v2, events │
        │  Kontrakt: extensions/backpack/data/*.data.json + golden  │
        └───────────────▲──────────────────────────▲───────────────┘
                        │ samme regler/golden       │
        ┌───────────────┴──────────┐   ┌───────────┴───────────────┐
        │ three.js: extensions/    │   │ Godot: addons/gs_backpack │
        │ backpack/ (JS = kilden)  │   │ (udvid; bevar API)        │
        └───────────────▲──────────┘   └───────────▲───────────────┘
   adaptere: BodyAnchor · Inventory · Input · Audio · Physics · Checkpoint
```

**Principper** (GameSystems-praksis [V]; anvendelse [S])
- **Tilføjelse, ikke erstatning.** `GSBackpackApproach`, `GSBackpackHandlePull`, `GSBackpackInteraction`, `NightfallGearInventory` og adapteren bevares (offentlige metoder, signaler, checkpoint v1). Nye klasser ved siden af.
- **Opt-in.** Intet sker før spillet kalder `configure(profile)`; ingen autoload, ingen egen per-frame polling.
- **Billigt og tiers.** `minimal|low|mid|high`, eventdrevet, ingen allokering i hot-path (jf. brugerens præference for skiftbare realisme-tiers og billige systemer).
- **Én sandhed pr. ting.** Ledgeren ejer *hvor* en genstand er; spilobjektet ejer dens tilstand. Tasken ejer sig selv (tilstand, ejer, pose) via `BackpackState`.

**Kerne indeholder [S]**
1. `BackpackProfile` (data): mål, håndtag/sidegreb i taske-lokal ramme, åbningsvolumen, remmepunkter, slot-liste pr. container (indre/ydre), tier-tabel, tomvægt, tærskler (frigørelse, retur, tab), `dominant_hand`, `loss_policy`.
2. `BackpackState` (ren): tilstandsmaskine (3.2), regler (`canDraw/canRelease/canPlace/canDon`, `onTrackingLost`, `onCheckpoint`), events.
3. `CapacityModel`: kategori+størrelse (samme `_fits`), plus valgfri `stackable`/`weight_limit` pr. tier.
4. Schema `gamesystems.backpack.v1`, checkpoint v2.

**three.js `extensions/backpack/`** (efter `extension(id, create, options, connect)`): `state.js`, `rules.js`, `approach.js` (JS er kilden for tallene), `pull.js`, `inventory.js` (JS-ledger), `index.js`, `data/backpack.data.json`, golden-filer.
**Godot `gs_backpack`:** nye `gs_backpack_state.gd`, `gs_backpack_profile.gd`, `gs_backpack_data.gd` (læser kontrakten, som `gs_grasp_data`), `gs_backpack_body_anchor.gd` (interface), `gs_backpack_detach.gd` (adapteren der flytter noder). De tre eksisterende scripts forbliver.

**Adapter-interfaces** (ens i JS/GDScript; kun BodyAnchor er obligatorisk):

| Interface | Metoder (forslag) | Standard |
|---|---|---|
| `BodyAnchorProvider` | `wornPose(side)`, `strapPoints()`, `shoulderHeight()`, `bodyFrame()`, `posture()` (standing/crouch/seated), `handedness()` | JS: afledt af `vrik.joints`; Godot: `get_gear_anchor("holster"/"magazine")`; fallback hoved-yaw+højde |
| `InventoryProvider` | `canStore/store/retrieve/transfer`, `itemsIn(container)`, `capture/prepareRestore` | JS: ny ledger-port; Godot: tynd wrapper om scene-adapteren |
| `InputProvider` | `hand(side)→{pose,tracked,grip,interact}`, `fresh(side)` | Spillets actions |
| `AudioHook` | `event(name,{pos,material,intensity})` | JS: `audio.grab/release/contact`; Godot: `audio_bus` |
| `PhysicsHook` | `holdBag`, `releaseBag(vel)`, `spawnContents`, `sweepVolume` | JS: `host/physics.js`-adapter; Godot: `PhysicsDirectSpaceState3D` |
| `CheckpointProvider` | `capture()/prepareRestore()` | JS: `createCheckpointSystem`; Godot: udvid checkpoint i `player.gd` |

### 3.2 Tilstandsmaskine [S]

```
WORN ──grip ved håndtag + træk──▶ DRAWING (guidet, gummibånd ≤0,20 m)
  ▲                                   │ frigør (tærskel + holdt greb)      │ slip/tracking-tab
  │                                   ▼                                    ▼
  │                             HELD_CLOSED ──(åbn: 2. hånd/klap)──▶ HELD_OPEN    (tilbage til WORN)
  │                                   │  ▲                              │
  │                                   │  └──────────(luk)───────────────┘
  │   DON (bag-zone + dwell)          │ slip på overflade
  │                                   ▼
  └────────── RETURNING ◀──────── PLACED (gulv/bord)
               ▲  auto-retur: afstand/tid/tab
```

| Tilstand | Posen ejes af | Taskens ejer | Indhold |
|---|---|---|---|
| WORN | krop (`BodyAnchorProvider`) | `worn` | slots på rig som i dag |
| DRAWING | krop + hånd-offset ≤0,20 m | `worn` | uændret; lommer utilgængelige |
| HELD_CLOSED | hånd(er) | `hand:left\|right\|both` | frosset |
| HELD_OPEN | hånd(er), åbning mod hovedet | `hand:*` | afhænger af tier (3.4) |
| PLACED | verden (kinematisk/rigid) | `world` | frosset eller fysisk (tier) |
| RETURNING | animation mod worn-anker | `in_transit`, derefter `worn` | frosset |

**Regler**
- **Atomicitet:** hver overgang er transaktion med rollback (adapterens `_busy`-mønster). Ledger-ejerskab af *genstande* ændres aldrig fordi tasken skifter tilstand — kun *containerens* ejer/pose. Hovedsikringen mod tab.
- **Frigørelse DRAWING→HELD:** holdt greb + offset ≥0,18 m i ≥150 ms (eller hastighed udad) + fri vej (volumen-sweep) + ingen aktiv våbenovergang. Under tærsklen er nuværende gummibånd uændret; haptisk klik ved tærsklen.
- **Don:** tasken bringes til bag-zonen (spejlvendt `GSBackpackApproach`-geometri) med ~0,5 s dwell og hysterese; slip tæt på ryggen → snap-on (`RETURNING`).
- **Auto-retur:** slip >X m fra kroppen og ikke på stabil overflade, eller T sekunder uden hånd/tracking → `RETURNING` (Into the Radius-præcedens [V]).
- **Tracking-tab:** i `DRAWING` annuller og returnér (som i dag, `gs_backpack_handle_pull.gd:29-31`); i `HELD_*` hold tasken frosset og kropsrelativ i en grace (~1,0-1,5 s), så `RETURNING`. Aldrig drop i tom luft ved tab.
- **Død/checkpoint:** default efter genstart er `WORN`; `PLACED` kun med gyldig verdenspose; `loss_policy: never|on_death_drop|on_death_lose`, standard **`never`** (tab er spilmekanik, ikke default).
- **Genstande er ledger-ejede** (lommer) så længe tasken er lukket eller tier ≤ `mid`. I `high` kan *synlige* genstande i åben taske være fysiske, men **ledgeren er sandheden**: en genstand har først forladt tasken når `retrieve→world` er committet.

### 3.3 Mounts vs. selve tasken [S]
Hofte-/back-mounts hænger i dag på rigen (`backpack_rig.gd:42-52`). Når tasken kan tages af, skal **bælte-/skulder-mounts høre til et `BodyMounts`-lag** (ledger-slots uden taske-container), mens tasken har egne indre/ydre slots.
Våben/magasiner på hoften forsvinder så ikke når tasken er af; `back` (langt våben) er konfigurerbar (taske eller krop), standard i Nightfall = **krop**, så sling/våbenflows ikke brydes.
Kræver ingen ledger-ændring, kun flytning af ankerknudepunkter (`register_slot` tager vilkårligt anker).

### 3.4 "Åbn i luften", indhold, vægt, lyd, tiers [S]

**To hænder og åbning.** Tasken har `carry_handle` (primær) og `side_grip`/`bottom_support` (sekundær). Genbrug `two_hand.js`/`two_hand.data.json` (`pickSecondary`, `solveTwoHand`, `secondaryHeld`, `releasedTogether`) og Godot-ækvivalenten via `gs_grasp`. Åbning: sekundær hånd trækker klap/lynlås (JS: `mechanics` `hinge`/`slider`; Godot: lille tilstand) eller "tryk-og-træk"; åbningsfraktion er taskens tilstand.
"Se indhold ovenfra": tasken orienteres så åbningens normal peger mod hovedet (let ease, begrænset vinkel, aldrig kamera-låst); en `access_volume` over åbningen definerer hvor lommer/genstande kan gribes.

**Vægt** (`weight_lag.js`, `held_drive.js`): masse = tom + sum(indhold) (kosmetisk skala). `high/mid`: `maxOffset/lagTarget` giver håndlag, `elbowHintOf` styrer albuer, to hænder halverer lag (`holdForce(2)`). `low/minimal`: intet lag, kun valgfri haptik.

**Lyd** (`audio.grab/release/contact`): `bag_strap_grab`, `bag_unzip`, `bag_clasp`, `bag_set_down` (materialeafhængig via `contact`), `item_rustle`. `sound_materials.json` genbruges til stof/læder.

| Tier | Taske | Åbn | Indhold | Fysik |
|---|---|---|---|---|
| `minimal` | Ingen afmonteret tilstand; eksisterende rig (WORN + guidet træk) | Håndtag som i dag | Ledger-slots, labels | Ingen |
| `low` | Afmonteret som kinematisk objekt (hænder/PLACED); intet vægtlag | Enkel åbn/luk-tilstand | Lommer (ét objekt/slot) | Ingen |
| `mid` | + to-hånds, vægtlag, tracking-grace | Klap/lynlås (hinge/slider) | Lommer + ydre slots; synlige *proxyer* pr. slot, kollisionsløse | Kun tasken (kinematisk + volumen-sweep) |
| `high` | + fysisk åben taske | Fuld gestus | Op til N (fx 8-12) **ægte** kroppe i afgrænset åben volumen; resten proxyer | Rigids kun i `HELD_OPEN`/`PLACED_OPEN` og nær spilleren; budget + `sleeping` ved lukning |

### 3.5 Integration med IKVR/VRIK-avataren [S, hvor ikke andet er markeret]

**Forankring: ryg/hofteben, ikke hovedet.**
- Primært anker **hofte→ryg** (hips-/spine-led) med bagudrettet offset, så tasken følger kropsløsningen (bøjning, crouch, sæde) og ikke blot hovedets yaw. Godot har det: `get_gear_anchor("holster")` og `"magazine"` [V]. JS: udledes af `vrik.joints.hips/spine/chest` [V: leddene findes, ankrene findes ikke].
- Adresserer Contractors-klagen om positioner der flytter sig når kroppen ikke er låst til headset ([14], [V] som klage; løsningen [S]).
- Sekundært: remmepunkter ved skuldrene (kosmetisk) — remmene tegnes på ryggen og strækkes ved Drawing (ingen geometri-sim).

**Arme ved træk over skulder.** `DRAWING` bruger kun den eksisterende guidede bevægelse (hånden er sandheden, albuen et estimat, jf. `docs/vr/ik_avatar.md`). `mid/high`: elbow hint bagud/op for trækarmen (JS `setElbowHint`, `vrik.js:149`; Godot-ækvivalent). Efter frigørelse overtager normalt grasp-greb (`closure`/`catalog`) med et taske-tilpasset greb.
**Tiers:** `minimal` ingen armændring; `low` intet albue-hint; `mid` albue-hint + strop-visning; `high` remme følger skulder/arm, subtil torso-lean ved tung taske.

**Siddende/crouch.** `BodyAnchorProvider.posture()` (JS `body_height` `seated`; Godot `_seated_gear`, `operator_body.gd:329-336`). Siddende: anker ved ryglæn/siden og **draw-zonen flyttes til en nåbar zone** (ved siden af skulderen/under armen); standard-gestus *kald til hånden* (Till Dawn-mønstret [V]). Crouch sænker anker og skalerer zoner. Mixed News' klage om siddende bælter [V] gør dette til krav.
**Venstrehåndet.** `handedness()` spejler zoner/offsets (approach er allerede side-symmetrisk, `gs_backpack_approach.gd:44`, `:61` [V]); profilen får `dominant_hand`, og træk-/åbnehånd kan byttes.

### 3.6 JSON-kontrakt og golden-vektorer [S efter eksisterende praksis [V]]
- `extensions/backpack/data/backpack.data.json` (`gamesystems.backpack.v1`): tærskler (release, deadzone, maxPull, trackingGraceS, autoReturnDistance, donDwellS, hysteresis), tier-tabeller, approach-konstanter (flyttes fra de hårdkodede GDScript-konstanter), standardprofil.
- JS er kilde; `godot/tools/gen_golden.mjs` udvides med `backpack_state_golden.mjs`: sekvenser af (tilstand, input) → forventet (tilstand, events), approach/pull-vektorer (de nuværende GDScript-tests har tallene), checkpoint-roundtrip v1→v2.
- Godot-læser `GSBackpackData` (som `GSGraspClosureData`) + test mod `*.golden.json`; `gen_golden.mjs --check` fanger drift; `sync_addons.py` synkroniserer til spil [V].

---

## 4. Opt-in, test, risici

**Opt-in [S]**
1. Intet ændres for eksisterende spil: kernen kaldes kun hvis `profile.detachable == true` **og** tier ≥ `low`.
2. `BackpackProfile` indlæses af spillet; Nightfall får `nightfall_field_pack.profile.json` med nuværende mål.
3. Feature-flag: Godot `@export var enable_detachable_backpack := false` ved siden af `enable_backpack_loadout := false` (`player.gd:27`); three.js `?backpack=low|mid|high` (som `?quality`/`?bottles` i headset-labben).
4. Alle eksisterende tests er uændrede og skal være grønne i hver fase (gate).

**Test [S]**
- **Golden/kontrakt:** JS→JSON→Godot; `gen_golden.mjs --check`.
- **Headless Godot:** nye `gs_backpack_state_tests.gd` (tilstandsmaskine, rollback, tracking-tab, checkpoint-roundtrip) og `gs_backpack_detach_tests.gd` (atomisk reparent, ingen genstand mistes, ejer-invariant); Nightfalls ni backpack-suiter som regression (kommandoer: `godot/tests/README.md`).
- **Headless JS:** node-tests for kerne+golden; three.js-integration via `webxr-test`-skill.
- **Syntetisk XR:** scriptede håndbaner (træk→frigør→hold→åbn→luk→sæt-på) i Godot-replay (`docs/VR_REPLAY.md` findes) og i `tools/headset-lab`.
- **Hub-test til Quest 3:** nye poster i `tools/headset-lab/hub/tests.js` (mønstret [V]): `backpack-traek`, `-afmonter`, `-aabn`, `-paa`, `-sidende`, `-venstre`, `-perf` med `?backpack=low|mid|high`; resultater i `docs/headset_results.jsonl` (`virker|fejl|delvist`) [V: format].
- **Hardware-accept:** læsbarhed, rækkevidde, komfort (arm-træthed ved at holde en taske foran sig), frame pacing — markeres uprøvet indtil målt (backlog-regel [V]).

**Risici [S]**

| Risiko | Konsekvens | Afbødning |
|---|---|---|
| Ejerskabs-/reparent-fejl ved afmontering | tab/strandede ting | Container-ejer adskilt fra item-ejer; transaktion+rollback; invariant-test "hver genstand har præcis én ejer" |
| Dobbelt autoritet med `player.gd` våben-/sling-flows | våbenregressioner | BodyMounts-adskillelse; Nightfalls 9 suiter som gate |
| Rig overskriver posen (`_process`) | taske "klistrer" | Pose-ejer-flag; ét sted skriver `global_transform` |
| Sweep antager kropsforankret pose | tasken gennem vægge | Generalisér sweep til verdenspose; behold 15 mm/12 mm trin |
| Armtræthed ved at holde taske frem | komfortklager | Hvile mod bryst/mave, let PLACED, evt. let vægtlag |
| Tracking-tab i HELD | uventet drop | Grace + RETURNING; aldrig fysisk drop i `low/mid` |
| Quest-ydelse i `high` | frame drops | Rigids kun åben+nær, N-loft, sleeping; mål på hub |
| Ukendt mønster, ingen præcedens fundet | indlæringskurve | Tutorial-prompt, "kald til hånd", auto-retur |
| Lighed med andre spils assets | juridisk | Kun mekanik-mønstre, egne assets (BlenderShared) |

---

## 5. Åbne spørgsmål til brugeren

1. Skal tasken kunne **tabes/efterlades** i verdenen som spilmekanik (`loss_policy`), eller er "afmonteret" kun en visningstilstand med auto-retur? (Påvirker checkpoint-format og risiko mest.)
2. Hvad sker med hofte-/skulder-mounts (våben, magasiner) når tasken er af? Anbefalet: de hører til kroppen og bliver. OK for Nightfall?
3. Hvor præcis skal "åbn i luften" være: (a) slot-/panelvisning ovenfra, (b) rigtige fysiske genstande man griber i åbningen, eller begge pr. tier? (b) kræver N og fysikbudget på Quest.
4. Hvilken motor først? Jeg anbefaler kerne+kontrakt, så Godot-afmonteret, så three.js (afsnit 6). Er det i orden at three.js først får kerne+approach?
5. Siddende: er *kald tasken til hånden* acceptabel som standard-gestus siddende? Skal der være en indstilling?
6. Dominant-hånd/spejling i profilen fra første fase, eller senere?
7. Kapacitet: flade slots (som S&S) eller størrelse/vægtgrænse? Skal små ting stakkes?
8. Må nye input-actions (fx "kald taske") tilføjes i OpenXR-action-map, eller er Frame/Touch-mapping låst?
9. Skal three.js-biblioteket være selvstændigt (egen JS-ledger) eller en tynd adapter til Nightfalls WebXR-spil, som endnu ikke har inventory?
10. Må `NightfallGearInventory` få et additivt `container`-begreb (checkpoint v2 accepterer v1), eller skal backpack-laget have egen container-ledger ovenpå uden at røre den?

---

## 6. Anbefalet rækkefølge og faseplan

### 6.1 three.js eller Godot-afmonteret først? [S]

**Anbefaling: kerne + kontrakt først (ingen motor), derefter Godot-afmonteret som første gameplay-fase, derefter three.js-port.**

For Godot først:
- Byggeklodserne til de svære dele findes og er testet i Godot [V]: ledger (59 checks), scene-adapter (82), atomisk reparent med rollback, approach/pull, kollisionssweep, checkpoint-restore, 448 backpack-checks. Største risiko (ejerskab ved afmontering) ligger hvor primitiverne er.
- three.js mangler ledger, slots og container; at bygge afmonterings-gameplay dér først ville betyde at bygge ledger+adapter+kerne uden golden.
- Nightfall Godot har allerede en fungerende taske og headset-testflow; feedback er hurtigst dér.
- Kerne+golden først lader three.js portere mod faste vektorer (grasp-mønstret [V]).

Mod three.js først: manglende ledger, mere nyt, mindre testdækning. Men three.js er hurtigere at prototype visuelt, så en tynd JS-prototype af *tilstandsmaskinen* i P0 er billig og fanger regelfejl tidligt.

### 6.2 Faser

Størrelse: S ≈ ½-1 dag, M ≈ 2-3 dage, L ≈ 4-6 dage, XL ≈ 1-2 uger (agent-/udviklertid uden hardwaretest). [S: grove skøn]

| Fase | Indhold | Afleveres som | Test | Str. |
|---|---|---|---|---|
| **P0 Kontrakt og kerne (JS)** | `extensions/backpack/` skelet; `BackpackProfile`; `BackpackState` (tilstand+regler, ingen scene); `backpack.data.json` (tærskler flyttes fra GDScript); golden for approach/pull/tilstandsmaskine; `gen_golden`-udvidelse | Ren JS-pakke + golden | node-tests; `gen_golden --check` | M |
| **P1 Godot-læser og paritet** | `GSBackpackData` + `gs_backpack_state.gd`; tests mod golden; eksisterende scripts uændrede (paritetstest) | Opdateret addon + tests | `gs_backpack_*_tests.gd`, 3 gamle suiter | M |
| **P2 Container-udvidelse** | Additivt `container`/container-ejer (eller wrapper), checkpoint v2 (accepterer v1); adapter flytter container som nodegruppe med rollback | Addon-ændring + tests | Ledger/adapter-tests (59/82) + nye invarianter | L |
| **P3 BodyMounts (Nightfall)** | Flyt hofte/back-ankre ud af rig; ingen adfærdsændring | Nightfall-ændring bag test | Nightfalls 9 suiter + våben/sling-regression | M |
| **P4 WORN→DRAWING→HELD_CLOSED→WORN (Godot, `low`)** | Pose-ejer-flag; frigørelse; to-hånds greb; don-zone; auto-retur; tracking-grace; ingen åbning | Flag `enable_detachable_backpack` | Headless + replay; **første hub/headset-test** | XL |
| **P5 HELD_OPEN + PLACED (Godot, `low/mid`)** | Åbn/luk som tilstand; `access_volume`; lommer ovenfra; vægtlag; lyd; PLACED; checkpoint af PLACED | Samme flag, flere tiers | Headless + headset (`-aabn`, `-perf`) | XL |
| **P6 `high`: fysiske genstande (Godot)** | N rigids i åben volumen; budget/sleeping; ledger forbliver sandhed | Tier `high` | Quest-perf; invariant "ingen genstand i to ejere" | L |
| **P7 three.js kerne + ledger** | JS-ledger, adapter-interfaces, checkpoint-provider; golden grøn | Ny extension | node + `webxr-test` | L |
| **P8 three.js afmonteret (`low→mid`)** | Interaktion på `vrik.joints`; to-hånds fra `grasp`; `mechanics`-hinge; audio; headset-lab-poster | Extension + demo i `webxr-demo` | `webxr-test`, hub (Quest 3) | XL |
| **P9 Tilgængelighed og polish** | Siddende zoner, venstrehånd, justerbare slots, tutorial, tuning | Indstillinger + profiler | Hub `-sidende`, `-venstre` | M-L |

**Afhængigheder:** P0→P1→P2→P3→P4→P5→P6; P7 kan starte efter P1 (parallelt med P2-P3); P8 efter P5 og P7; P9 løbende (zoner kan startes i P4).
**Alternativ [S]:** vil du have en tidlig følbar prototype, kan P4 laves som en 2-dages Godot-spike uden P2/P3 for at teste gestussen i headset, og først derefter bygge fundamentet. Mere omarbejde, men afklarer komfortspørgsmålet (hold taske foran dig) hurtigt.

---

## 7. Kildeliste

Interne filer (under `C:\Devstuff\GameDev\`):
- `GameSystems/godot/addons/gs_backpack/{gs_backpack_approach.gd, gs_backpack_handle_pull.gd, gs_backpack_interaction.gd, README.md, tests/*}`
- `GameSystems/godot/addons/gs_gear_inventory/{gs_gear_inventory.gd, gs_gear_inventory_scene_adapter.gd, README.md}`; `gs_weapon_loadout/*`; `gs_weapon_catalog/*`
- `GameSystems/docs/{improvement_backlog.md (l.1078-1112, 1758-1780), godot_port_plan.md, headset_testlab.md, ikvr_implementation.md}`, `docs/vr/ik_avatar.md`
- `GameSystems/godot/tests/README.md`, `GameSystems/godot/tools/gen_golden.mjs`
- `GameSystems/extensions/{host/system.js, host/state.js, host/physics.js, checkpoint/index.js, grasp/*, avatar/*, audio/system.js, mechanics/index.js, bottles/*}`
- `GameSystems/webxr-demo/src/{pistol.js, interaction.js}`; `NightfallContractsWebXR-interaction/src/weapons/interaction.js`
- `NightfallContractsGodot/runtime/{backpack_rig.gd, player.gd, game.gd}`; `addons/nightfall_characters/operator_body.gd`; `docs/{backpack_runtime.md, vr_backpack_weapon_system.md}`

Eksterne kilder (læst/forsøgt 2026-10-23; nr. som i teksten):
1. WorthPlaying, PS VR-anmeldelse af S&S — https://worthplaying.com/article/2020/6/8/reviews/119907-ps-vr-review-the-walking-dead-saints-sinners/ (via søgeresultat)
2. Steam, S&S rygsæk-slots (27→36) — https://steamcommunity.com/app/916840/discussions/2/1750148267248611273 (læst)
3. Road to VR, Cas & Chary S&S Gameplay Overview — https://www.roadtovr.com/cas-chary-present-walking-dead-saints-sinners-gameplay-overview/ (læst)
4. Destructoid, S&S-anmeldelse — https://www.destructoid.com/review-the-walking-dead-saints-sinners/ (kun via søgeresultat)
5. Steam, S&S sider i rygsæk — https://steamcommunity.com/app/916840/discussions/0/2152098589074670835 (kun via søgeresultat, ikke brugt som [V])
6. PCGamesN, Alyx VR-design — https://www.pcgamesn.com/half-life-alyx/vr-design (læst)
7. Steam, Alyx over-skulder-tråd — https://steamcommunity.com/app/546560/discussions/0/1861616237338760303 (læst)
8. Gamepretty, Into the Radius VR Survival Guide — https://gamepretty.com/into-the-radius-vr-the-survival-guide/ (læst)
9. Mixed News, Into the Radius VR — https://mixed-news.com/en/into-the-radius-vr-thrilling-survival-in-the-ethereal-world/ (læst)
10. Thumbculture, Into the Radius 2 preview — https://www.thumbculture.co.uk/into-the-radius-2-pcvr-preview (læst)
11. Steam, Into the Radius VR lager — https://steamcommunity.com/app/1012790/discussions/0/4403925145416248507 (kun via søgeresultat)
12. Thunderstore, HolsterResizer (Bonelab) — https://thunderstore.io/c/bonelab/p/Toedtmanns/HolsterResizer/required (kun via søgeresultat)
13. Steam, Blade & Sorcery quiver — https://steamcommunity.com/app/629730/discussions/2/1743356517527795093 (kun via søgeresultat)
14. Steam, Contractors VR — https://steamcommunity.com/app/963930/discussions/0/5792223132453011488 (kun via søgeresultat)
15. BetaHub feature requests — https://app.betahub.io/projects/pr-7682550116/feature_requests/690 (kun via søgeresultat)
16. Road to VR, HIGGS VR — https://roadtovr.com/skyrim-vr-mod-higgsvr-hand-gravity-gloves/ (kun via søgeresultat)
17. Nexus Mods, Skyrim VRIK — https://nexusmods.com/skyrimspecialedition/mods/23416 (kun via søgeresultat)
18. UploadVR, Zombie Army VR — https://www.uploadvr.com/zombie-army-vr-review/ (kun via søgeresultat)
19. The Sixth Axis, Zombie Army VR — https://www.thesixthaxis.com/2025/06/20/zombie-army-vr-review/ (kun via søgeresultat)
20. Road to VR, Arizona Sunshine 2 — https://www.roadtovr.com/arizona-sunshine-2-review-quest-pc-vr-psvr-2/ (kun via søgeresultat)
21. Till Dawn devlog — https://devplayrepeat.itch.io/tilldawn/devlog/18799/introducing-the-brand-new-inventory-system-and-holster (læst)
22. arXiv:2107.08434, taksonomi af VR-inventories — https://arxiv.org/abs/2107.08434 (kun abstract)
23. Game Developer, Intuitive inventory systems in VR games — https://gamedeveloper.com/design/intuitive-inventory-systems-in-vr-games (læst)
24. Samme paper som PDF (citat via søgeresultat; PDF-hentning gav kun metadata) — https://arxiv.org/pdf/2107.08434

**Ikke verificeret:** hvordan S&S' taske præcist åbner foran kroppen; Bonelab/Boneworks bodylog; Blade & Sorcery holsters; Contractors/Pavlov holster-opsætning; Resident Evil 4 VR-inventory; fysisk afmonterbar rygsæk i Skyrim/Fallout 4 VR; enhver komfortmåling for at holde en taske foran sig. Afklares ved at spille/se optagelser eller dybere kildegennemgang før P5 låses.

---

## 8. Status: P0 og P1 leveret (2026-10-24)

Brugerens beslutninger lagt til grund: (1) rygsækken kan aldrig gå tabt (`lossPolicy` kan kun være `never`, der findes ingen LOST-tilstand);
(2) hofte-/skuldermounts til våben og magasiner bliver på kroppen når tasken er af; (3) "åben i luften" = rigtige genstande med hånden på `high`,
`low` viser slots ovenfra uden fysik; (4) siddende spillere kan kalde tasken til hånden (valgfrit, `recall.seated`); (5) backpack-laget er et NYT lag oven på
`NightfallGearInventory`; eksisterende inventory og checkpoint-format er uændrede.

**P0, JS-kerne** i `extensions/backpack/` (ren logik, ingen three-afhængighed, grænsetest: `backpack: ['host']`, PURE):
`profile.js` (validator), `state.js` (WORN, DRAWING, HELD_CLOSED, HELD_OPEN, PLACED, RETURNING med ejer worn/hand/world/in_transit, tracking-grace 1,25 s,
slip uden stabil flade giver RETURNING, don-zone med hysterese, auto-retur, JSON-checkpoint der kun gemmer WORN/PLACED), `ledger.js` (container-ledger oven på
injiceret inventory-provider; atomisk store/retrieve/move/storeAll med rollback; afvisningsgrunde UNKNOWN_POCKET, NOT_ACCESSIBLE, UNKNOWN_ITEM, NOT_OWNED, INVALID_SIZE,
WRONG_ITEM, TOO_LARGE, FULL samt PROVIDER_REJECTED, EMPTY, NOT_FOUND), `approach.js`/`pull.js` (linje-for-linje porte af GSBackpackApproach/GSBackpackHandlePull; kilder
står i `data/backpack.data.json`), `adapters.js` (bodyAnchor, inventory, input, audio), `index.js` (host-extension med 5 tiers). JSON-kontrakt: `data/profile.schema.json`,
`data/profile.example.json` (field_pack: 7 lommer, 4 i tasken og 3 kropsmounts), `data/backpack.data.json`, `data/backpack.golden.json`.

**P1, Godot** (kun additive filer i `godot/addons/gs_backpack/`): `gs_backpack_profile.gd`, `gs_backpack_state.gd` (genbruger den uændrede GSBackpackHandlePull),
`data/` (byte-identiske kopier af kontraktfilerne, `gen_golden.mjs` skriver og `--check` verificerer) og `tests/gs_backpack_parity_tests.gd`.

**Tal.** 89 golden-vektorer (approach 15, pull 9, state 24, profilvalidering 41) med 1573 trin; Godot headless og node giver identiske resultater (tolerance 1e-7):
`node extensions/backpack/tools/parity.mjs` giver "89 vectors, 1573 ops, 0 differences". En bevidst ændret golden-kopi blev fanget. Nye node-tests: 26 (`webxr-demo/tests/backpack.test.js`);
`webxr-demo npm test` 833 før, 859 efter, alle grønne; grasp-studio 27/27; headset-lab 7/7. Godot: gs_backpack_tests 34 checks, interaction 10, parity 183, gear_inventory 59 og scene_adapter 82, weapon_loadout 30, alle uden fejl.
Ingen eksisterende filer er ændret ud over `webxr-demo/tests/extension-boundaries.test.js` (backpack tilføjet). Intet er committet.

**Afvigelser fra designet.** (a) Ledger'en er kun i JS; Godot-porten er udskudt til P2 (ledger/adapter-arbejdet), så paritet dækker approach, pull, profil og tilstandsmaskine. (b) Container er et lag af
navngivne provider-slots `<profil>/<lomme>/<i>`, ikke en ny ejertype i inventory; `inventory` er en injiceret adapter, og `createMemoryInventory` er kun referenceprovider. (c) Faste konstanter
(0,16 m rækkevidde, 3,5 cm dødzone, 0,20 m max) flyttet til data-filen, men GDScript-konstanterne er urørt; paritetstesten kræver at de er ens. (d) Checkpoint gemmer bevidst kun WORN eller PLACED; mellemtilstande genoprettes som WORN. (e) Tracking-tab i HELD fryser i 1,25 s og sender derefter til RETURNING, aldrig et drop.

**Hvad P2 kræver.** Godot-port af container-ledgeren oven på `NightfallGearInventory` (additivt wrapper-lag, checkpoint v2 der accepterer v1) med rollback-tests mod golden-ledgervektorer (ledger-vektorer findes endnu ikke i golden, kun i node-tests);
scene-adapter der flytter containeren som nodegruppe med atomisk rollback; derefter P3 (BodyMounts i Nightfall) før gameplay-faserne. Ikke afprøvet i headset.
