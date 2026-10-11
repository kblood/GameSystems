# Nye selvstændige gamesystems

Oprettet 2026-10-10. Målet er at implementere og verificere alle seks systemer nedenfor.
Kilden til sandhed er `GameSystems/extensions`; hver extension følger den eksisterende host-kontrakt.
Første runtime er Three.js/WebXR. Native Godot-porte er en senere opgave; de eksisterende Godot-systemer ændres ikke.

## Idéer og første version

| System | Idé | Første verificerbare version |
|---|---|---|
| mechanics | Fysiske skuffer, hængsler, ventiler og låse | Begrænsede lineære/roterende frihedsgrader, modstand, stop, greb og tohåndsinput; strømstyret lås |
| electricity | Batterier, ledninger, kontakter, sikringer og forbrugere | Lavspændings-DC-netværk med strøm/effekt, afbrudte forbindelser, sikringsoverlast og lampe |
| materials | Vådhed, tørring, pletter og friktion | Registrerede overflader modtager væske; begrænset vandmængde, tørring og materialeafhængige reaktioner |
| thermal | Antændelse, varmeoverførsel og slukning | Brændbart objekt, temperatur, begrænset brændstof, overførsel til nabo og slukning med vand |
| tools | Værktøjer og fysisk samling | Skruer, søm og indsættelige dele med afstands-/orienteringskrav, passende værktøj og afmontering |
| acoustics | Lydudbredelse mellem rum | Rum/portaler, døråbning og materialedæmpning, forsinkelse og stimulus til AI |

## Samspil

- Vedligeholdelsesstation: åbn skuffen, tag sikringen, sæt den i skabet, drej kontakten, få lys og oplås døren.
- Spild gør en registreret overflade våd og ændrer dens friktion; vand kan køle/slukke en brand.
- En ventil kan styre et spildefineret flow; elektricitet kan styre låse, varmelegemer og andre forbrugere.
- Værktøjers stød og mekaniske stop sender lydhændelser; dørens åbning påvirker lyd mellem rummene.
- Eksisterende flasker kobles via en bridge på deres offentlige API eller dokumenterede events; nye systemer importerer ikke flaskernes interne filer.

## Kontrakter og afgrænsning

Hvert modul eksporterer en engine-uafhængig `create…System()` og en default extension-factory.
Public API bruger stabile id'er, meter, sekunder, radianer og navngivne enheder. Eventnavne starter med systemets id.
Systemerne kan bruges alene; spillets composition/bridge forbinder dem. Valgfrie fysik- og renderinghooks tilhører værten.
Ingen extension importerer en anden extensions interne filer. `minimal/low/mid/high` må reducere visuelle detaljer og
arbejdsbudgetter, men må ikke ændre puzzle-resultater. `dispose()` fjerner registreringer og host-listeners.

Første version er afgrænsede spilmodeller: mekaniske koordinater frem for en ny rigid-body-solver, resistive DC-kredsløb,
samlet overfladevådhed, samlet objekttemperatur og portalbaseret lyd. Ingen påstand om fuld fysisk simulation.

## Verifikation og accept

1. Selvstændige tests for stop/låse, kredsløb/overlast, væskebalance/tørring, varme/slukning, værktøjskrav og lydveje.
2. Integrationstest for stationen og for væske → materiale → slukning samt dør → lydudbredelse.
3. Ressource- og lifecycle-tests: kvalitetsskift, gentagen oprettelse/oprydning og ugyldige input.
4. Spilbar browser-lab med alle seks systemer; browserkontrol af faktisk UI/3D, fejl og reset.
5. Eksisterende demo-tests og produktionsbuild skal fortsat bestå.
6. Headset-input, komfort og performance er kun godkendt efter fysisk headset-test; browserkontrol dokumenteres separat.

## Første WebXR-leverance — historisk status (2026-10-10)

Mål oprettet. Alle seks systemers første version samt workshop-composition og browser-lab er implementeret.
Ved første leverance bestod kerne- og integrationstests (101/101 samlet), produktionsbuildet og browserkontrollen (12/12 scenarier).
Det er historiske resultater for første WebXR-version; nyere løbende resultater står i [game_systems_implementation.md](game_systems_implementation.md).
Fysisk headset-validering og native Godot-porte er senere arbejde.
Resultater, afgrænsninger og API-brug: [game_systems_implementation.md](game_systems_implementation.md).
