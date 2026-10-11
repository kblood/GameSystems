# Kameraer og skærme

`extensions/cameras` er en selvstændig Three.js-extension. Den bruger renderer, scene og THREE
fra host-context; applikationen ejer kameraernes placering og skærmenes meshes.
Flere skærme kan dele ét kamera uden at generere flere billeder af samme feed.

```js
import camerasExtension from './extensions/cameras/index.js';
const cameras = await host.load(camerasExtension);
cameras.addFeed('hall', { camera: hallCamera });
cameras.addScreen('desk', { mesh: displayPlane, feedId: 'hall' });
cameras.switchFeed('desk', 'garage'); // 'garage' must already be registered
cameras.setScreenEnabled('desk', false);
```

Direkte brug sker med `createCameraSystem({THREE,renderer,scene})` og `step(dt)`.
Public API: `addFeed`, `addScreen`, `feedState`, `screenState`, `texture`, `switchFeed`,
`setFeedEnabled`, `setScreenEnabled`, `removeFeed`, `removeScreen`, `stats`, `setQuality`,
`capture`, `prepareRestore`, `restore`, `dispose`. `feedScene` kan vælge en separat scene pr. feed.
Et feed bruger et PerspectiveCamera; skærmen skal være et mesh med én materialekanal.

## Budget og rendering

| Kvalitet | Maksimal teksturdimension | Maks billeder/s pr. feed | Maks feeds rendret pr. step |
| --- | ---: | ---: | ---: |
| Minimal | 128 | 2 | 1 |
| Lav | 256 | 4 | 1 |
| Mellem | 512 | 8 | 2 |
| Høj | 1024 | 15 | 2 |

Aspect bevares med begge dimensioner begrænset; stående kameraer opretter ikke utilsigtet enorme targets.
Standardregistrene tillader højst 16 feeds og 32 skærme. Der rendres kun feeds valgt af en aktiv,
synlig skærm; skjulte forældre tæller også som skjult. Round-robin fordeler arbejdet mellem feeds.
Der køres ikke catch-up-rendering af tabte billeder. Kvalitet kan ændres under drift.
Synlighed er objektets/forældres flag, ikke en fuld frustum-/occlusiontest.
Hvis et feed-render fejler, gendannes rendererens state, allerede rendere feeds opdaterer deres skærme,
fejlen sendes videre, og round-robin-cursoren flyttes forbi feedet, så en vedvarende fejl ikke blokerer
de øvrige aktive feeds på efterfølgende frames.

Skærme skjules under feed-rendering, så monitorer ikke sampler deres eget aktive render target.
Rendererens target, cube face/mip-level, viewport, scissor, autoClear og XR-flag gendannes i finally,
også ved renderfejl. Der renderes et almindeligt monobillede til feedet, når viewer-rendereren bruger XR.
Targets og systemets skærmmaterialer ryddes ved fjernelse/dispose. Det oprindelige skærmmateriale
gendannes; applikationens kameraer, geometri og oprindelige materialer destrueres ikke af extensionen.

## Checkpoint og strøm

Provider-tilstanden gemmer kameraflag, skærmflag og feedvalg med fuld validering før commit.
GPU-billeder regenereres efter restore. Kameraposer, optik, kvalitet og objekter i scenen er
applikationens ansvar og er ikke en del af denne providers checkpoint.
Systemet kræver ikke strømnettet; applikationen kan styre enabled/visibility via en strøm-/batteriadapter.

`webxr-demo/security.html` er en kontrolrumsdemo med tre vinkler og én fysisk skærm.
Et lille endeligt 2 Wh-demobatteri driver den valgte kamera/skærm-kombination via det faktiske DC-net,
ledninger, afbryder og sikring. Modstandene repræsenterer omtrent 12 W/24 W ved 12 V.
20× tid gør tømning hurtigt afprøvbar. Genopladning tænder igen. Se [strømnettet](electricity_system.md).
Kamera-billeder opdateres under gameplay-pause,
mens batteri og den bevægelige genstand forbliver pauset.

Verifikation: 8 kerne-/renderer/lifecycle-tests, 15 faktiske browserchecks med aflæsning af render-target-pixels
og betjening af strømnet/sikring samt produktionsbuild består. Tre feeds indeholder forskellige faktiske
billeder; kontrollerne dækker slukning, kvalitet, checkpoint og tømning/genopladning.
Screenshot/rapport: `webxr-demo/test-results/cameras`. Headset-performance er ikke målt.
