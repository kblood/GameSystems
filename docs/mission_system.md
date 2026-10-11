# Genbrugelige missioner og brandmandsudfordring

`extensions/missions` er et renderer-/engine-uafhængigt modul med én aktiv opgave.
Det kræver en synkron evaluate-callback, og ejer ingen varme, fysik eller væsker.

```js
const missions = createMissionSystem({
  clearSeconds:3,
  evaluate:({data}) => ({clear:buildingIsClear(), failed:protectedRoomBurned(), reason:'east fire'}),
});
missions.start({timeLimit:120, data:{scenario:'fire'}});
missions.step(dt); // Advance exactly once with the simulation; omit during pause.
```

Status er idle/active/succeeded/failed. Opgaven kræver clear i en sammenhængende periode;
en ny risiko nulstiller clearElapsed. Tidsgrænse 0 er ubegrænset, ellers højst 86400 s.
dt er højst 10 s og clearSeconds positiv/højst 60 s. Success/timeout stopper timeren
ved den præcise hold-/deadline-grænse, også ved større updates. Success vinder en eksakt
tie ved deadline; en reported failed-condition har prioritet. Terminale outcomes latcher,
mens spillets øvrige systemer gerne må fortsætte.

API: start/reset/state, step/setQuality, capture/prepareRestore/restore/dispose.
Events: missions:started/changed/completed/failed. State har elapsed, clearElapsed,
timeLimit, data, reason og failureKind. Metadata er detached JSON med 16 KiB-grænse.
Restore validerer config, status, timerrelationer og fejlårsag; en kontrolperiode kan
ikke være længere end hele opgavens elapsed. Kvalitet ændrer ikke målet. Evaluator-
fejl afvises før timerændring. Callback-reset/dispose og nested operationer er dækket.

Branddemoens start giver en frisk bygning, to brande i vest og møbler ved den faktiske
døråbning, så døren er et brugbart middel til at beskytte øst. Let/normal/svær giver
180/120/60 simulationsekunder. Bygningens eksisterende hazard-vurdering skal være klar
i 3 s. Ild i øst latches som tab også hvis den slukkes inden næste mission-poll.
En ny opgave nulstiller bygningen; Sandkasse stopper kun opgaven og bevarer bygningen.

Under aktiv udfordring er materialeredigering, tilført ild/varme, brændstof/lade-test,
gratis refill/charge og øjeblikkelig fjernelse af pytter låst. Ved pause kan sluknings-
udstyr og åbninger ikke betjenes; objektvalg, visning og alarm-ack er stadig mulige.
Sandkassen har de oprindelige redigeringsfunktioner. Sværhedsgrad-valg under en opgave
er kun præference for næste start. Forsyninger forbruges af de eksisterende systemer.

Mission-state, next-run difficulty og øst-antændelseshistorik indgår i application
under eksisterende fire-scene-provider. Pause og fremdrift gendannes med resten af
bygningen. Ældre filer uden missionfelter starter i sandbox/idle. Outcome vises både
i sidepanel og scene-/VR-status. Dette er en systems-demo, ikke et færdigt brandmandsspil
med avatarbevægelse, redning/NPC'er, økonomi eller strukturel bygningsskade.

Kontrol: `npm run test:missions:browser` omfatter native start/pause/save/restore/vandslukning,
kontrolleret øst-antændelse (også kortvarig), korrupt fil og legacy-gemning. Timeout
kontrolleres ved bounded fast-forward af missionens egen klokke i en pauset bygning;
separate unit-tests dækker frame rate, grænser og callback-lifecycle. Fysisk headset
er fortsat uafprøvet.

VR-menuen har otte world-space-knapper: vand, skum, diesel, start, pause/fortsæt,
sandkasse, næste sværhedsgrad og alarmdæmpning. Kommandoer bruger samme action-gate
som desktop; den tidligere direkte diesel-call kunne ikke respektere challenge-lock.
Nozzle-knapper følger kontinuerligt flow og kan ikke starte mens simulationen er pauset.
Pause frigør alle input-ejere, også fra den anden hånd, og resume genaktiverer dem ikke.
Knapper, som ikke kan bruges, tegnes dæmpet. Pause- og difficulty-tekst opdateres på
samme eksisterende texture kun når teksten ændres. Der er otte plane/draw/texture-
ejere i menuen (fem mere end tidligere), skjult på desktop og genbrugt gennem reset.
Terminal page-cleanup frigiver deres geometry/material/map én gang og rydder scene-content.

`npm run test:xr-controls:browser` bruger faktisk Three.js-controller-raycast med
simulerede select/session-events og et direkte render-frame. Den kontrollerer start,
regler, pause, flow-release, alarm-ack, sandbox, labels og 24 resource-dispose-events.
Screenshot er kontrolleret, men fysisk tracking, stereolæsbarhed og komfort er ikke målt.
