# Midlertidig suspension og endelig oprydning

Reproduceret fejl: kontrolrummets eksisterende pagehide-handler disponerede altid host/network/renderer.
En `PageTransitionEvent('pagehide',{persisted:true})` fulgt af persisted pageshow gav derefter
`System is disposed`. Det samme mønster fandtes i bil-, brand- og værkstedsdemoen.

[HTML-standardens PageTransitionEvent-regel](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-pagetransitionevent-interface)
angiver, at persisted pagehide kan efterlade siden til senere genbrug. Det garanterer ikke, at browseren faktisk vælger at cache den.

## Fælles app-helper

`webxr-demo/src/page-lifecycle.js` tilbyder `bindPageLifecycle` med suspend/resume, releaseInput,
resetClock, dispose og en valgfri keepActiveWhenHidden-predicate. Den er en browserkomposition, ikke en gameplay-kerne.

- Cachet pagehide standser animation/update-loop og neutraliserer input, men beholder systemerne.
- Persisted pageshow genstarter først, når de øvrige suspensionsårsager også er væk. Tid siden suspension kasseres fra frame-delta.
- Skjult dokument suspenderer som standard. XR-demoerne tillader en aktiv immersive renderer som en eksplicit host-undtagelse.
- Endeligt pagehide stopper loopet og disponerer én gang; efterfølgende pageshow kan ikke genoplive disponeret state.
- Event-listeners fjernes ved terminal cleanup. En fejlet input-release stopper ikke øvrig oprydning.

Helperen ændrer ikke brugerens pausevalg. Brandstationens slangehold og bilens kørselsinput rydder op,
mens bilens autonome leak-valve bevares og får sin flow-driver igen ved resumption. Pending file-/asset-callbacks
annulleres kun ved endelig cleanup, så en cachet side ikke efterlades med en disponeret runtime.

Fire/systems nulstiller også deres init-generation ved endelig cleanup. En normal ny sideindlæsning
opretter en ny runtime og beholder eksisterende checkpoint-importadfærd.

## Verifikation

6 nye enhedstests og 311/311 samlet GameSystems-tests består. Produktionsbuild består.
17/17 browserchecks dækker fire demoer: ressource-/renderfrysning, bevarede owners, release af input,
genoptagelse, faktisk væk/tilbage-navigation og terminal oprydning uden genoplivning.

Chrome/SwiftShader-rapporten viste faktisk cachegenbrug for security og vehicle. Fire/systems vendte tilbage
ved ny indlæsning i denne kørsel; deres persisted-eventforløb er testet særskilt med browserens rigtige event-typer.
Der påstås ikke, at alle browsere altid bruger BFCache, eller at et fysisk headset er afprøvet.
Rapport: `webxr-demo/test-results/lifecycle/report.json`.
