# Brandalarmer

`extensions/alarms` er en selvstændig host-extension med thermal som eneste krævede
dependency. Den læser rumtemperatur/røgtæthed og ejer ikke brand, væske, lyd eller strømnet.

```js
const alarms = await host.load(alarmsExtension);
alarms.add('west-smoke', {roomId:'west', mode:'smoke', smokeThreshold:.02, delaySeconds:.5});
// Direct use: createAlarmSystem({thermal, emit, isPowered}), then step(dt).
```

Detektorer har mode heat/smoke/either, heatThreshold (standard 60), smokeThreshold
(0,02), clearHeat (threshold−10), clearSmoke (halvdelen af threshold), delaySeconds
(0,5) og enabled. Der samples ved 10 Hz. Hazard skal forblive over trigger-tærsklen
gennem dwell-perioden. Alarmen latcher og er fortsat triggered efter rummets afkøling.
Reason er heat, smoke eller heat+smoke. Temperatur/røgværdierne er gameplay-parametre.

`silence(id)` sætter silenced og fjerner audible uden at fjerne triggered.
`reset(id)` kræver rumværdier under de separate clear-tærskler; det returnerer false,
hvis rummet stadig er for varmt/røgfyldt. Dwell, reason og silence nulstilles ved reset.
`setEnabled` stopper detektering/signalet og dwell, men bevarer den latchede alarm.
API: add/remove/state/all, silence/reset/setEnabled, step, setQuality, capture,
prepareRestore/restore/dispose. Events: alarms:triggered/changed/silenced/reset.
Spillet kan koble audible-flagget og events til sit eget lyd-/skærmsystem.

`isPowered(id)` er en valgfri boolean gate, standard true. Adapteren læser gaten ved
sampling; den hverken opdaterer et strømnet eller forbruger batteri-Wh. Et spil med
faktiske elektriske alarm-laster skal lade strøm-ejeren håndtere deres energi og
levere gaten. Branddemoen bruger selvforsynede/logiske enabled-flags og viser kun
visuelle signaler, ikke sirenelyd eller fysiologi.

Budget er 64 detektorer som standard, med dt højst 10 sekunder. Kvalitet påvirker ikke
udløsning. Dwell og pending fixed-step-fase gemmes sammen med enabled/latch/silence/
senest sampled power. Restore kræver samme authored topology og validerer reason,
audible, timer og rum. Observer-udskiftning/disposal håndteres med instans-batches;
nested step/restore/notify er afvist. Input valideres for hele første sensor-batch før
timerfasen ændres. Ugyldig strømstatus, temperatur eller røgtæthed ved update-indgangen
efterlader phase og detektorer uændret. Senere observer-/callback-fejl efter allerede
udførte ticks ruller ikke eksterne sideeffekter tilbage. Fejl fra event-observers under
`step` gemmes dog, hele fixed-step-batchen og dens detector-notifikationer færdiggøres,
og den første observerfejl kastes efterfølgende, når update-guard er frigivet.

Thermal eksponerer `hasRoom(id)`. Hvis rummet forsvinder, får tilknyttede detektorer
fault:'room-missing', powered:false og nul dwell; signalet stopper, mens latch/silence
bevares. Fault-tilstanden kan gemmes og indlæses, også mens rummet er væk. Når samme
rum-id genskabes, fortsætter detektoren ved næste sample. Et vellykket reset i et
genskabt, sundt rum opdaterer også fault/power straks. Reset i et manglende rum giver
false. Ældre alarm-data uden fault-felt får null. Engine-adapters uden hasRoom kan
fortsat bruges, men skal selv sikre, at roomState-opslag er gyldige.

Branddemoen har to lamper, sidepanel og VR-status. Alarm-state indgår i application
inde i den eksisterende fire-scene-provider, så antal checkpoint-providers er uændret.
Ældre application-data uden alarms-felt får friske detektorer ved restore; eksisterende
felter valideres strengt. Dæmpet alarm og deaktivering gendannes sammen med resten af
bygningen. Slukningsmålet vurderer selve brand-/rumtilstanden separat fra alarm-latch.
