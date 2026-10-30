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
| G6 | Kendte fejl og mangler | karton-håndled, Jimmy-kalibrering, kontaktlyd for krus og karton, skrab-udløser, flaky tidstest | afventer G5; bølge 0 (2026-10-24): "flaky tidstest" var to deterministiske test-forældelser efter `a9fe1ee` og `7e3c0dc` plus én ægte realur-flake, alle rettet i testene (F17); samlet Godot-runner (F16) og synk-gate (F20) leveret, se [improvement_proposals.md](improvement_proposals.md) |
| G8 | LOD-system for MakeHuman-karakterer (morphs og skinvægte bevaret) | CharacterCreator-branch `feature/lod`: LOD0/LOD1/LOD2 for krop og tøj, alle shape keys og vægte overført til hver LOD med målt maksfejl pr. morph, Blender-test, node-test, zombie-spillet bruger LOD og holder trekantbudgettet uden at ændre udseendet ved nær afstand | i gang. 2026-10-29: LOD1/LOD2 for krop, tøj og hår er bygget på CharacterCreator-branch `feature/lod` (`npm run lod`, `tools/make_lod.mjs`, se `docs/LOD_SYSTEM.md` på branchen), ikke merget til master. Zombiespillet bruger dem ikke endnu; det er flyttet til sit eget projekt `ZombieGame` ([../../ZombieGame/docs/zombie_game.md](../../ZombieGame/docs/zombie_game.md)), og hvordan LOD-filerne skal nå spillet (via Contracts eller GameSystems avatar-assets) er en åben beslutning der |
| G7 | Test på hardware | brugerens Quest- og Frame-test via lab-hubben; resultater i `docs/headset_results.jsonl` | venter på bruger |

## Regler for mig selv
- Før jeg bygger noget: tjek om det findes (det har vist sig at spare tid).
- Hver runde: kør alle suiter, kontrollér standardopførsel uændret, rapportér tal og hvad der ikke er afprøvet i headset.
- Mål, der kræver brugerens beslutning, står som spørgsmål, ikke som antagelser.
