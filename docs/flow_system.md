# Vedvarende flow og slange

`extensions/flow` er en selvstændig, engine-uafhængig host-extension. Den kræver kun supply-systemets
`state`/`draw`-API. Rendering, målvalg og køleeffekt ligger i applikationen gennem callbacks.

```js
const flow = await host.load(flowExtension, {
  resolveTarget: emitterId => currentTarget,
  acceptTarget: target => targetStillExists(target),
  apply: receipt => applyLiquidEffect(receipt),
});
flow.add('hose', { tankId: 'hose-tank', sourceKey: 'hose', rateMlPerSecond: 240 });
flow.start('hose', 'left-hand');
flow.stop('hose', 'left-hand');
flow.pulse('hose', 80); // or pulse with an explicit target
```

API: `add`, `state`, `start`, `stop`, `stopAll`, `setTarget`, `pulse`, `step`, `capture`,
`prepareRestore`, `restore`, `setQuality`, `dispose`. Flere inputejere deler samme dyserate;
de dobler ikke flowet. En ejers release stopper kun den ejers hold, mens stopAll afbryder alle.

## Væske og mål

Hvert simulation-step afgiver rate × dt, begrænset af faktisk væske i tanken. Kernen bruger analytisk
dosering og har intet ekstra fixed-step-restlager. Kvalitet ændrer ikke logisk flow.
Standardbudgettet er 32 dyser; opdateringer over 10 sekunder afvises før forbrug.
Væskekomponenter følger donorens faktiske blanding, også ved næsten tom tank eller en dosering over kapaciteten.

Målet indeholder `surfaceId`, `roomId`, `targetId`, `position` og valgfri `impactPosition`.
Ugyldige vektorer, intet mål eller afvist mål bruger ingen væske. targetId kan være null ved gulv-deposition.
`flow:deposit` og `liquid:deposit` har `emitterId`, ikke et globalt pool-id, så en flyttet slange kan lave
forskellige pytter. Effekter og begge eventtyper modtager hver deres kopi af payloaden.
Når en gyldig levering har trukket væske og opdateret emitter-ledgeren, forsøger flow begge receipts selv hvis
`apply` eller den første `emit`-callback kaster. Den første callback-fejl kastes videre efter begge forsøg;
leveringen er allerede bogført og må ikke gentages.

Appen bestemmer væskens effekt. I brandstationen køler kun vanddelen et objekt eller en pool.
Alle komponenter projiceres til den relevante gulvpyt med kilde `hose`. Som i sprinklerdemoen er dette
en gameplay-effekt/projektion; der modelleres ikke hydraulisk tryk, tyngdekraft for dråber eller præcis materialemasse.

## Betjening i brandstationen

Tilføjelse: flow har nu også en separat skumdyse og donor, med doseringsvalg og overfladeeffekt.
Normal og stråleretning følger receipts og checkpoint-targets. Se [coatings_system.md](coatings_system.md).

Slangen har sin egen genopfyldelige 1,2-litertank i supply-systemet. Desktop kan holde »Hold slange«
med mus eller Enter/mellemrum for flow mod den valgte genstand. Den eksisterende 80 ml-knap kan stadig
bruges under pause som en scene-edit. Flowet vises med én genbrugt vandlinje.

Pointerup, pointercancel, lostpointercapture, tast-release, fokus-tab, skjult dokument, pause og reset
afslutter de relevante input. Resume eller indlæsning starter ikke automatisk et gammelt fysisk hold igen.
XR-controllerne deler viewerens rig og kan sigte mod objekter, pytter og gulv via et raycast på højst 8 meter.
Synlige vægge, dør, rude og andre blokkerende scene-meshes stopper strålen. Dør-/vinduebetjening bevares.
XR-VAND-knappen giver vedvarende flow mod det valgte mål; direkte scene-aim følger controlleren løbende.

## Checkpoint

Flow gemmer konfiguration, mål og faktisk emitteret/pulseret volumen. Held inputs og aktuel strålevisualisering
er transient kontrol/presentation og neutraliseres ved commit. Source-tanken beholder sin fulde supply-ledger.
Supply-planens public `state(id)` giver validatorer den kommende tanktilstand før live commit.

Fire-scene-provider kan nu komponere supply og flow sammen med thermal/pools/bottles/mechanics/application.
Den validerer emittedMl mod donorens drawnMl og den bevarede pool-provenance mod emitterens kvittering.
Flow og bottles må ikke dele sourceKey. Brandstationen gemmer supply/flow **inde i fire-providerens payload**,
så vandvisning, donor og emission valideres samlet; øvrige providers som sprinklers/pump/power/interest bevares separat.
Ældre gemninger med den tidligere providerstruktur afvises før ændring af den aktive station.

## Verifikation

Tests dækker varighed, stop/release, to inputejere, blandinger, tom/ugyldig aim, payload-isolation,
quality/frame-partition, held-input-neutralisering, staged source-validation, stop fra callback, numerik, kildeidentitet og ugyldige simple adaptorer.
Samlet GameSystems-suite: 268/268 bestået; produktionsbuild består.
17/17 browserchecks omfatter native mus/tastatur, annullering, fokus-tab, pause/resume, refill, save under flow,
korrupte ledgers, reelle 3D-rays gennem lukket/åben dør, tanktømning, provenance og reset.
XR-inputdelen bruger simulerede controller-events/poses i browseren; et fysisk headset er ikke afprøvet.
De eksisterende 8 checkpoint- og 15 sprinkler-/pumpe-browserchecks består også.
Rapport og screenshot: `webxr-demo/test-results/flow`.
