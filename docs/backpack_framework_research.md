# Backpack — framework- og toolkit-research (ikke enkeltspil)

Status: **research, ingen kode**. Skrevet 2026-10-24 som supplement til `backpack_system_design.md` (som ikke er rørt).
Spilresearchen dér var tynd; her er det **frameworks, toolkits, plugins og open source-projekter** der har en form for krops-/rygsækslagring.

Konvention (som i designdokumentet):

- **[V]** = verificeret: jeg har selv læst kilden (kode, docs, repo-træ, forumpost); URL står ved påstanden.
- **[S]** = vurdering/slutning fra min side.
- **[?]** = ikke fundet / ikke verificeret. Står bevidst åbent.
- **[V-søg]** = kun set i et søgeresultat-uddrag, selve siden ikke læst. Svagere end [V].

Metode: GitHub-repoer er læst direkte via træ-API og `raw.githubusercontent.com` (filnavne og kildekode). Unity Asset Store-sider er JS-sider; kun metadata (pris, version, udgiver) kunne læses der, så feature-lister er hentet fra udgiverens side/forum hvor muligt.

---

## 0. Kort konklusion

1. **[V] Ingen framework/toolkit/plugin har en afmonterbar rygsæk som genbrugelig komponent.** Men (**opdateret efter opfølgning, afsnit 1.11**) det open source-*spil/mod* **Gothic Unity VR** (GPL-3.0, bygget på Hurricane VR) har en rygsæk der tages af en skulder-socket, holdes i hånden, viser indholdet som fysiske genstande i 9 sockets pr. side med kategori-faner, og sættes tilbage i skulder-socketen (`VRBackpack.cs`). Så "findes ikke" er ikke helt rigtigt: mønstret er *bygget og i kode*, men som spil-specifik kode under GPL (kun idéer) og med kendte fejl (issue #319). Differentiatoren er derfor *en genbrugelig, testet, motor-uafhængig kerne*, ikke selve gestussen.
2. **[V] Det tætteste er Hurricane VR:** deres Socket-dokumentation siger at "shoulder socket" på demo-rigene *holder rygsækken* via et `HVRGrabbableSocketFilter` (rygsækken er altså en **gribbar ting der sidder i en skulder-socket**), og at inventory-sockets er bygget til at ligne *Saints & Sinners*. Rygsækkens indre (egne sockets, åbning i hånden) er **[?]** — ikke beskrevet i docs jeg kunne læse. Se 1.4.
3. **[V] Alle frameworks løser kropslagring på samme måde: *snap zone / socket / anchor* som er et barn af en krops-transform**, med filter (kategori/tag), hover-feedback, events og evt. auto-retur. Ingen af dem har et *container*-begreb (taske der ejer slots) — det har vi allerede delvist i ledgeren og skal selv bygge (container-ejer).
4. **[V] Det genbrugbare er mønstre, ikke kode:** UltimateXR (MIT) og Godot XR Tools (MIT) må vi låne kode/idéer fra med copyright-notits; Hurricane, VRIF, Auto Hand, Immersive VR Inventory er kommercielle Asset Store-pakker (kun idéer).
5. **[S] Anbefaling: mulighed C — hybrid med tiers, hvor "WORN" modelleres som "taske-objekt snappet i en krops-mount-socket"** (Hurricane-mønstret), så tilstandsmaskinen fra designdokumentet (WORN/DRAWING/HELD/PLACED/RETURNING) bliver en tynd overbygning på kendte snap-zone-primitiver, og lav-tier (A) og summon (D) er delmængder af samme model. Se afsnit 3-4.

---

## 1. Pr. framework

### 1.1 UltimateXR (VRMADA, Unity) — **ingen rygsæk/inventory, men et rent anker-API**

- Licens: **MIT** [V] — https://github.com/VRMADA/ultimatexr-unity (README + `LICENSE`, "Copyright (c) 2022 VRMADA").
- README's feature-liste: precision interaction, hand pose editor, locomotion, haptics, full-body IK-avatarer ("legs IK coming soon"), networking i v1.0.0-branchen. **Nævner ikke anchors, inventory, holster eller backpack** [V] https://github.com/VRMADA/ultimatexr-unity.
- Repo-træ (alle 3898 stier gennemsøgt for `anchor|inventory|holster|backpack|snap|socket`) [V] https://api.github.com/repos/VRMADA/ultimatexr-unity/git/trees/HEAD?recursive=1:
  - Findes: `Runtime/Scripts/Manipulation/UxrGrabbableObjectAnchor.cs`, `UxrGrabbableObjectSnapTransform.cs`, `UxrSnapToAnchorMode.cs`, `UxrSnapToHandMode.cs`, `UxrSnapReference.cs`, `UxrGrabManager.GrabbableObjectAnchorInfo.cs`.
  - Findes **ikke**: nogen fil med `inventory`, `holster` eller `backpack`.
  - Samples (`Samples~/FullScene`, `Samples~/Input`) indeholder kun lab-/døre-/batteri-/laser-scripts. Eneste anker-relaterede sample er `BatteryAnchor.cs`, som blot holder en reference til en `UxrGrabbableObjectAnchor` (batteri-plads i en generator) [V] https://raw.githubusercontent.com/VRMADA/ultimatexr-unity/HEAD/Samples~/FullScene/Scripts/Lab/BatteryAnchor.cs.
- Guides-sitet (nav: Avatar, Locomotion, Hand Pose Editor, Manipulation, UI Interaction, Scripting) har **ingen Anchors-sektion** [V] https://www.ultimatexr.io/guides/what-is-ultimatexr. Manipulation-siden beskriver anchors og siger eksplicit ingen inventory-/holster-eksempler; nærmeste brugsscenarie er "fast anker hvor objektet kan lægges tilbage efter det er taget" [V] https://www.ultimatexr.io/guides/manipulation.
- **API-formen på `UxrGrabbableObjectAnchor`** [V] https://raw.githubusercontent.com/VRMADA/ultimatexr-unity/HEAD/Runtime/Scripts/Manipulation/UxrGrabbableObjectAnchor.cs:
  - `_compatibleTags` (tomt = kun objekter uden tag), `_maxPlaceDistance = 0.1f`, separate `AlignTransform` (hvor objektet snapper) og `DropProximityTransform` (hvor afstand måles).
  - Events i par: `Placing/Placed`, `Removing/Removed` (pre- og post-event) + `SmoothPlaceTransitionEnded`.
  - `AddPlacingValidator/RemovePlacingValidator` til runtime-regler.
  - `ActivateOnCompatibleNear / NotNear / HandNearAndGrabbable / Placed / Empty` = visuelle cues drevet af tilstand.
  - `UxrSnapToAnchorMode`: `DontSnap | PositionOnly | RotationOnly | PositionAndRotation`; "Parent When Placing" og "Create Anchor at Startup" (objektet får et hjem-anker det kan lægges tilbage på).
- Avatar med IK findes (side `/guides/avatar` set i navigationen; indholdet ikke læst) [V-nav]. Ingen gear-ankre på avataren er nævnt [?].
- [S] **Værdi for os:** API-designet (tag-filter + afstand + pre/post-events + validatorer + cue-objekter) er et godt skelet til vores `BackpackMount`-interface. Selve inventory-logikken skal vi selv bygge.

### 1.2 VRIF — VR Interaction Framework (Bogus Bear / Bearded Ninja Games, Unity)

- Licens: **kommerciel Asset Store-pakke** (Single Entity-licens vist, €64,39, v3.0.4 okt. 2024) [V] https://marketplace.unity.com/packages/templates/systems/vr-interaction-framework-161066. Kode må ikke genbruges, kun idéer.
- Asset Store-siden har ingen feature-tekst; itch-siden lister blot "9. IK Arms and Body" og "11. Snap Zones" [V] https://bng.itch.io/vr-interaction-framework. Asset Store-teksten siger iflg. søgeuddrag at Snap Zones er "super modular: make equipment slots, inventory systems and more" [V-søg].
- Udviklerens egne release-noter [V] https://discussions.unity.com/t/released-vr-interaction-framework/774202:
  - 5. feb 2020: "Snap Zones / Inventory (done, but can be expanded upon in future updates)".
  - 10. feb 2020 (v1.1): "Snap Points" — demoen har "holsters for weapons / items (including shoulder slots)" og **"a backpack that demonstrates how you can scale items within snap zones"**; ammo-boks på spillerens talje når et våben udstyres.
- [S] Rygsækken i VRIF er altså en *demo af skalering af ting i snap zones* (sandsynligvis kropsfast), ikke et afmonterbart objekt; kilden siger intet om afmontering [?].
- Idé: **skalér ting ned når de ligger i en snap zone** (visuelt kompakt, genopretter fuld størrelse i hånden).

### 1.3 Auto Hand (Earnest Robot, Unity)

- Kommerciel Asset Store-pakke (~$90, v4.0.4 feb 2025 iflg. søgeuddrag [V-søg]). itch-siden nævner **hverken holster, inventory, backpack, snap/place points eller body** [V] https://earnestrobot.itch.io/auto-hand; den lister grab-solver der tilpasser hånden til collider, pose-drivere, vægt, multi-hånds-greb, "pull-apart breaking", kast.
- Søgeuddrag nævner "Place Point Driver" og "one-handed item swapping" som features [V-søg]; en anmelder skal have skrevet at man selv må bygge holsters/rygsække ovenpå placepoint/grab [V-søg, review ikke læst].
- Intet body-anchored storage verificeret [?]. Kun idéer.

### 1.4 Hurricane VR (Cloudwalker/HurricaneVR, Unity) — **tættest på en rygsæk-som-objekt**

- Kommerciel Asset Store-pakke (€64,39, v2.9.3.c juli 2026, Unity 2022.3+) [V] https://assetstore.unity.com/packages/tools/physics/hurricane-vr-physics-interaction-toolkit-177300. Doc-repoet (`cloudwalker2020/HurricaneVR-Docs`) har `license: null` på GitHub [V] https://api.github.com/repos/cloudwalker2020/HurricaneVR-Docs. Kun idéer.
- **Sockets-dokumentation** [V] https://raw.githubusercontent.com/cloudwalker2020/HurricaneVR-Docs/main/docfx_project/manual/sockets.md:
  - `HVRSocket` er "useful for snapping objects into place permanently **or for building Saints and Sinners style inventories**".
  - Filtrering: `HVRSocketFilter` (subklasser; flere filtre kan AND/OR-kombineres) + `HVRSocketable` på gribbaren. Standard: `HVRTagSocketFilter/Socketable` med **32 kategorier som bitmask** ("extremely performant"), brugt i inventory- og holster-eksemplerne.
  - **`HVRGrabbableSocketFilter`: "This is used on the demo XR Rigs on the shoulder socket that holds the backpack."** → rygsækken er et `HVRGrabbable` der kun passer i skulder-socketen.
  - `HVRGrabbableSocketExcluder`: alt undtagen angivne ting.
  - Per-item **orienteringsoverride** (v2.9+: UI-hjælper; før: `GetRotationOffset/GetPositionOffset`-override i `DemoHolster`) — hver våben-type holstres i sin egen vinkel.
  - **Socketable Scaling:** `Scale Grabbable` skalerer ting efter mesh-bounds til en `Size` når de sidder i socketen (samme idé som VRIF).
  - **Hover Actions** (`OnHoverEnter/OnHoverExit(socket, grabbable, isValid)`): inventory-sockets "skalerer efter hånd-nærhed og skifter grøn/rød afhængigt af om objektet er tilladt" — bygget til at ligne S&S. Plus `HandGrabActions` når en hånd svæver over socketen.
  - Hver socket kræver en trigger-"bag" (`HVRTriggerGrabbableBag`) til detektion.
- Examples-scene: "Socket examples for inventory, weapons, keys, and place once style game behaviours" [V] https://raw.githubusercontent.com/cloudwalker2020/HurricaneVR-Docs/main/docfx_project/manual/intro.md. Asset Store-listen nævner (søgeuddrag) "over the shoulder backpack inventory with auto collect and waist holsters with configurable orientation" som sample [V-søg].
- **[?] Ikke fundet:** om rygsækken i Hurricane har egne indre sockets, kan åbnes i hånden, eller kan sættes tilbage med dwell/hysterese. Docs-repoet (727 filer, kun `.md`/`.yml` gennemgået for manualsiderne) har ingen dedikeret backpack-side.
- [S] **Det vigtigste mønster i hele researchen:** *rygsæk = grabbable + filtreret skulder-socket.* Så er WORN/HELD/PLACED blot "snappet / holdt / sluppet", og "sæt på" er en almindelig snap.

### 1.5 Unity XR Interaction Toolkit (XRI, Unity)

- Socket Interactor-docs [V] https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@3.0/manual/xr-socket-interactor.html: hover-mesh (forhåndsvisning ved socketens attach-punkt, eget materiale når optaget), `Socket Active`, `Recycle Delay Time` (socket afviser nye hovers efter fjernelse), `Starting Selected Interactable`, `Hover Socket Snapping` med radius (advarsel om z-fighting med hover-mesh). **Ingen omtale af inventory/holster.**
- Samples-listen (Starter Assets, Hands Interaction Demo, AR Starter Assets, XR Device Simulator, Spatial Keyboard, Legacy Input Readers, visionOS) **indeholder intet inventory/holster/socket/belt-sample** [V] https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@3.0/manual/samples.html.
- Samfundsmateriale: Unity Learn "1.4 Sockets" (hat på krog) og en Medium-tutorial om VR gun holster med XRI [V-søg] https://learn.unity.com/tutorial/sockets-g, https://medium.com/@dnwesdman/vr-gun-holster-with-the-xr-interaction-toolkit-4e23dc4e08aa (Medium gav 403 — ikke læst).
- Licens: Unity-pakke under Unity Companion License [?] (ikke verificeret her). Behandl som "kun idéer".
- Idéer: **hover-mesh/preview-ghost**, **recycle delay** (undgår at ting "suges" straks tilbage — jf. Arizona Sunshine-klagen i designdokumentet), `Socket Active` pr. tilstand.

### 1.6 Meta Interaction SDK (Unity) — snap interactions

- Kommerciel/Meta-licens [?]. Docs [V] https://developers.meta.com/vr/documentation/unity/unity-isdk-snap-interaction: snap interactions er **eksperimentelle** ("could have performance implications resulting in artifacts"); kan tilpasses til "inventories, cells in a board game, or slots around the user body"; `SnapInteractable` med en *Snap Pose Delegate* kan definere "alle slots i et inventory" og flytte allerede snappede ting for at give plads; `SnapInteractor` kan efter en **timeout** vende tilbage til en `Time Out Interactable` (bruges i DistanceGrabExample til at returnere ting). Ingen færdig holster/rygsæk-sample [V] https://developers.meta.com/vr/documentation/unity/unity-isdk-snap-examples-scene/ (kun søgeuddrag) [V-søg].
- Idé: **timeout-retur til hjemmepose** (samme som vores RETURNING/auto-retur) og **pose-delegat** (slot-pose er en funktion, ikke en konstant).

### 1.7 Godot XR Tools (GodotVR, Godot 4) — **vores egen motor**

- Licens: **MIT** ("Copyright (c) 2018-2023 Bastiaan Olij and Contributors") [V] https://raw.githubusercontent.com/GodotVR/godot-xr-tools/master/LICENSE. Må portes med bevaret notits.
- Repo-træ (1135 stier) [V] https://api.github.com/repos/GodotVR/godot-xr-tools/git/trees/master?recursive=1: `objects/snap_zone.gd/.tscn`, `objects/pickable.gd`, `objects/return_to_snap_zone.gd`, `objects/snap_path.gd`, `objects/grab_points/grab_point_snap.gd`, `functions/function_pickup.gd`, `player/player_body.gd`. **Ingen `holster`/`inventory`/`backpack`-filer.**
- **`XRToolsSnapZone`** [V] https://raw.githubusercontent.com/GodotVR/godot-xr-tools/master/addons/godot-xr-tools/objects/snap_zone.gd: signaler `has_picked_up(what)`, `has_dropped`, `highlight_updated`, `close_highlight_updated`; `enabled`; `stash_sound`; `grab_distance` (standard 0,3 m); `snap_mode` `DROPPED | RANGE`; `snap_require/exclude` (grupper på ting), `grab_require/exclude` (grupper på den der tager), `initial_object`; `can_pick_up(by)`, `drop_object()`, `pick_up_object(target)`. Selve zonen kan ikke samles op.
- **`XRToolsReturnToSnapZone`** [V] https://raw.githubusercontent.com/GodotVR/godot-xr-tools/master/addons/godot-xr-tools/objects/return_to_snap_zone.gd: node på en pickable; `snap_zone_path`, `return_delay := 1.0 s` — returnerer en sluppet ting til sin zone. **Direkte præcedens for vores auto-retur.**
- **Belt-demoen** [V] https://raw.githubusercontent.com/GodotVR/godot-xr-tools/master/scenes/pickable_demo/pickable_demo.tscn og `objects/belt_snap_zone.tscn`: fem `BeltSnapZone`-instanser (`grab_distance = 0.1`, kugle-mesh + highlight-ring) som **børn af `XROrigin3D/PlayerBody`** i y = 1,0 og fast radial fordeling omkring z = −0,25 (±0,177/±0,096 m). Zonerne er i spillerens *play-space-ramme*, **ikke** bundet til hoved-yaw eller avatar-hofte [S: ud fra træstrukturen; ingen follow-script set]. Altså det vi forsøger at forbedre (hofte/ryg-løsning).
- **Issue #127 (2022): "Virtual Holster Object"** [V] https://github.com/GodotVR/godot-xr-tools/issues/127: en bidragyder byggede en holster-node (pickable-scene, venstre/højre-knapper til put/take, signal ved ind/ud, lyd); skriver at den "possibly [could be] nested to create a rudimentary 'backpack inventory' system" (**utestet**). Lukket; vedligeholderen: "Snap-zones in other frameworks tend to grow a bunch of features such as grab-cloning, or return-to-snap".
- **Issue #521 (åben, milestone 4.6.0): "Snap-zones should manage collision exceptions"** [V] https://github.com/GodotVR/godot-xr-tools/issues/521: "Hammer put in a toolbox / **Shovel put in a backpack**" — snap zones der forbinder to RigidBody3D får dem til at skubbe hinanden; foreslået løsning: zonen opdager at den er barn af en RigidBody3D og lader forælderen ignorere det nye barn; zonen må ikke snappe sin egen forfader. **Direkte relevant til B/C**; vores adapter undgår problemet ved at fryse genstande (`collision_layer=0`) — men det bliver et problem i `high`-tier med fysiske ting.
- Snap-zone-docs: layers/filtre skal sættes ellers kan spilleren ikke tage ting; **ingen omtale af nesting eller holster** [V] https://godotvr.github.io/godot-xr-tools/docs/snap_zone/. Kendt 4.4.1-bug i signal-hookup i snap zone [V-søg] https://forum.godotengine.org/t/xrtools-snapzone/113047.
- [S] Konsekvens: `gs_gear_inventory_scene_adapter` (reparent + ledger + rollback + approach-politik) er **mere avanceret end noget i Godot XR Tools** på ejerskab/checkpoint; vi har ikke brug for at tage dens snap zone, men API-formen (`snap_mode`, `grab_require`, `return_delay`, highlight-signaler) er værd at spejle i `access_volume`.

### 1.8 VR Expansion Plugin (Mordentral, Unreal)

- Licens: **MIT** ("Copyright Joshua Statzer") [V] https://github.com/mordentral/VRExpansionPlugin (`LICENSE.txt`); aktivt (push 2026-10-19).
- Repo-træ [V] https://api.github.com/repos/mordentral/VRExpansionPlugin/git/trees/HEAD?recursive=1: grip-scripts `GS_Default`, `GS_GunTools`, `GS_InteractibleSettings`, `GS_LerpToHand`, `GS_Melee`, `GS_Physics`; `HandSocketComponent`. **Ingen filer med holster/inventory/backpack/bag.** Docs (Melee/Gun Tools-siden) nævner dem heller ikke [V] https://vreue4.com/?p=995.
- Eneste relevante: `GS_LerpToHand` (`MinDistanceForLerp`, `LerpDuration`, `MinSpeedForLerp`) — glid et objekt til hånden ved greb [V] https://raw.githubusercontent.com/mordentral/VRExpansionPlugin/HEAD/VRExpansionPlugin/Source/VRExpansionPlugin/Public/GripScripts/GS_LerpToHand.h. Det er byggestenen til **summon/kald-til-hånd** (mulighed D) i Unreal.
- Repoet `UnrealJoshua/VR_Backpack_System` (UE4) har kun en README på én linje ("Developed with Unreal Engine 4"), ingen licens [V] https://github.com/UnrealJoshua/VR_Backpack_System. Intet at lære.

### 1.9 Open source-fund fra GitHub-søgning (VR/XR + backpack/holster/inventory)

Søgt via GitHub Search API (`vr inventory`, `vr backpack`, `vr holster`, `xr holster`, `webxr inventory`, `godot xr inventory`, `openxr inventory` m.fl.) [V] https://api.github.com/search/repositories.

| Repo | Hvad | Licens | Relevans |
|---|---|---|---|
| `Toly65/UdonStowSystem` | VRChat (Udon): lommer, holstre, bælte-pouches og **bagslots** som "stow points" på spilleren; "H3VR-inspired"; stow-points som kategoriserede slots [V] https://github.com/Toly65/UdonStowSystem | **ingen licens** (alle rettigheder forbeholdt) | ren **slot-model på kropsankre** (A); ingen afmonterbar taske nævnt. Kun idéer. |
| `TheNexusAvenger/Nexus-VR-Backpack` | Roblox: erstatter standard-hotbar med VR-UI [V] https://github.com/TheNexusAvenger/Nexus-VR-Backpack | MIT | "Backpack" = hotbar/UI, ikke kropsforankret. Irrelevant. |
| `Isabela-Tellez/InventarioArmasVR`, `dmitrykurteanu/SmallInventoryExample` | Unity XRI/mindre eksempler [V] READMEs | ingen licens | Små. SmallInventory: `IInventoryStorable`, `InventoryContainer` + events (adskil lager- og pickup-logik) — samme princip som vores ledger. |
| `bigbossafman/VR-Mod-Vibecoding-Wizard` | værktøj til at lave VR-mods af flade spil (holsters m.m.) | MIT | Ikke et bibliotek; ikke undersøgt dybere [?]. |
| `UnrealJoshua/VR_Backpack_System`, `SimX-Inc/VR-Backpack-Tools` | tom UE4-readme / hardware-rygsæk til Vive | – / CC-BY | Irrelevante. |

**three.js/WebXR/A-Frame/Babylon:** [V] GitHub-søgningerne `webxr inventory`, `vr holster`, `xr holster` gav **ingen** three.js/A-Frame/Babylon-bibliotek med inventory/holster/backpack; web-søgninger gav kun generelle WebXR-startkits (`foobar404/webxr-sdk`: world-grab) og Babylon-forumtråde om hånd-grab (pinch-afstand, reparent til finger) [V-søg] https://forum.babylonjs.com/t/picking-up-a-mesh-using-handtracking-only/47004. Babylon har `handConstraintBehavior` (zoner omkring hånden) men intet body-slot-API [V-søg]. npm: ingen relevante pakker fundet (ingen forsøg på direkte npm-registry-opslag ud over søgning) [?]. Konklusion [S]: **WebXR-siden skal bygges fra bunden** (som designdokumentet allerede siger).

### 1.10 Asset Store / kommercielle assets til "VR backpack"

| Asset | Udgiver | Pris / version | Annoncerede features | Afmonterbar? | Kilde |
|---|---|---|---|---|---|
| **Immersive VR Inventory (Backpack / Holsters / Containers)** | Chris Handzlik / Immersive VR Tools | €9,19, v1.2.1 (sep 2021), Unity 2019.4 | Rygsæk med **justerbare slot-rækker/kolonner og slot-størrelse**, kontrol over rotation/skala af lagrede ting; **justerbare holsters** (side/bryst, orientering, positionsjustering runtime, typebegrænsning); statiske containere; framework-uafhængig (testet med Unity XR Toolkit); "kommer": flere inventory-sider, lyd, mere visuel tilpasning [V] https://immersivevrtools.com/projects/immersive-vr-inventory og https://discussions.unity.com/threads/released-immersive-vr-inventory-backpack-holsters-containers.906548/; metadata [V] https://assetstore.unity.com/packages/tools/gui/immersive-vr-inventory-backpack-holsters-containers-168055 | **[?]** ikke angivet. Slot-baseret (grid); om fysisk/hånd-åbnet: ikke angivet. En anmelder skal have sagt at rygsæk er valgfri [V-søg]. | se venstre |
| VR Inventory For Oculus; Mobile VR Inventory System | (ukendte) | $29,99 / $25 | Kun titel/uddrag (stakke, equip, save/load) [V-søg] | [?] | https://assetstore.unity.com/packages/tools/gui/vr-inventory-for-oculus-147373, https://marketplace.unity.com/packages/templates/systems/mobile-vr-inventory-system-91529 |
| Immersive VR Mechanic Tools & Interactions | samme udgiver | – | kun titel set [V-søg] | [?] | https://assetstore.unity.com/packages/templates/systems/immersive-vr-mechanic-tools-interactions-178517 |

[S] Mønster: **de kommercielle assets sælger slot-grids + holsters** (A), ikke en fysisk afmonterbar taske. Ingen annoncerer "hånd-over-skulder-træk med frigørelse", "åbn i hænderne" eller fysiske genstande i tasken.

### 1.11 Gothic Unity VR (Gothic-Unity-Project, Unity/C#, **GPL-3.0**) — **afmonterbar, håndholdt rygsæk i faktisk kode**

- Repo: https://github.com/Gothic-Unity-Project/Gothic-Unity — licens **GPL-3.0** [V] (GitHub API `license.spdx_id`, README-badge "License: GPL v3"); push 2026-10-23, 33 stjerner [V] https://api.github.com/repos/Gothic-Unity-Project/Gothic-Unity. Det er et *spil/mod* (Gothic-genskabelse i Unity), ikke et framework; VR-laget er bygget på **Hurricane VR** (`#if GOTHIC_HVR_INSTALLED`, `using HurricaneVR.Framework…`) [V]. **GPL: kun idéer, ingen kode** (GPL er copyleft; at kopiere kode ville smitte vores kode).
- Filer fundet i træ (2101 stier) [V] https://api.github.com/repos/Gothic-Unity-Project/Gothic-Unity/git/trees/HEAD?recursive=1: `Assets/Gothic-VR/Scripts/Adapters/Player/VRBackpack.cs`, `Adapters/HVROverrides/VRShoulderSocket.cs`, `VRSocket.cs`, prefabs `Player-Elements/BackPack.prefab`, `BackPack/VRBackpackInventorySlot.prefab`, `VRBackpackLargeInventorySlot.prefab`, `backpack_left_hand_pose.asset`, `backpack_right_hand_pose.asset` (hånd-poses til taske-grebet), `GUZ-VR-Socketables.asset`.
- **`VRBackpack.cs`** [V] https://raw.githubusercontent.com/Gothic-Unity-Project/Gothic-Unity/main/Assets/Gothic-VR/Scripts/Adapters/Player/VRBackpack.cs:
  - Rygsækken er et objekt med `[RequireComponent(typeof(HVRSocketable))]` + en `HVRSocketContainer` med interne sockets. Altså **taske = socketable gribbart objekt med egne indre sockets** — præcis mønster B.
  - **Tag af:** `OnBackpackReleasedFromShoulder(grabber, grabbable)` kaldes når tasken forlader en `VRShoulderSocket`/`HVRShoulderSocket` (ellers return) → `UpdateInventoryView()`. Socketable har `UnsocketedClip = InvOpen` (lyd ved åbning).
  - **Tilbage på:** `OnBackpackGrabbedToShoulder` (kun kommentar: "Nothing to do for now… could hide meshes inside Backpack"); `SocketedClip = InvClose` (lyd ved lukning). Tilbagesætning = almindelig socket-snap.
  - **Gennemse indhold:** ejerskabet ligger i en **data-inventory** (`PlayerService.GetInventory(category)`), ikke i de fysiske ting. Ved åbning materialiseres ting: `ClearSockets()` (force-release + destroy af eksisterende proxyer) → `RefillSockets()` skaber `_vobService.CreateItem(...)`, sætter `Rigidbody.isKinematic = false` ("grab is done physically") og `_socketContainer.TryAddGrabbable(...)`. **Maks. 9 sockets pr. side** (`startIndex = page*9-9`, `Mathf.Min(9, …)`), **kategori-faner** (`InvCats` Weapon…Misc, `OnNext/PrevCategoryClick`) og **pager** (`OnNext/PrevPageClick`, tekst "1/3"). Altså: *fysiske genstande i slots, men pagineret og kategoriseret — ikke fri fysik/rod*.
  - **Ind/ud af tasken:** `OnItemPutIntoBackpack/OutOfBackpack` opdaterer data-inventoryen (`AddItem/RemoveItem`), frakobler/tilkobler verdens-culling og sparer/fjerner vob i savegame, og kalder `UpdateInventoryView()`.
  - **Re-entrancy-guard:** `_tempIgnoreSocketing` slås til mens sockets ryddes/genopbygges (kommentar: "Otherwise, we create a loop"); `UpdateSockets` er en koroutine over flere frames fordi release/destroy først er færdig næste frame; lyd for våben-træk slås fra imens.
  - **Ting i hånden trækkes fra visningen:** `SubtractItemFromHand(inventory, GrabbedItemLeft/Right)` — genstande man holder tæller ikke dobbelt.
  - **Hurtig-stow:** `OnItemPutIntoHolster/OutOfHolster` (skulder/holster) justerer bare antallet i data-inventory.
- **Issue #319** (åben, 2025-10-19) [V] https://api.github.com/repos/Gothic-Unity-Project/Gothic-Unity/issues/319: titel "If Backpack is in hand and left shoulder is used to 'quick' add item, the view is not re-rendered"; brødtekst: "Help: Look at VrBackpack.cs and its functions." Ingen kommentarer. Bekræfter (a) tasken **holdes i hånden** mens man bruger venstre skulder som hurtig-stow, og (b) fejlen: `OnItemPutIntoHolster` opdaterer ikke den åbne visning (jf. koden — den kalder ikke `UpdateInventoryView`). Læren: **én hændelsesdrevet refresh-vej**, ikke flere.
- Hvilken skulder: issue siger "left shoulder"; README siger man kan "draw a two-handed weapon from your left shoulder" [V] https://raw.githubusercontent.com/Gothic-Unity-Project/Gothic-Unity/main/README.md. Præcis hvor `VRShoulderSocket` sidder i rig-prefabben fandt jeg ikke (grep i `TechDemoXRRigOpenXR.prefab`/`HVRGlobal.prefab` gav ingen træf) [?]. Om venstre skulder = taskens plads eller et separat hurtig-stow: **[?]** (issuet kan læses begge veje).
- Hvad koden **ikke** viser [?]: hvordan tasken åbnes (ser ud til at åbne *ved at tage den af* — "InvOpen" = unsocket; ingen separat klap/lynlås fundet), vægt/tab-regler, siddende, tracking-tab, auto-retur, checkpoint af tasken som objekt, venstre/højre-spejling. Ingen komfortdata.
- **Hurricane-bekræftelse [V]:** `grabber is HVRShoulderSocket` i `VRBackpack.cs` viser, at Hurricane har en klasse `HVRShoulderSocket` (+ `HVRSocketContainer`), hvilket bakker op om 1.4: skulder-socket + gribbar taske er et indbygget mønster i Hurricane. (Pakken er kommerciel; kun idéer.)
- [S] **Dette ændrer billedet:** "afmonterbar rygsæk findes ikke" gælder frameworks, ikke projekter. En åben-kildekode-titel viser at *taske i socket → tag af i hånden → fysiske ting i 9 sockets → sæt tilbage* er implementerbar på en socket-baseret motor med lille kode (~300 linjer adapter). Samtidig er den **pagineret/kategoriseret** (en komfort- og Quest-kompromis, ikke fri fysik) og har en synlig synkroniseringsfejl pga. to opdateringsveje.

### 1.12 GLoot (Peter Kish, Godot 4.4+) — inventarlogik, ikke VR

- Licens: **MIT** ("Copyright (c) 2022 Peter Kish") [V] https://raw.githubusercontent.com/peter-kish/gloot/master/LICENSE ; repo https://github.com/peter-kish/gloot (986 stjerner, push 2026-07-14); `plugin.cfg` v3.0.2, release v3.0.2 (2026-07-05) [V] https://raw.githubusercontent.com/peter-kish/gloot/master/addons/gloot/plugin.cfg. README: "A universal inventory system for the Godot game engine (version 4.4 and newer)"; v3.0 har breaking changes mod 2.x [V] https://github.com/peter-kish/gloot/blob/master/README.md. Ingen VR-kode.
- Kerne (`addons/gloot/core/`) [V] https://api.github.com/repos/peter-kish/gloot/git/trees/HEAD?recursive=1 + rå filer: `inventory.gd` (`class_name Inventory`, `Node`), `inventory_item.gd`, `item_slot.gd`, `stack_manager.gd`, `prototree/{proto_tree,proto_tree_cache,prototype}.gd`, `constraints/{grid,weight,item_count}_constraint.gd` + `constraint_manager.gd`.
  - **Item prototypes/prototree:** JSON, prototyper kan arve fra hinanden og overstyre egenskaber [V README]. (Sammenlignelig med vores `gs_weapon_catalog`/`gs_grasp_data`-datadrevne definitioner.)
  - **Constraints:** `GridConstraint` (2D-grid), `WeightConstraint` (`capacity`, `get_free_space`), `ItemCountConstraint`; `InventoryConstraint` er base med `get_space_for/has_space_for` og hooks `_on_item_added/_removed/_property_changed/_pre/_post_item_swap` [V]. Constraints er *pluggable* pr. inventory.
  - **Transfer:** der er **ingen eksplicit atomisk `transfer`-funktion**; `add_item(item)` tjekker `can_add_item` og kalder derefter `item.get_inventory().remove_item(item)` på det gamle inventory og tilføjer — to trin uden rollback/transaktion [V] https://raw.githubusercontent.com/peter-kish/gloot/master/addons/gloot/core/inventory.gd (`_add_item_unsafe`, `remove_item`). `ItemSlot.equip(item)` = fjern fra gammelt inventory, ryd slot, `add_item` — slot er internt et 1-items inventory [V] …/item_slot.gd.
  - **Serialisering:** `serialize()/deserialize()` til Dictionary (`protoset`, `constraints`, `items`) [V]; jeg har ikke fundet checkpoint-versionering, `prepare_restore`/`commit_restore` eller ejerbegreb ud over `item._inventory` [?].
  - Stakke: `split_stack`, `merge_stacks`, `add_item_automerge/autosplit/autosplitmerge` [V].
  - Signaler: `item_added/removed/property_changed/moved`, `constraint_*`; `ItemSlot`: `item_equipped`, `cleared` [V].
- **Vurdering som backend [S]: ikke anbefalet at erstatte `NightfallGearInventory`.** Vores ledger har ejer-begrebet (`world|hand:left|hand:right|equipped|slot`), atomiske `store/retrieve/transfer` med notifikationslås, `prepare_restore/commit_restore`, checkpoint v1 og 59+82 tests, og den kobles til scene-adapteren (reparent + rollback) [V i designdokumentet]. GLoot ville give item-prototyper/constraints/UI-kontroller, men: (1) ingen scene-/ejer-/rollback-model, (2) nodebaseret `Inventory` i trægeometri ville duplikere ledgeren, (3) 3.x-API'et er stadig i bevægelse, (4) ville ikke hjælpe three.js-siden (ingen kontrakt/golden på tværs af motorer). 
- **Inspiration/lån (MIT, må portes med notits) [S]:** (a) **pluggable constraints** (`ItemCount/Weight/Grid`) som tier-afhængigt `CapacityModel` i vores 3.1; (b) **prototree-arv** til item-/taske-profiler (`BackpackProfile` arver fra default); (c) `ItemSlot = inventory med 1 item` som ren model for lommer; (d) stack split/merge hvis stakke (åbent spørgsmål 7) bliver ønsket; (e) `serialize()`-dict som formmønster. Hvis vi vil, kan GLoot bruges **kun som valgfri bulk-/UI-backend i et spil** (fx `CtrlInventoryGrid` til debug), ikke i kernen.

### 1.13 Andre nævnte, ikke nærmere relevante

- **Hexabody** (HurricaneVR-integration/player controller): physics-baseret krop [V] https://raw.githubusercontent.com/cloudwalker2020/HurricaneVR-Docs/main/docfx_project/manual/hexabody/hexabody.md — grep på backpack/holster/inventory/socket gav **0 træf** i hexabody-, camerarig-, playercontroller-, hands-, detection-sider. Ingen kropslagring.
- **Forskningstaksonomi** (arXiv:2107.08434, Cmentowski et al.): som i designdokumentet kun abstract læst; PDF-hentning gav kun et flowchart-billede [V metadata]. Ingen ny information.
- **Till Dawn** (indie, "kald rygsæk fra bag hovedet") — allerede i designdokumentets kilde 21; er et *spil*, men det eneste fundne "summon"-mønster.

---

## 2. Sammenligningstabel

| Framework/asset | Engine | Licens | Body-anchored storage | Afmonterbar rygsæk? | Slot vs. fysik | Genbrugelige idéer | Kilde |
|---|---|---|---|---|---|---|---|
| **UltimateXR** | Unity | **MIT** [V] | Intet inventory; generisk `UxrGrabbableObjectAnchor` (tag-filter, afstand, pre/post-events, validators, cue-objekter) | Nej [V] | Slot (snap-anker) | Anker-API-form: `compatibleTags`, `maxPlaceDistance`, `AlignTransform` vs. `DropProximityTransform`, `Placing/Placed/Removing/Removed`, `ActivateOn*` cues, "Create Anchor at Startup" (hjemmeanker) | github.com/VRMADA/ultimatexr-unity |
| **VRIF** | Unity | Kommerciel | Snap zones: holsters inkl. skulder-slots, ammo-boks på talje, **backpack-demo med skalering i snap zones** | **[?]** ikke angivet | Slot | Skalér ting i zone; skulder-slots | discussions.unity.com/t/released-vr-interaction-framework/774202 |
| **Auto Hand** | Unity | Kommerciel | Intet verificeret ("place point" kun i søgeuddrag) | [?] | Slot (place point) | Kun grab-solver/pose-idéer | earnestrobot.itch.io/auto-hand |
| **Hurricane VR** | Unity | Kommerciel (docs: ingen licens) | `HVRSocket`: inventory (S&S-stil), holsters, **skulder-socket der holder rygsækken (gribbar)** | **Delvist/implicit: rygsæk er et gribbart objekt i en filtreret skulder-socket** [V]; åbning/indre sockets [?] | Slot-sockets + fysiske gribbare | Tag-bitmask-filter, per-item orientering, scale-to-fit, hover-actions grøn/rød + skalering med hånd-nærhed, `GrabbableSocketFilter` til specifik ting | cloudwalker2020.github.io/HurricaneVR-Docs (sockets.md) |
| **Unity XRI** | Unity | Unity (Companion License [?]) | Socket Interactor (hover-mesh, active, recycle delay, snapping-radius); ingen samples til body storage | Nej | Slot | Hover-ghost, recycle delay, aktiv/inaktiv pr. tilstand | docs.unity3d.com/…xr.interaction.toolkit@3.0 |
| **Meta Interaction SDK** | Unity | Meta [?] | Snap interactions (eksperimentel): "slots around the user body" kun nævnt | Nej | Slot (pose-delegat) | Timeout-retur, slot-pose som delegat, flyt andre for at give plads | developers.meta.com/…unity-isdk-snap-interaction |
| **Godot XR Tools** | Godot 4 | **MIT** [V] | `XRToolsSnapZone` (+ belt-demo, 5 zoner på `PlayerBody`), `ReturnToSnapZone`; issue #127 holster, #521 nesting | Nej | Slot | `snap_mode DROPPED/RANGE`, `grab_distance`, `grab_require/exclude`, `return_delay 1,0 s`, highlight-signaler, stash-lyd, collision-exception ved container i rigid body | github.com/GodotVR/godot-xr-tools (+ issues 127, 521) |
| **VR Expansion Plugin** | Unreal | **MIT** [V] | Ingen (kun grip-scripts, `GS_LerpToHand`) | Nej | – | Lerp-til-hånd som summon-byggeblok | github.com/mordentral/VRExpansionPlugin |
| **Immersive VR Inventory** | Unity | Kommerciel | Rygsæk (slot-grid), justerbare holsters, containere | [?] | **Slot** (grid) | Runtime-justerbare holster-positioner, type-begrænsning | immersivevrtools.com/projects/immersive-vr-inventory |
| **UdonStowSystem** | VRChat/Udon | **Ingen licens** | Lommer, holstre, bælte, **bagslots** som stow points | Nej | Slot (stow point) | Stow-points som kategoriserede slots; "put away now" | github.com/Toly65/UdonStowSystem |
| **Gothic Unity VR** (spil/mod på Hurricane) | Unity | **GPL-3.0** [V] (kun idéer) | Rygsæk i skulder-socket (`VRShoulderSocket`); hurtig-stow i skulder/holster | **Ja, i kode:** tages af skulder-socket → holdes i hånden → sættes tilbage (`VRBackpack.cs`, issue #319 "Backpack is in hand") | **Hybrid:** data-inventory er sandhed; indhold materialiseres som fysiske gribbare i 9 sockets/side med kategori-faner + pager | Data-first + fysiske proxyer ved åbning (N=9), re-entrancy-guard `_tempIgnoreSocketing`, træk hånd-ting fra visningen, InvOpen/InvClose-lyd ved unsocket/socket, taske-specifikke hånd-poses; **fejl:** to opdateringsveje (#319) | github.com/Gothic-Unity-Project/Gothic-Unity |
| **GLoot** | Godot 4.4+ | **MIT** [V] | Ingen (ren inventarlogik, ikke VR): prototypes/prototree, constraints (grid/weight/count), `ItemSlot`, stakke, serialize | Nej | Data-model (slots/grid) | Pluggable constraints, prototree-arv, slot = 1-items inventory; **ikke** atomisk transfer/rollback, intet checkpoint-format [?] | github.com/peter-kish/gloot |
| **three.js/A-Frame/Babylon-pakker** | web | – | **Ingen fundet** | – | – | Kun hånd-grab (pinch) | GitHub-søgning, Babylon-forum |

---

## 3. Designmuligheder for vores system

Udgangspunkt (fra designdokumentet [V]): Godot har ledger + adapter + `gs_backpack` approach/pull; three.js har ingen inventory; grasp/held_drive/two_hand, avatar/vrik, mechanics, audio, checkpoint findes. Kritiske krav: komfort, Quest-pris, tiers, genbrug.

### A. Ren slot/snap-zone-model på kropsankre ("Godot XR Tools-belt / UdonStow / Immersive VR Inventory")
- **Hvad:** rygsæk = sæt af ankre på ryg/hofte; ting snappes i ankre; ingen taske-objekt. Det vi har i dag (`backpack_rig`, ledger-slots) er allerede A.
- **Fordele:** billigst (event-drevet, ét ray + afstand, ingen fysik), komfortabelt (ingen holdt taske), kendt af spillere, **100 % genbrug** af `gs_gear_inventory`+adapter+approach+pull; trivielt i three.js (JS-ledger + joints). Mest præcedens (alle frameworks i tabellen).
- **Ulemper:** ingen afmonterbar rygsæk, ingen "åbn i luften" — opfylder ikke kernemålet; zoner bundet til krop giver de kendte klager (slots flytter sig, siddende, bag ryggen).
- **Kræver:** ingenting nyt udover BodyAnchorProvider (hofte/ryg-ankre i JS), opdeling i BodyMounts (P3).

### B. Fysisk container-objekt med egne snap zones indeni ("rygsæk som objekt", Hurricane-mønstret + XRI-sockets)
- **Hvad:** rygsækken er et gribbart objekt med `carry_handle`/`side_grip`, egne indre og ydre snap zones; **WORN = objektet er snappet i en filtreret ryg-/skulder-mount** (Hurricane `HVRGrabbableSocketFilter`). Hånden trækker det ud af mounten, to-hånds hold, åbn via hinge/slider, sæt ned = fysik/PLACED.
- **Fordele:** afmontering/åbning/sæt-på falder ud af samme primitiv (snap/unsnap); ensartet model; stærkt "wow"; ting kan være rigtige objekter.
- **Ulemper:** dyrest (nested snap zones + rigid bodies → collision-exception-problemet, Godot XR Tools #521 [V]); mange rigids i åben taske er tungt på Quest; armtræthed ved at holde tasken; **ingen kilde viser at nogen har gjort det færdigt** [V]; ukendt komfort. Tab-risiko hvis tasken kan efterlades.
- **Kræver:** container-ejer i ledger (additivt, checkpoint v2), pose-ejer-flag i rig (`_process` må ikke genpåtrykke), `access_volume`, volumen-sweep, to-hånds greb (genbrug `two_hand`/`held_drive`), `mechanics` hinge/slider til klap/lynlås, audio-events. Godot: P2, P4-P6; three.js: P7-P8.

### C. Hybrid med tiers (A for `minimal`, B-light for `low/mid`, B-fuld for `high`) med mount-socket-abstraktion
- **Hvad:** samme datamodel overalt: *taske-objekt + mount*. `minimal` = mount altid låst (WORN, eksisterende rig + guidet træk = A). `low` = kinematisk afmontering uden vægtlag, indhold som lommer (ét objekt/slot, frosne børn, som i dag). `mid` = + to-hånds, vægtlag, proxy-visning. `high` = + N fysiske ting i åben volumen (ledger forbliver sandhed). Auto-retur (`return_delay`/timeout-mønstret, [V] Godot XR Tools + Meta ISDK) som sikkerhedsnet; summon (D) som tilgængelighedsfallback.
- **Fordele:** passer til brugerens præference (billigt + skiftbare realisme-tiers); hver tier kan shippes og headset-testes; A forbliver uændret og grøn (opt-in `enable_detachable_backpack`); lav risiko pr. fase; mest genbrug (ledger, adapter `_busy`-transaktion, approach/pull, grasp, mechanics, audio). Tilstandsmaskinen i 3.2 bliver mere forståelig som "snap/unsnap af objekt i mount" (kendt fra Hurricane).
- **Ulemper:** mere kode og flere tilstande at teste end A; kræver disciplin om at kernen er engine-uafhængig (golden-vektorer); `high` stadig ukendt komfort/perf.
- **Kræver:** som B plus tier-tabel (findes i designdokumentet 3.4) og `BackpackMount`-interface (se 4).

### D. Kald-til-hånd / summon (Till Dawn + VRE `GS_LerpToHand` + Meta timeout-retur)
- **Hvad:** gestus (hånd bag hovedet + grip, eller knap) lader tasken glide til hånden; samme gestus sender den tilbage. Ingen fysisk afmontering fra kroppen.
- **Fordele:** billigst "afmonteret"-følelse; løser siddende/tilgængelighed (designdokumentets krav); ingen tab-risiko; let i begge motorer; Till Dawn-præcedens [V].
- **Ulemper:** mindre fysisk forankret ("magisk"); behøver ny input-action (åbne spørgsmål 8); ingen "sæt på" i verden/PLACED medmindre kombineret med C.
- **Kræver:** `RETURNING`-animation (findes i 3.2), håndtilstand `hand:*` for tasken, evt. input-action.

---

## 4. Anbefaling: **C — hybrid med tiers**, bygget på en mount-socket-abstraktion, med D som indbygget fallback

**Begrundelse**
1. **[V] Ingen færdig løsning findes at kopiere** (afsnit 0, 1.4, 1.10), så risikoen skal styres: C lader os levere A uændret og bygge B trinvis med målbar headset-feedback. B-only ville satse alt på et ukendt mønster.
2. **[V] Det eneste fundne præcedens for "rygsæk = objekt i socket" (Hurricane)** viser at modellen er praktisk bygbar, og at filtreret socket + gribbart objekt er nok til WORN↔HELD↔sæt-på uden en skræddersyet tilstandsmotor. Vi lægger vores approach/pull-politikker og to-hånds-regler ovenpå.
3. **[S] Præferencerne passer:** billig (event-drevet, ingen fysik før `high`) og skiftbare tiers = C pr. definition. D løser siddende uden ekstra arkitektur.
4. **[V] Genbrug:** ledger/adapter (atomiske overførsler + rollback) er stærkere end noget i Godot XR Tools; JS-siden kan låne UltimateXR's anker-API (MIT) og Godot XR Tools' navngivning/parametre (MIT) som kontrakt.

**Opdatering efter Gothic Unity VR (1.11) og GLoot (1.12): anbefalingen står fast, men skærpes.**
- Gothic VR er det første *fundne* bevis på at B virker som kode (taske i skulder-socket → hånd → fysiske ting i sockets → tilbage). Det **styrker C** og gør "B er ukendt" mindre ukendt, men det er (a) GPL (kun idéer), (b) pagineret/kategoriseret (9 ting pr. side, ikke fri fysik), (c) uden verificeret komfort, siddende, tracking-tab, auto-retur eller checkpoint [?], og (d) med en åben synkroniseringsfejl (#319).
- **Konkrete designændringer det giver C:**
  1. `high`-tier = **materialiser ≤ N (8–12) fysiske proxyer fra ledgeren ved åbning, ryd dem ved lukning/sidevalg** (Gothic: 9). Passer til designdokumentets N-budget og gør Quest-prisen forudsigelig.
  2. **Ledgeren (data) er sandheden; fysiske ting er visning.** Samme princip som designdokumentet allerede har, nu med et realiseret eksempel.
  3. **Re-entrancy-guard og én refresh-vej:** under materialisering/oprydning ignoreres item-events (Gothic `_tempIgnoreSocketing`); alle ind/ud/hurtig-stow-hændelser går gennem *samme* `refreshView()` — ellers får vi #319 igen. Opdel oprydning/genopbygning over flere frames hvis release/destroy er asynkront (i Godot: `call_deferred`/næste fysik-tick).
  4. **Træk hånd-holdte ting fra visningen**, så en genstand aldrig vises to steder.
  5. **Lyd/hånd-pose på unsocket/socket** (`bag_open`/`bag_close`, taske-greb-poses) — billigt og giver tydelig feedback.
  6. Kategori-faner/pager er et **valgfrit** `mid/high`-layout for store inventarer; slot-modellen med faste lommer forbliver standard.
- **GLoot:** bruges **ikke** som backend (ingen ejer-/rollback-/checkpoint-model, nodebaseret, ville duplikere ledgeren og ikke hjælpe three.js). Lån (MIT): pluggable constraints til `CapacityModel`, prototree-arv til `BackpackProfile`, `ItemSlot` som 1-items-inventory, evt. stak split/merge.

**Konkrete lån (hvad vi må tage)**
- **MIT-kode kan portes** (UltimateXR, Godot XR Tools, VRE): bevar copyright-/licensnotits i den kopierede fil og nævn kilden; ellers kun idéer. Apache-2.0 er ikke fundet blandt kilderne. [S: ikke juridisk rådgivning]
- **GPL-3.0 (Gothic Unity VR): kun idéer, ingen kode** — copyleft ville kræve at vores egen kode også blev GPL. Gothic-assets/mod-indhold (Piranha Bytes-materiale) rører vi heller ikke. **GLoot (MIT)** må portes/bruges med notits.
- **Kun idéer** (ingen kode): Hurricane, VRIF, Auto Hand, Immersive VR Inventory, Unity XRI/ISDK (Unity/Meta-licens [?]), UdonStowSystem (ingen licens = alle rettigheder forbeholdt). Mekanik-mønstre er ikke ophavsretsbeskyttet, men kopiér hverken kode, navne på assets eller demo-assets. Egne assets via BlenderShared.

**Foreslåede nye kontrakt-felter/mønstre** (til `backpack.data.json` / `BackpackMount`):
| Mønster | Fra | Bruges til |
|---|---|---|
| `compatibleTags`-bitmask (≤32) pr. mount/slot | Hurricane `HVRTagSocketFilter`, UltimateXR `_compatibleTags` | kategori-tjek (har vi som `categories`; bitmask til hot path i JS/GDScript) |
| `acceptOnly: itemId` på mount | Hurricane `HVRGrabbableSocketFilter` | ryg-mounten tager kun *denne* taske |
| `snap_mode: DROPPED|RANGE`, `grab_distance` | Godot XR Tools | don-zone (DROPPED + dwell), lommer (RANGE) |
| `returnDelayS` (+ timeout-mål) | `XRToolsReturnToSnapZone` (1,0 s), Meta ISDK timeout | `RETURNING`/auto-retur |
| pre/post-events `placing/placed/removing/removed` + validatorer | UltimateXR | atomisk transaktion, spillets regler (våbenovergang aktiv) |
| `alignTransform` ≠ `proximityTransform`; slot-pose som delegat | UltimateXR, Meta ISDK | justerbar position pr. bruger/siddende uden at ændre snap-pose |
| per-item orientering + `scaleToFit` i slot | Hurricane, VRIF | pænere visning af proxyer i lommer |
| hover-ghost + grøn/rød + skala efter hånd-nærhed | Hurricane hover actions, XRI hover mesh | feedback; `recycleDelay` mod "suge tilbage"-klager |
| collision-exception for container i rigid body | Godot XR Tools #521 | `high`-tier: tasken ignorerer egne indre rigids; zone snapper aldrig sin egen forfader |
| hjemme-anker oprettet ved start | UltimateXR "Create Anchor at Startup" | taskens WORN-mount genereres af profilen |

---

## 5. Hvad bør ændres i designdokumentets valg (til den der opdaterer `backpack_system_design.md`)

1. **Indfør `BackpackMount` (mount-socket) som eksplicit begreb i 3.1/3.2.** WORN = "tasken er snappet i ryg-mounten"; DRAWING/HELD = "ude af mount"; DON = snap til mount med dwell/hysterese; RETURNING = timeout-retur mod mount. Det forklarer pose-ejer-reglen (kun mount/hånd/verden skriver pose) og harmonerer med Hurricane-mønstret [V]. Ingen ændring af tilstandsmaskinens tilstande, kun begrebet.
2. **§2.3 "Ingen læst kilde viser fuld tag-af/hold/åbn/sæt-på"** skal **justeres**: ingen *framework/plugin/toolkit* har det som komponent (UltimateXR, VRIF, Auto Hand, Hurricane, XRI, ISDK, Godot XR Tools, VRE, Immersive VR Inventory), men **Gothic Unity VR** (GPL, på Hurricane) har det i spilkode (`VRBackpack.cs`: unsocket fra skulder → i hånden → 9 fysiske sockets/side → socket tilbage). Skriv det som præcedens (kun idéer) og noter at den er pagineret og har fejl #319. Tilføj Hurricane som **nærmeste framework-præcedens** (rygsæk som gribbart objekt i skulder-socket) og Till Dawn som summon-præcedens.
3. **Tilføj collision-exception-regel til `high`-tier** (Godot XR Tools #521): container ignorerer egne indre rigids, zone snapper aldrig egen forfader. Vores `freeze`/`collision_layer=0` dækker `low/mid`.
4. **three.js-siden:** skriv eksplicit at **ingen eksisterende npm/three.js/A-Frame/Babylon-pakke** kan genbruges; kernen er JS-ledger + `BodyAnchorProvider` ovenpå `vrik.joints`. Brug UltimateXR's anker-API-form som kontrakt-forbillede (MIT).
5. **Åbent spørgsmål 5 (siddende/kald til hånd):** research peger på at **D bør være standard siddende** og et valgfrit input overalt; Godot-siden kan bruge samme `RETURNING`-animation baglæns.
6. **Faseplanen ændres ikke** (P0→P1→P2…); eneste tilføjelse: P0's kontrakt får felterne i tabellen i afsnit 4 (`acceptOnly`, `snapMode`, `returnDelayS`, pre/post-events, tag-bitmask).
7. **Licensnote:** tilføj at MIT-kilderne (UltimateXR, Godot XR Tools, VRE, GLoot) må portes med notits, resten kun som idéer; Gothic Unity VR er GPL-3.0 (ingen kode).
8. **Tilføj til 3.4 (`high`-tier):** materialiser ≤N proxyer fra ledgeren ved åbning (Gothic: 9), re-entrancy-guard + én refresh-vej, træk hånd-holdte ting fra visningen. Tilføj til risikotabellen: "to opdateringsveje giver ude-af-sync visning (Gothic #319)".
9. **Ledger/GLoot:** behold `NightfallGearInventory`; GLoot kun som inspiration til constraints/prototree (MIT).

---

## 6. Ikke verificeret / næste skridt

- **[?]** Hurricane: om rygsækken har egne indre sockets/åbning, og hvordan "auto collect" virker. Afklares ved at hente Hurricane-demoen (itch, gratis) og spille/se demo-rig'ens skulder-socket — eller læse C#-kilden (følger med Asset Store-pakken, ikke åbent).
- **[?]** VRIF's backpack-demo: kropsfast eller grib-bar? (kun forum-sætning læst).
- **[?]** Immersive VR Inventory: adgangsgestus og afmontering (docs-link på udgiverens side blev ikke fulgt).
- **[?]** Auto Hand "Place Point"-detaljer (kun søgeuddrag).
- **[?]** Unity XRI-licens (Unity Companion License) og Meta ISDK-licens — ikke læst.
- **[?]** UltimateXR `/guides/avatar` og `/guides/hand-pose-editor` indhold (kun nav læst); `UxrGrabManager`-logik for placering ikke læst ud over header.
- **[?]** npm-registry direkte opslag på "webxr inventory/holster"; kun web-/GitHub-søgning.
- **[?]** Blade & Sorcery, Bonelab m.fl. er spil og ikke del af denne opgave.

---

## 7. Kilder (alle åbnet/forsøgt 2026-10-24)

GitHub og rå kildefiler (læst):
- UltimateXR: https://github.com/VRMADA/ultimatexr-unity ; træ https://api.github.com/repos/VRMADA/ultimatexr-unity/git/trees/HEAD?recursive=1 ; https://raw.githubusercontent.com/VRMADA/ultimatexr-unity/HEAD/Runtime/Scripts/Manipulation/UxrGrabbableObjectAnchor.cs ; …/UxrSnapToAnchorMode.cs ; …/Samples~/FullScene/Scripts/Lab/BatteryAnchor.cs ; …/LICENSE ; guides: https://www.ultimatexr.io/guides/what-is-ultimatexr , https://www.ultimatexr.io/guides/manipulation
- Godot XR Tools: https://github.com/GodotVR/godot-xr-tools ; træ https://api.github.com/repos/GodotVR/godot-xr-tools/git/trees/master?recursive=1 ; https://raw.githubusercontent.com/GodotVR/godot-xr-tools/master/addons/godot-xr-tools/objects/snap_zone.gd ; …/objects/return_to_snap_zone.gd ; …/scenes/pickable_demo/pickable_demo.tscn ; …/scenes/pickable_demo/objects/belt_snap_zone.tscn ; …/LICENSE ; issues https://github.com/GodotVR/godot-xr-tools/issues/127 , https://github.com/GodotVR/godot-xr-tools/issues/521 ; docs https://godotvr.github.io/godot-xr-tools/docs/snap_zone/
- VR Expansion Plugin: https://github.com/mordentral/VRExpansionPlugin ; træ https://api.github.com/repos/mordentral/VRExpansionPlugin/git/trees/HEAD?recursive=1 ; …/GripScripts/GS_LerpToHand.h ; …/LICENSE.txt ; docs https://vreue4.com/?p=995
- Hurricane docs: https://raw.githubusercontent.com/cloudwalker2020/HurricaneVR-Docs/main/docfx_project/manual/sockets.md , …/manual/intro.md , repo https://github.com/cloudwalker2020/HurricaneVR-Docs
- Øvrige repoer: https://github.com/Toly65/UdonStowSystem , https://github.com/TheNexusAvenger/Nexus-VR-Backpack , https://github.com/UnrealJoshua/VR_Backpack_System , https://github.com/Isabela-Tellez/InventarioArmasVR , https://github.com/dmitrykurteanu/SmallInventoryExample

Opfølgning (læst 2026-10-24):
- Gothic Unity VR: https://github.com/Gothic-Unity-Project/Gothic-Unity ; https://api.github.com/repos/Gothic-Unity-Project/Gothic-Unity ; træ …/git/trees/HEAD?recursive=1 ; https://raw.githubusercontent.com/Gothic-Unity-Project/Gothic-Unity/main/Assets/Gothic-VR/Scripts/Adapters/Player/VRBackpack.cs ; …/HVROverrides/VRShoulderSocket.cs ; …/README.md ; issue https://github.com/Gothic-Unity-Project/Gothic-Unity/issues/319
- GLoot: https://github.com/peter-kish/gloot ; https://raw.githubusercontent.com/peter-kish/gloot/master/LICENSE ; …/addons/gloot/core/inventory.gd ; …/core/item_slot.gd ; …/core/constraints/*.gd ; …/addons/gloot/plugin.cfg ; træ https://api.github.com/repos/peter-kish/gloot/git/trees/HEAD?recursive=1

Docs/sider:
- VRIF: https://discussions.unity.com/t/released-vr-interaction-framework/774202 ; https://bng.itch.io/vr-interaction-framework ; https://marketplace.unity.com/packages/templates/systems/vr-interaction-framework-161066
- Auto Hand: https://earnestrobot.itch.io/auto-hand
- Hurricane (Asset Store): https://assetstore.unity.com/packages/tools/physics/hurricane-vr-physics-interaction-toolkit-177300
- Immersive VR Inventory: https://immersivevrtools.com/projects/immersive-vr-inventory ; https://discussions.unity.com/threads/released-immersive-vr-inventory-backpack-holsters-containers.906548/ ; https://assetstore.unity.com/packages/tools/gui/immersive-vr-inventory-backpack-holsters-containers-168055
- Unity XRI: https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@3.0/manual/xr-socket-interactor.html ; …/manual/samples.html
- Meta ISDK: https://developers.meta.com/vr/documentation/unity/unity-isdk-snap-interaction
- Kun via søgeuddrag: Unity Learn sockets (https://learn.unity.com/tutorial/sockets-g), Medium XRI-holster (https://medium.com/@dnwesdman/vr-gun-holster-with-the-xr-interaction-toolkit-4e23dc4e08aa, 403), Babylon-forum (https://forum.babylonjs.com/t/picking-up-a-mesh-using-handtracking-only/47004), Godot-forum snap zone-bug (https://forum.godotengine.org/t/xrtools-snapzone/113047), Asset Store-lister for VR Inventory For Oculus / Mobile VR Inventory System / Immersive VR Mechanic Tools.
