# Bilens låse og bevægelse

Der blev reproduceret to fejl i den eksisterende bilkerne: en hængsel fortsatte fra fraction 0,28 til 0,56
efter låsning, og samme fem sekunders kurvede kørsel gav forskellige positioner ved 30 og 90 FPS.

## Paneler

`setLocked` stopper nu også en igangværende animation. Fraction bliver stående, mens target bevares,
så oplåsning kan fortsætte den afbrudte bevægelse. Nye kommandoer til låste dele afvises.
Åbning blokeres ved mere end 0,5 m/s, også for et target, som blev valgt før bilen begyndte at køre.
Start-/sluthastighed for intervallet bruges som en konservativ sikkerhedskontrol. Lukning er stadig mulig under kørsel.
Vehicle Lab har en fælles Lock/Unlock-panels-knap og viser, hvorfor en kommando er blokeret.

## Integration og ressourcegrænser

Den gamle integration brugte slut-hastighed/slut-heading til hele intervallets position.
Den nye kurvede bevægelse bruger RK4, som integrerer speed, heading, position, afstand og hjulvinkel sammen.
Normalopdateringer deles i højst 1/60-sekundstrin. Hvert engine-on/off-segment er begrænset til 600 integrationstrin;
en bil i ro springer arbejdet over, og konstant bevægelse ved hastighedsloftet bruger analytisk kurveintegration.
Lange intervaller er stadig en approximation for motion; ressourcer regnes over hele intervallet.
`step` afviser over én dags catch-up før ændring. Brug frame-sized updates til almindelig kørsel.

Et analytisk stop-tidspunkt forhindrer, at bremse-/friktionsintegration passerer gennem nul og skaber baglæns jitter.
Modsatrettet gear kan begynde at accelerere efter det faktiske stop, mens en stærk bremse holder bilen i ro.

Motorens understøttede driftstid bestemmes af tilgængeligt brændstof og eventuelt batteribehov ud over alternatoren.
Motoren giver kun trækkraft i den del af intervallet. Ved tomt batteri med en svag/ingen alternator bruges brændstof
og motorens bidrag frem til strømsvigtet, derefter fortsætter kun friløb/bremsning. Det præcise slut-tidspunkt for
brændstof kan også stoppe motoren i samme update; der kræves ikke en ekstra frame.
Tilbehør får fortsat sit behov efter motorstop. Frakoblede batterier lades ikke af bilens alternator.

Brændstofraten bruger intervallets indledende hastighed og aktuelle throttle, som en enkel game-tuning.
Der er ingen ny collision-, suspension- eller tire-slip-solver. Controller-input og model/adapterstater kan fortsat
gemmes med de eksisterende checkpoint-API'er; locks og afbrudte targets bevares.

## Verifikation

9 nye regressionstests dækker låsning midt i animation, bevægelsesgrænse, 30/60/90 FPS-bane, stop/reverse,
præcis brændstofgrænse, delvist strømsvigt, store stationære intervaller, ugyldig tid og checkpoint.
Den reproducerede femsekunders bane ændrede sig tidligere omtrent 0,34 m mellem 30 og 90 FPS;
den nye isolerede motion-test måler omtrent 4,2e-10 m og testes med en bredere tolerance på 1e-5 m.
Dette er en softwaremodel-test med ressourceafhængigheder deaktiveret, ikke fysisk kørsels- eller headsetmåling.

6/6 nye browserchecks bruger native lås/åbn/kør/pause/bremse-betjening og den faktiske GLB-hængsel.
Den eksisterende vehicle- og checkpoint-browserkontrol består også (8 og 7 checks).
Rapport/screenshot: `webxr-demo/test-results/vehicle-motion`.
