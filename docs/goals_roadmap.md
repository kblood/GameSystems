# Mål og køreplan (Claude)

Opdateres efter hver runde. Hvert mål har et målbart kriterium. Regler fra brugeren gælder altid: tilføjelse, ikke erstatning; opt-in og slået fra som standard i spillene; kvalitetsniveauer og billigt nok til Quest; intet headset-resultat påstås uden test på hardware; commit kun på grene, aldrig push uden aftale.

## Aktive mål

| # | Mål | Færdig når | Status |
|---|---|---|---|
| G1 | Møbler og interaktive objekter (skabe, skuffer, døre, låse, kister) som datadrevet extension | `extensions/furniture/` med mindst 8 typer, hængsler/slidere fra `mechanics`, greb og to-hånds, lyd (knirk, lukkelyd), indhold via beholderkernen fra backpack, lås/nøgle, tier-niveauer, tests, demo-scene, hub-test til Quest | leveret i node og headless Chrome; Quest-test mangler (se [furniture_system.md](furniture_system.md)) |
| G2 | Afmonterbar rygsæk (P3 Nightfall) | opt-in flag, ni eksisterende suiter grønne med og uden flag, nye suiter, Frame-testtrin | i gang |
| G3 | Backpack og møbler i three.js (P7–P8) | extension med samme golden-vektorer som Godot (paritet 0 forskelle), demo | afventer G2 |
| G4 | Port af vægt, to-hånds greb, lyd og farveblanding til Godot | samme tal som JS-testene, paritet hvor muligt | afventer |
| G5 | Forbedringsrunde på tværs af projekter | prioriteret liste fra `improvement_backlog.md`, `game_system_ideas.md` og kendte fejl, hvert punkt med størrelse og risiko | i gang (audit) |
| G6 | Kendte fejl og mangler | karton-håndled, Jimmy-kalibrering, kontaktlyd for krus og karton, skrab-udløser, flaky tidstest | afventer G5 |
| G7 | Test på hardware | brugerens Quest- og Frame-test via lab-hubben; resultater i `docs/headset_results.jsonl` | venter på bruger |

## Regler for mig selv
- Før jeg bygger noget: tjek om det findes (det har vist sig at spare tid).
- Hver runde: kør alle suiter, kontrollér standardopførsel uændret, rapportér tal og hvad der ikke er afprøvet i headset.
- Mål, der kræver brugerens beslutning, står som spørgsmål, ikke som antagelser.
