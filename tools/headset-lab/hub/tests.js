// Pending Quest 3 headset tests, shown by the lab's hub page (hub.js) and used by serve.mjs to validate /api/results.
// Sources: docs/extensions_plan.md (steps 4, 6, 7, 9, 10: "afventer headset-test" / "Kræver headset-test") and the
// apps' query parameters, each checked against the code:
//   demo (webxr-demo/src):        ?handposes=low|mid|high (avatar.js), ?character=cc|vrm, ?vrm=<url> (character-select.js),
//                                 ?avatar=off (main.js), ?testpanel and ?grasp=low|mid|high (testpanel.js). The demo has no
//                                 ?quality: quality is the HUD select / the "Kvalitet" button on the VR panel.
//   Grasp Studio (src/main.js):   ?quality=0..3, ?side=left, ?avatar=off, ?panel, ?synthetic, ?avatarview=mirror|self;
//                                 ?character=vrm (character-select.js). Modes Greb/Animation/Gestus, the avatar view, the
//                                 figure and the variant preview are switched on the panel.
//   Recorded variants in games:   ?graspvariant=recorded|<id> (grasp setGraspVariants), ?handvariant=recorded|<id>
//                                 (avatar setHandVariants): demo src/avatar.js, Contracts src/main.js.
//   Contracts (src/main.js):      ?quality=0..3|minimal|low|mid|high, ?bottles=minimal|low|mid|high, ?handposes=low|mid|high.
// Links are paths on the lab's own origin (serve.mjs mounts /demo/, /studio/ and /contracts/). User-facing text is Danish.
// Pure data: imported by node (serve.mjs, the lab test) and by the browser (hub.js).

export const VERDICTS = Object.freeze({ virker: 'Virker', fejl: 'Fejl', delvist: 'Delvist' });

export const GROUPS = [
  {
    id: 'studio', title: 'Grasp Studio', step: 'Trin 4 og 7',
    intro: 'Optager greb, hånd-animationer og gestus med håndsporing. Læg controllerne fra dig og slå håndsporing til. Panelet ved flasken trykkes med en pegefinger (den optagende hånd tæller ikke mens den optages).',
    tests: [
      {
        id: 'studio-greb', title: 'Greb-tilstand: optag og gem et greb',
        links: [['Grasp Studio (højre hånd)', '/studio/'], ['Venstre hånd', '/studio/?side=left'], ['Med VRM-tvilling', '/studio/?character=vrm']],
        check: [
          'Tryk «Gå i VR». Flasken står foran dig, og panelet står ved siden af.',
          'Fingerspidserne er hvide (fri), grønne (kontakt) eller røde (inde i glasset).',
          'Hold hånden stille om flasken: nedtællingen (1 s) starter og optager. Er 1 s for kort eller for lang?',
          'Score og validator vises. Tryk «Gem». Over panelet skal der stå en GRØN linje «Gemt ✓ …». Står der en RØD «IKKE GEMT», så skriv teksten i noten: optagelsen ligger i køen og kan gemmes med «Gem kø».',
          'Tilbage her: «Optagede greb» i statuslinjen øverst skal være steget, med nyt tidspunkt.',
          'Føles scoren rigtig for et godt greb? Er tracking-sikkerheden stabil under grebet?',
        ],
      },
      {
        id: 'studio-animation', title: 'Animation-tilstand: optag et klip',
        links: [['Grasp Studio', '/studio/']],
        check: [
          'Skift tilstand på panelet til «Animation» (panelrække 3). Vælg et navn (fx wave).',
          'Hold stille → optagelsen starter. Bevæg hånden. Hold stille → den stopper.',
          'Er start/stop for følsom eller for træg? Er stille-halen skåret af i reviewet?',
          'Gem. Grøn «Gemt ✓ wave (…)» over panelet. «Hånd-klip» i statuslinjen her skal stige.',
          'Kan panelets nederste række nås og læses?',
        ],
      },
      {
        id: 'studio-gestus', title: 'Gestus-tilstand: optag en håndstilling',
        links: [['Grasp Studio', '/studio/']],
        check: [
          'Skift tilstand til «Gestus». Vælg navn (fx point eller thumbs_up).',
          'Hold en håndstilling stille hvor som helst (ikke på flasken). Den optages efter 1 s.',
          'Review viser posen (og spejlingen). Gem. Grøn «Gemt ✓» over panelet. «Hånd-klip» her skal stige.',
        ],
      },
      {
        id: 'studio-avatar', title: 'VRIK-avatar: se hvordan dine hænder styrer avatarens hænder',
        links: [['Spejl (CC)', '/studio/?avatarview=mirror'], ['Spejl med VRM (Jimmy)', '/studio/?avatarview=mirror&character=vrm'], ['1. person', '/studio/?avatarview=self']],
        check: [
          'Tryk «Gå i VR». Panelets nederste række: «Avatar: spejl». Et ekstra panel står på den anden side af flasken.',
          'Spejl: avataren står ca. 1,5 m foran dig og spejler dig (løfter du højre hånd, løfter den hånden på samme side som et spejl). Følger hoved, arme og fingre?',
          'Bøj hver finger for sig, knib, peg, thumbs up. Følger avatarens fingre? De cyan prikker er dine rå led i spejlet: ligger avatarens fingre på dem?',
          'Tommelfingeren: tryk «Tommel» (roll+twist → kun roll → fra). Hvilken indstilling ser mest rigtig ud ved knib og thumbs up?',
          'Tryk «Figur» for at skifte mellem CC og VRM (Jimmy). Virker begge? Står den rigtigt i spejlet?',
          'Tryk «Avatar» igen → 1. person: avatarens hænder ligger på dine egne. «Rå led» viser/skjuler de hvide XRHand-led ved siden af. Hvor meget afviger de?',
          'Tag en controller op: panelet skal vise «controller» for den hånd, og avataren følger controlleren.',
          'Kvalitet minimal slår avataren fra; lav/mellem/høj: flydende?',
        ],
      },
      {
        id: 'studio-varianter', title: 'Optagelser er varianter: originalen bevares',
        links: [['Grasp Studio', '/studio/'], ['Demo med optagede greb', '/demo/?graspvariant=recorded&handvariant=recorded'], ['Demo med originalerne', '/demo/']],
        check: [
          'Optag og gem to greb (og evt. to gestus med samme navn). Hver gem giver en ny variant; intet overskrives.',
          'Tryk «Variant» på panelet: den lilla hånd ved spøgelsesflasken viser originalen og derefter hver optagelse. Kan du se forskel?',
          'Demoen uden parametre bruger stadig de bagte greb og bibliotekets gestus (efter sync).',
          'Demoen med ?graspvariant=recorded&handvariant=recorded bruger dine optagelser. Hvilken er bedst?',
        ],
      },
      {
        id: 'studio-vaegt', title: 'Visuel vægt: tung ting får hånden til at synke og hænge lidt',
        links: [['Grasp Studio', '/studio/'], ['Demo med testpanel (vægt-lag til)', '/demo/?testpanel'], ['Demo uden vægt-lag', '/demo/?testpanel&weightlag=off']],
        check: [
          'Studio: tryk «Genstand» til barrel (tønde, 16 kg) og grib den. Panelet viser «Vægt: hånden synker N mm»: ligger N mellem 5 og 30?',
          'Den gule spøgelseshånd synker og hænger lidt efter din rigtige hånd og falder til ro uden at ryste. «Vægt: fra» skal give nøjagtig din hånd.',
          '«Rå: til» viser den hvide uforsinkede hånd ved siden af: kan du altid se den rå hånd? Det gemte greb er altid den rå hånd.',
          'Skift til bottle_beer (let): hånden skal næsten ikke bevæge sig. Er forskel på let og tungt tydelig men ikke overdrevet?',
          'Demoen med ?testpanel: tag en fyldt flaske og løft den. Synker avatarens hånd lidt med vægten? Og med ?weightlag=off: ingen forskel fra før?',
          'Contracts (?weightlag=on): standard er FRA. Giv besked hvis hånden føles forsinket eller giver kvalme.',
        ],
      },
      {
        id: 'studio-tohaand', title: 'To-hånds greb: krus, karton, stang og tønde',
        links: [['Grasp Studio', '/studio/'], ['Contracts med to-hånds genstande', '/contracts/?twohand=on&proceduralgrasps=on&weightlag=on'], ['Contracts uden to-hånds greb', '/contracts/?twohand=off']],
        check: [
          'Procedurale greb er VALGFRIE: Grasp Studio har dem slået til som standard (?proceduralgrasps=off viser kun bagningen, så pole og barrel mangler greb). Contracts og demoen har dem FRA, medmindre adressen har ?proceduralgrasps=on (to-hånds greb i Contracts kræver det).',
          'Studio: vælg «Genstand» mug, carton, pole og barrel. Hver viser en ekstra hånd (grå) på genstanden. Ligger de to hænder ved siden af hinanden uden at gå igennem hinanden?',
          'Tryk «Primær/Sekundær» (kun to-hånds genstande): sekundær optager den anden hånds greb. Hold stille, tjek score og «hænder N mm fra hinanden», og tryk «Gem».',
          'Den gemte optagelse er en ny variant (rec-tidspunkt, rolle secondary); intet overskrives. Står der rejected/ hvis den afvises?',
          'Contracts: tag stangen (ved -0.62, 7.18) eller tønden med én hånd. Tønden (16 kg) hænger tungt. Tag den med den anden hånd: den løftes nemmere og stangen retter sig mellem hænderne.',
          'Slip den ene hånd: genstanden skal fortsætte i den anden hånd uden et hop (højst få mm). Slip begge på samme tid under en bevægelse: genstanden kastes.',
          'Slip først den ene og så den anden over 0,2 s: genstanden må ikke kastes som to-hånds kast.',
          'Krus: grib i hanken (hånd 1) og i toppen (hånd 2). Hvordan ser grebet ud? (Krus-kroppen kan stadig fejle.)',
        ],
      },
      {
        id: 'studio-kvalitet', title: 'Billedhastighed pr. kvalitetsniveau',
        links: [['Minimal', '/studio/?quality=0'], ['Lav', '/studio/?quality=1'], ['Mellem (standard)', '/studio/?quality=2'], ['Høj', '/studio/?quality=3']],
        check: [
          'Føles det flydende på hvert niveau? Hakker det, når hånden er om flasken (live-lukning)?',
          'Avatar-tvillingen 50 cm til siden: vises den, og lukker hånden om flasken?',
          'Skriv i noten hvilket niveau der er det højeste, der stadig er flydende.',
        ],
      },
    ],
  },
  {
    id: 'hands', title: 'Hånd-poser og gestus', step: 'Trin 7',
    intro: 'Dataposerne og klippene på avatarens hænder. ?handposes vælger niveau: low = de gamle kurver, mid = dataposer, high (standard) = touch-gestus og kubiske klip.',
    tests: [
      {
        id: 'hands-controller', title: 'Controller-hænder i demoen',
        links: [['handposes=high', '/demo/?handposes=high'], ['handposes=mid', '/demo/?handposes=mid'], ['handposes=low', '/demo/?handposes=low']],
        check: [
          'Hold controllerne. Urørt trigger → pegefingeren peger (high).',
          'Hold grip og løft tommelen fra knapperne → thumbs up (high).',
          'Slip alt → afslappet hånd. Overgangene må ikke hoppe (pop).',
          'Grib, hæld og slip en flaske: grab-, hæld- og slip-klippene ser naturlige ud? Ser det kubiske overshoot naturligt ud?',
          'Sammenlign low / mid / high.',
        ],
      },
      {
        id: 'hands-tracked-pop', title: 'Sporet hånd: hopper fingrenes spredning, når en gestus starter?',
        links: [['handposes=high', '/demo/?handposes=high'], ['handposes=mid', '/demo/?handposes=mid']],
        check: [
          'Læg controllerne fra dig (håndsporing). Grib en flaske med hånden og slip den igen.',
          'Når slip-klippet starter (og når grebet lukker): hopper fingrenes spredning (afstanden mellem fingrene) i ét billede, eller glider den?',
          'Gentag nogle gange med begge hænder. Notér om det sker på mid, high eller begge.',
        ],
      },
      {
        id: 'hands-contracts', title: 'Pistol, støttehånd og magasin i Contracts',
        links: [['Contracts (high)', '/contracts/?handposes=high'], ['handposes=mid', '/contracts/?handposes=mid'], ['handposes=low', '/contracts/?handposes=low']],
        check: [
          'Pistolhånden: pistol-pose, går til trigger-pose når du trykker af.',
          'Støttehånden på pistolen og hånden om magasinet ser rigtige ud.',
          'Ingen hop i fingrene ved skift mellem poserne.',
        ],
      },
    ],
  },
  {
    id: 'contracts', title: 'Flasker i Contracts', step: 'Trin 9',
    intro: 'Contracts kører GameSystems-flaskerne (øl og vin) på sin egen fysik. Flaskerne står åbne, så de kan hældes.',
    tests: [
      {
        id: 'contracts-flasker', title: 'Hældning, væskefarve, pytter og blanding',
        links: [['Contracts', '/contracts/'], ['bottles=mid', '/contracts/?bottles=mid'], ['Med viskositet', '/contracts/?viscosity=on']],
        check: [
          'Væske-shaderen og det gennemsigtige glas ser rigtige ud i headsettet.',
          'Grib en åben flaske og hæld: strålen og dråberne har flaskens farve (øl gylden, vin mørkerød).',
          'Hæld på bordet og gulvet: der dannes pytter. Hæld vin i en ølpyt: blandes farven?',
          'Hover-omridset følger glasset.',
          'Valgfrit ?viscosity=on: skyd et hul i en flaske og sammenlign udstrømningen. Øl løber ca. 4 % og spiritus ca. 6 % langsommere end uden flaget (kun en lille forskel; uden flaget er den som før).',
        ],
      },
      {
        id: 'contracts-brud', title: 'Brud, lyd og skår',
        links: [['Contracts', '/contracts/']],
        check: [
          'Kast en flaske hårdt mod gulv eller væg: den knuses (grænse 2,5 m/s). Et blødt kast giver højst en revne. Føles grænsen rigtig?',
          'Skyd en flaske: den knuses, skårene flyver med skuddet, og der sprøjter væske.',
          'Lyd ved stød og brud. Kommer den til tiden?',
          'Kendt afvigelse: en holdt flaske knuses ikke ved slag (kun ved skud). Savnes det?',
        ],
      },
      {
        id: 'contracts-lyd', title: 'Lyd i Contracts (?audio): retning, fodtrin, hænder og flasker',
        links: [['Med lyd', '/contracts/?audio'], ['Med lyd og forsinkelse', '/contracts/?audio=delay'], ['Uden lyd (som før)', '/contracts/']],
        check: [
          'Tryk på Enter VR (eller klik i vinduet) først: browseren starter lyden ved første brugerhandling. Uden ?audio skal alt lyde som før.',
          'Hører du retning: stil dig ved bordet, grib flasken med venstre hånd og slå den mod bordet. Peger lyden mod flasken, og skifter den side, når du drejer hovedet?',
          'Hører du fodtrin på beton: gå 5-6 meter hen ad gulvet. Kommer der ét trin for hver ca. 0,7 m, ikke for højt og ikke i takt med at du står stille eller drejer på stedet?',
          'Hører du fodtrin, når du kun bevæger hovedet fysisk (rumskala)? Stopper trinene med det samme, når du står stille?',
          'Hænder: lyder det som hud mod glas, når du griber og slipper flasken, kruset og kartonen? Giver kartonen en pap-lyd (fold) ved grebet?',
          'Flaske: hæld, sæt flasken hårdt ned og kast den mod gulvet. Kommer hæld-lyden fra flasken i din hånd og knusningen fra stedet, hvor den slog?',
          'Med ?audio=delay: kast en flaske langt væk (8-10 m). Kommer lyden et øjeblik efter slaget (højst 0,25 s), og virker det naturligt, ikke forvirrende?',
          'Pistol og vagternes lyd er uændret og stadig højest. Mærk forskel på Quest-ydelsen med og uden ?audio, og skriv billedtiden i noten.',
          'Døre og skuffer: findes ikke i Contracts (derfor ingen knirk her).',
        ],
      },
      {
        id: 'contracts-kvalitet', title: 'Ydelse pr. kvalitet',
        links: [['quality=3 (høj)', '/contracts/?quality=3'], ['quality=2', '/contracts/?quality=2'], ['quality=1', '/contracts/?quality=1'], ['quality=0', '/contracts/?quality=0'], ['høj + bottles=mid', '/contracts/?quality=3&bottles=mid']],
        check: [
          'Flydende eller hakkende ved hældning og pytter? Sammenlign flasketier high og mid.',
          'Skriv i noten det højeste niveau, der stadig er flydende.',
        ],
      },
    ],
  },
  {
    id: 'demo', title: 'Flasker i demoen', step: 'Flaskedemo',
    intro: 'Flaskedemoen med hylder, bar og vinduer. Kvalitet skiftes med «Kvalitet»-knappen på panellet i VR (demoen har ingen ?quality).',
    tests: [
      {
        id: 'demo-flasker', title: 'Flasker, hældning, pytter og brud',
        links: [['Demo', '/demo/'], ['Uden avatar', '/demo/?avatar=off'], ['Uden viskositet (testpanel)', '/demo/?testpanel&viscosity=off']],
        check: [
          'Grib (grip), hæld og stil flasker. Væske, glas og pytter ser rigtige ud.',
          'Kast mod gulv og ruder: brud, skår og lyd.',
          'Panelet i VR: «Nulstil» og «Kvalitet» virker. Hvilket niveau er flydende?',
          'Jerrycan med diesel og de andre beholdere opfører sig fornuftigt.',
          'Viskositet er valgfri: /demo/ uden flag er som før, ?viscosity=on eller ?testpanel gør huller i tykke væsker lidt langsommere (?testpanel&viscosity=off slår den fra).',
        ],
      },
      {
        id: 'demo-lyd', title: 'Lyd i demoen (?audio): retning, fodtrin, knirk og forsinkelse',
        links: [['Med lyd', '/demo/?audio'], ['Med lyd og testpanel', '/demo/?audio&testpanel'], ['Uden lyd (som før)', '/demo/']],
        check: [
          'Tryk på Enter VR først (lyden starter ved første brugerhandling). Uden ?audio er alt som før.',
          'Hører du retning: tag en flaske og slå den mod baren, gulvet og hylden. Kommer lyden fra flasken, og kan du pege på den med lukkede øjne?',
          'Hører du retning ved brud: kast en flaske ned på gulvet 3-4 m væk og drej hovedet. Kommer knusningen fra gulvet, ikke fra dit hoved?',
          'Hører du fodtrin på beton: gå med venstre stick eller fysisk 5-6 m over gulvet. Ét trin pr. ca. 0,7 m, lavt i lydstyrke, og ingen trin, når du står stille?',
          'Hører du fodtrin på træ: gå hen over baren eller hylderne, hvis du kan (ellers noter, at trægulv ikke findes i demoen).',
          'Hæld fra en holdt flaske: kommer glugge-lyden fra flasken i hånden, og følger den med, når du bevæger hånden?',
          'Grib og slip: hud-mod-glas-lyd ved flasken (ikke i hovedet). Tabt pistol: metalklang ved gulvet.',
          'Knirk (dør/skuffe): demoen har ingen dør med hængsel på hovedsiden (kun brand-laboratoriet); noter om du savner det.',
          'Med ?audio og testpanelet: aflæs frame-tiden med og uden lyd og skriv den i noten.',
        ],
      },
    ],
  },
  {
    id: 'vrm', title: 'VRM-karakter og håndprofil', step: 'Trin 6 og 10',
    intro: 'Testmodellen Jimmy (CC0) med kalibreret håndprofil. Demoen bruger kun øl- og vin-grebene: alt under 30 cm får øl-grebet, også krusene. Dåse-, krus- og karton-grebene findes kun i Contracts med CC-karakteren.',
    tests: [
      {
        id: 'vrm-greb', title: 'VRM-greb i demoen (Jimmy)',
        links: [['Demo med VRM', '/demo/?character=vrm'], ['VRM + testpanel', '/demo/?character=vrm&testpanel']],
        check: [
          'Jimmy vises som avatar (statuslinjen her siger om modellen er på plads).',
          'Grib øl- og vinflasker med begge hænder: hånden lukker om glasset, uden fingre inde i glasset og uden luft i håndfladen.',
          'Krusene (får øl-grebet her): notér hvordan de ser ud.',
          'Venstre og højre hånd ens? (Jimmy har lidt forskel mellem siderne.)',
        ],
      },
      {
        id: 'contracts-greb', title: 'Dåse, krus og karton i Contracts (CC-hånd)',
        links: [['Contracts (bagte greb, standard)', '/contracts/'], ['Contracts med procedurale greb', '/contracts/?proceduralgrasps=on']],
        check: [
          'Grib dåsen: forventes at virke.',
          'Grib kruset og kartonen: kendte fejl (krus: tommelen rører ikke; karton: håndleddet bøjet ca. 95°). Se om det er så slemt som forventet.',
          'Med ?proceduralgrasps=on (valgfrit): grib kruset i hanken og kartonen i siderne, og tag den ekstra stang og tønde på bordet. Er det bedre end standarden? Uden flaget skal alt være som før (ingen stang eller tønde på bordet).',
        ],
      },
      {
        id: 'studio-stige', title: 'Stige, krus-krop, albue-hint og ?twohand-advarsel',
        links: [['Grasp Studio', '/studio/'], ['Contracts: stige + to-hånds + vægt', '/contracts/?twohand=on&proceduralgrasps=on&weightlag=on'], ['Contracts: ?twohand alene (advarsel)', '/contracts/?twohand=on']],
        check: [
          'Contracts ?twohand=on ALENE: en toast/statuslinje siger at stang og tønde mangler greb (kræver &proceduralgrasps=on). Med begge flag er beskeden væk.',
          'Med begge flag: grib stigen (ved -0.62, 6.55, på gulvet) med højre hånd på ét trin og venstre på et ANDET trin. Ligger fingrene rundt om trinnet, og retter stigen sig mellem hænderne?',
          'Grib kruset i KROPPEN: tommelen skal opponere uden at knække. Uden ?proceduralgrasps=on skal kruset være som før.',
          'Med ?weightlag=on (kvalitet høj/mellem): løft tønden. Albuen bøjer en anelse (højst få cm); intet ryk, ingen kvalme. Kvalitet lav: kun håndens synk, ingen albue.',
          'Studio: «Genstand» til ladder og mug (gruppe body via «Hals»); optag og gem som før.',
        ],
      },
      {
        id: 'handprofil-runtime', title: 'Håndprofil under spil (setHandProfile)',
        links: [['Demo + testpanel', '/demo/?testpanel'], ['VRM + testpanel', '/demo/?character=vrm&testpanel']],
        check: [
          'Testpanelet står over demoens panel. Peg på «Hånd» og tryk (trigger): skifter mellem normal, størrelse 1,15 / 0,9 og tykkelse 1,3 / 0,8.',
          'Grib en flaske efter hvert skift: grebet lukker på den nye profil (større hånd → håndfladen længere ud, tykkere → fingrene stopper tidligere).',
          'Skiftet sker uden hak eller fejl, og «normal» giver det oprindelige greb tilbage.',
        ],
      },
    ],
  },
  {
    id: 'perf', title: 'Ydelse', step: 'Trin 3 og 10',
    intro: 'Hvad koster lukning-til-kontakt med søgning (grebskvalitet mid, standard) på Quest? Testpanelet viser frame-tid og hvor lang tid det sidste greb tog.',
    tests: [
      {
        id: 'perf-mid', title: 'Pris for mid-søgning ved greb',
        links: [['grasp=mid (standard)', '/demo/?testpanel&grasp=mid'], ['grasp=low (ingen søgning)', '/demo/?testpanel&grasp=low'], ['grasp=high', '/demo/?testpanel&grasp=high'], ['VRM + mid', '/demo/?character=vrm&testpanel&grasp=mid']],
        check: [
          'Grib en flaske, du ikke har grebet før (første greb pr. flaske og hånd koster; derefter er det gemt).',
          'Aflæs «Greb: … ms» og «Frame: … ms snit / maks» på testpanelet.',
          'Kan du se et hak i billedet ved grebet? Sammenlign mid med low.',
          'Skriv tallene i noten (fx «mid: greb 12 ms, frame 14/30 ms»).',
        ],
      },
    ],
  },
];

/** id -> { test, group } for every test. */
export function testIndex(groups = GROUPS) {
  const index = new Map();
  for (const group of groups) for (const test of group.tests) index.set(test.id, { test, group });
  return index;
}
