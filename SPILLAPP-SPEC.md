# The Fantastic FORE! — Spillapp-spesifikasjon (v2-retning)

*Utarbeidet 3. august 2026. Grunnlag for ombyggingen fra HCP-app til spill/konkurranse-app.*

---

## STATUS pr. 26. september 2026 (koden er fasit)

Dette dokumentet ble til FØR mye ble bygget. Denne blokken beskriver hva som
faktisk er bygget og live (v1.201). Resten av spec'en er dels historikk,
dels backlog — les den med denne blokken som fasit.

**Spillmotor og spill**
- **Spillmotoren (§3):** splittet i `games-core.js` + `game-*.js` (én fil per
  spill). Kontrakten tar `ctx`-objekt og har `defaultConfig()` + `settle(ctx)` (§8).
- **Hovedspill:** Stableford, Scramble, **Best Ball** (`game-bestball.js` —
  flighten er laget, beste Stableford per hull blant lagkameratene, individuell
  scoring, lagresultatet regnes i etterkant).
- **Sidespill:** Skins, Nassau, Quota, **Sidekonkurranse/junk** (`game-junk.js`:
  🎯 nærmest pin, 🚀 lengst drive, pluss straffevariantene 🤦 lengst fra pin og
  🐌 kortest drive som gir minuspoeng). Vinner bekreftes/overstyres i
  rundeoppsummeringen.
- **IKKE bygget:** Wolf (§5.2), Matchplay (§5.6), Mulligans/Gilligans (§5.7),
  Kølle-lodd (§5.8).

**Flyt, flighter og deling**
- **§2-flyten:** 4-stegs wizard + hjemskjerm med «Start et spill» og hamburger.
- **Multi-flight (§2.7):** G1–G5 bygget, inkl. **G1b** (scramble: ett lag = én
  flight, `game_teams.flight_id`, lagene rangeres samlet på tvers i live).
- **§2 E (utslag):** drive_used-logging, §11.3-kvote med eskalerende varsler og
  automatisk straff er bygget. Gjester kan taste utslag for eget lag.
- **Admin:** kan redigere alle flighter/lag på en AVSLUTTET runde (ellers kun
  egen flight). Manuell overstyring av lag-HCP i scramble-oppsettet.

**Scoring-skjermen (v1.198–v1.200)**
- **Lagringskø:** +/- oppdaterer skjermen umiddelbart; endringer legges i
  localStorage (`fore_pending_writes`) og fjernes først når Supabase har
  bekreftet. Køen sendes før runden hentes på nytt (oppvåkning/oppstart).
  Hullbytte venter på lagring (kan overstyres ved dårlig dekning); «Avslutt
  runde» krever at alt er lagret. Eldre køede endringer forkastes hvis serveren
  har en nyere verdi. Scramble-utslag og junk går via samme kø (klient-generert
  id → idempotent).
- **Kompakt layout:** kun egen flight vises (tilskuere/admin på avsluttet runde
  ser alle), toppfelt med 🏆 + ⋯-meny (oppsett, del, bytt tee, avslutt), hullinfo
  på én rad, stilling som chips, «Neste hull» fast nederst.
- **Ledertavle i PGA-stil** (fullskjerm): Pos/Spiller/Netto/Thru/Poeng med «T»
  for delt plass; trykk gir PGA-scorekort (hull 1-9 / 10-18, sirkel/firkant,
  prikker for tildelte slag). Samme kort brukes for scramble-lag (tall fra
  `ScrambleGame.compute`, straff inkludert) og i rundeoppsummeringen.

**Turnering og øvrig**
- **Turnering** (`tournament.js`): sammenlagt over flere runder med
  **plasseringspoeng** (ikke rå Stableford-sum), +3 vinnerbonus for Stableford-
  vinner, vinnerlag i scramble og vinner-flight i Best Ball. Én kolonne per
  runde (R1, R2 …). Alle kan opprette; kun admin kan redigere/slette/justere.
  Egen knapp i bunnmenyen + hamburger.
- **Baneguide:** AI-generert strategitekst per hull (`holes.guide_text`),
  vises via 🧭 på scoring-skjermen.
- **Oppgjøret (§8):** generisk `settle()` + netting på tvers.
- **Statistikk (§9):** individuell stats-side, sesongtabell (spill vunnet) og
  «Erkerivaler» er bygget. Sesong-leaderboard per spilltype gjenstår.

**Kjente, åpne ting**
- Mobil-PWA kan miste Supabase-sesjonen i bakgrunnen (Safari); løses i dag med
  «Logg ut» på profilsiden.
- Service workeren er network-first → treg oppstart på dårlig nett.
- tabler-icons er pinnet til 3.48.0 (`dist/`); bump bevisst ved behov.
- S1 (server-side «kun egen flight» på scores) er fortsatt kun UI-gating.

**Kjente avvik doc↔kode er merket inline under med `⚠️ STATUS`.**

---

## 1. Retning og prinsipper

FORE! blir en **spill- og konkurranseapp** for vennegjengen — à la Golf GameBook, men med gjengens egne spill, statistikk og humor.

**Prinsipper:**

- **Ingen synk** med NGF/Golfbox/Gimmie. HCP er et tall spilleren taster selv: standardverdi på profilen, justerbart per runde. Appen beregner kun spillende HCP (HI × slope/113 + CR − par) — ingenting lagres eller justeres opp/ned.
- **Baner beholdes som i dag:** 18 hull, én CR/slope per tee, SI 1 = vanskeligst. Dette trengs for riktig utjevning i alle spill.
- **Friksjon er fienden**, men tasting per hull/slag er akseptert — det er prisen for at spillene fungerer.
- Gammel HCP/Gimmie-variant er bevart i git-tag `v1.94-hcp` og kan hentes tilbake som funksjon hvis NGF-API kommer.

---

## §2 — «Start et spill»-flyten (revidert 5. aug 2026)

### §2.0 Prinsipp
Appen er lek og moro, ikke administrasjon. Hjemskjermen har én jobb:
starte et spill. Baner, spillere og historikk administreres bak
hamburger-menyen. Språket i appen er «spill», ikke «runder».

### §2.1 Hjemskjerm
- Dominerende CTA: «Start et spill»
- Under: pågående spill (fortsett med ett tapp) og siste oppgjør
- Hamburger-meny: baner (adm.), spillere (adm.), historikk,
  innstillinger — og «Statistikk».
  ⚠️ STATUS (13. aug): Statistikk-siden ER bygget (egen bunn-nav-fane +
  hamburger-punkt), ikke lenger «kommer snart». Det som fortsatt står som
  «kommer snart» er Sesong-leaderboard og Head-to-head (v2).

### §2.2 Trinnvis oppsett — rekkefølgen er bindende
Hvert steg produserer det neste steg trenger. Ingen «alt i ett bilde».

**Steg 1 — Velg spill.** Kompakt liste; kort ekspanderer med
beskrivelse, krav (lag/individuelt, antall spillere) og varianter.
Alt drives av spillmodulens `meta` — nye spill dukker opp automatisk.
Et spill kan ha rolle hovedspill, tilleggsspill eller begge
(`meta.roles`). Uferdige spill vises nedtonet som «kommer snart».
Variantvalg (f.eks. tellende utslag: antall, 0 = av) gjøres her.
Oppsett-validering: umulige/krevende kombinasjoner gir advarsel
umiddelbart (f.eks. utslagskvote som ikke går opp mot antall hull).

**Steg 2 — Bane og hull.** Ren henting: velg bane fra lista
(sist spilt forhåndsvalgt), velg antall hull og hvilke.
Å opprette/redigere baner skjer IKKE her — det er administrasjon
(hamburger). Steget gir regnegrunnlaget: SI, par, antall hull.

**Steg 3 — Spillere og lag.** Spillere ligger klare som chips,
HCP redigeres inline, nye spillere opprettes der og da (navn + HCP,
ferdig). Lagbygging med «bland på nytt» som optimaliserer jevnhet.
Viser per lag: lag-HCP, tildelte slag i klartekst, og én tydelig
jevnhetsindikator («Lag 2 får 3 slag»). Tallene er endelige fordi
bane/hull er valgt i steg 2.

**Steg 4 — Krydder (forslag).** Appen FORESLÅR kompatible
tilleggsspill basert på hovedspill + oppsett («passer for dere»),
med én forklaringslinje og inline-innstilling (pott osv.).
Inkompatible tillegg skjules med kort begrunnelse, vises ikke grået.

**Start.** Én knapp som oppsummerer spillet i én linje:
«Scramble · Grini GK · 18 hull · 2 lag · kølle-lodd».

### §2.3 Utslags-logging (scramble o.l.) — fra start
Drive-logging bygges i første versjon av flyten, ikke utsatt:
ett tapp per hull («hvem sitt utslag?»), skrives til game_events
etter eksisterende kontrakt. Varsler per §11.3: eskalerende når
kvoten strammer seg, automatisk straff når den er matematisk umulig.

### §2.4 Etter §2 er bygget
Full gjennomgang av alle spill (hovedspill, tilleggsspill, varianter,
meta-krav) før flere spill implementeres. Egen spilliste-økt.

### §2.5 Faste regler (revidert 7. aug 2026)
- **Maks 4 spillere per FLIGHT.** Effektivt tak per flight =
  min(4, spillets `meta.maxSpillere`) — spill kan være strengere
  (matchplay 2, wolf nøyaktig 4), aldri over 4 i én flight.
- **En konkurranse = én runde med flere flighter.** Runden er
  konkurranse-laget; flightene ligger under. En gjeng >4 fordeles på
  flere flighter under samme runde.
- **Felles resultat på tvers:** hovedspillets leaderboard og
  totalvinner går på tvers av alle flighter (individuell stableford
  aggregeres; scramble-lag rangeres samlet). **Skins OG Nassau er
  per-flight** (besluttet 13. aug 2026): begge spilles alltid innad i én
  firer, potten lukkes per flight, ingen felles pott på tvers. Andre
  penge-sidespill vurderes per spill.
- Tidligere «ett spill = én flight» (låst 6. aug) var et selvpålagt
  gjerde, ikke fundamentet — datamodellen bar alltid multi-flight
  (runde → mange flighter; games/scores på runde-nivå).

### §2.6 Redigere oppsett på en aktiv runde
Grunnregel: **en endring som ikke går opp mot allerede tastet score
skal flagges og nektes/forklares — aldri stille ødelegge score.**
- **Låst mid-runde:** spilltype og bane/hull (endring foreldreløser
  all score) samt **scramble-roster/lag** (en spillers slag er vevd
  inn i lagets delte score; å regne det bort ville dikte opp en runde).
- **HCP-endring:** regnes om for hele runden. Ærlig — netto/poeng er
  alltid utledet av uendret brutto; ingen lagret netto å bevare.
- **Fjerne spiller med score:** blokkert til scoren er nullstilt. Én
  «nullstill [spiller]s score»-knapp tømmer alle hans hull samlet,
  deretter kan spilleren fjernes. To bevisste steg (ingen slett-bak-
  én-advarsel som klikkes vekk på autopilot).
- **Tilleggsspill:** fritt av/på/beløp — beregnes av eksisterende
  brutto, ingenting ødelegges.

### §2.7 Multi-flight-konkurranse: del og bli med (besluttet 7. aug 2026)
Formål: en fast gjeng spiller sammen og mot hverandre også når de er
>4, fordelt på flere flighter under én felles konkurranse (= runde).
Datamodellen bærer dette allerede; dette er en MIDDELS påbygging, ikke
et nytt turneringslag.

**Beslutninger:**
1. **Login vs gjest:** login (lett, ingen tung profil/statistikk) for
   den som oppretter/styrer. Gjest (`is_guest`) = for å bli med i én
   konkurranse.
2. **Multi-flight i wizarden:** arrangøren fordeler alle spillere på
   flere flighter (maks 4 per flight).
3. **Deling — én kort join-kode** (`rounds.join_code`): arrangøren
   trykker «Del», får én kode/lenke, deler i gruppechat. Hver spiller
   åpner den, ser konkurransen, **velger seg selv** fra oppsett-lista →
   rutes automatisk til sin flights scoring. Flight-tilhørighet ligger
   i oppsettet, IKKE i lenken. Vern: valgt navn gråes ut for andre
   («allerede med»). Feil navn: **selv-slipp før score er tastet**,
   arrangør-reset etter. Ikke på lista → «legg meg til som gjest»
   (navn + HCP → velg flight (maks 4) → `is_guest`-profil + claimet
   flight_player → rutes til scoring).
4. **Redigering:** alle i en flight kan taste; kan ikke redigere andre
   flighters tall. Ingen lagleder-rolle.
5. **Gjest taster BÅDE score og utslag** for sin flight. Når utslags-
   logging (§2.3/E) bygges må den respektere samme «bli med»-tilgang.
6. **Live:** polling nå, men **runde-spesifikk** (join-kode/round-id i
   URL, ikke alltid nyeste aktive), intervall strammet ~5–8s. Ekte
   sanntid (Supabase realtime) er senere polering.
7. **Resultat:** felles live-leaderboard på tvers underveis OG én felles
   totalvinner på tvers til slutt.

**Inkrement-rekkefølge:** G1 (multi-flight i wizard, individuelt) →
G1b (scramble på tvers) → G2 (runde-spesifikk live) → G3 (del + bli-med/
claim; `flight_players.claimed_at`) → G4 (gjest-join) → G5 (tverr-flight
totalvinner/oppgjør, verifiser). Deretter §2 E (utslag) → F (hjemskjerm).

⚠️ STATUS (26. sep): G1b og §2 E er nå BYGGET — se STATUS-blokken øverst.
Teksten under er beslutningsgrunnlaget fra august.
⚠️ STATUS (13. aug): ✅ G1, G2, G3, G4 bygget & live. ✅ G5 verifisert korrekt
for individuelle spill (sammenlagt-standings på tvers + oppgjør nettet på tvers;
skins holdt per-flight). ✅ §2 F (hjemskjerm) bygget.
⏳ §2 E (utslag) DELVIS: drive_used-logging for scramble finnes på scoring-
skjermen, MEN E i planen var bredere — §11.3-kvote/straff-håndheving og at
utslags-tasting respekterer bli-med-tilgang for gjester (§2.7 pkt 5). Ikke ferdig.
🔨 G1b BESLUTTET & DESIGN LÅST (13.–17. aug), ikke bygget ennå. Regel:
**ETT LAG = ÉN FLIGHT** → flere lag = flere flighter, som spiller mot hverandre
på tvers (Lag A i Flight 1, Lag B i Flight 2). Aldri to lag i samme flight, aldri
ett lag splittet, aldri tilbake til single-flight-alle-sammen. Låst design:

1. **Schema (A):** ny kolonne `game_teams.flight_id` (liten migrering). Appen
   skal VITE sikkert hvilket lag som er i hvilken flight — ikke utlede fra
   medlemsoverlapp — så deling/gjeste-join på ulike telefoner ruter riktig.
2. **Wizard-save:** for scramble lager save én flight per lag (flight.name =
   lagnavn), lagets medlemmer som `flight_players`, `game_teams.member_ids` =
   samme, og setter `game_teams.flight_id`. Lag-tildelingen ER flight-tildelingen
   (ingen egen FlightBuilder for scramble).
3. **Live:** gjenbruk `ScrambleGame.compute(ctx)` i live.js → lag-rader (navn,
   lag-HCP, netto/par, thru) rangert samlet på tvers. Score-avledet birdie/eagle-
   feed blir tom for scramble (lag-scores har ingen player_id) — akseptabelt.
4. **Join/claim (G3/G4):** hver taster KUN for sin egen flight/lag; enhver
   claimet lag-medlem kan redigere den delte lag-scoren. Ingen som taster for
   mer enn sin egen flight.
5. **Bakoverkompat:** gamle single-flight-scramble-runder er urørt (ingen
   historikk-migrering); kun nye runder får ett-lag-per-flight-strukturen.

Dagens kode tvinger fortsatt scramble til én flight — dette er arbeidet som
gjenstår. Ny migreringsfil (`game_teams.flight_id`) må `git add`-es manuelt +
kjøres i Supabase FØR deploy.

**Claim/identitet:** `flight_players.claimed_at` (persistert → gråing på
tvers via polling). Enhets-lokal identitet (localStorage) så gjest uten
login kan taste for sin flight; `canEdit` utvides til å godta claimet
identitet ved siden av innlogget profil.

**S1 — server-side håndheving (eget punkt, blokkerer ikke):** RLS på
`scores` UPDATE=true i dag; per-flight-gating er kun UI. Server-side
«kun egen flight» kolliderer med gjest-modellen (ingen `auth.uid()`).
Kjøres UI-gating for vennegjengen nå; S1 besluttes når flyten er ekte.

---

## 3. Arkitektur: spillmotoren

### 3.1 Nye tabeller

```sql
CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid REFERENCES rounds(id),
  game_type text NOT NULL,          -- 'scramble', 'wolf', 'skins', ...
  is_main boolean DEFAULT false,    -- hovedspill vs sidespill
  config jsonb DEFAULT '{}',        -- spillspesifikke valg
  created_at timestamptz DEFAULT now()
);

CREATE TABLE game_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES games(id),
  name text,                        -- 'Lag 1'
  member_ids uuid[] NOT NULL,
  team_handicap numeric             -- beregnet ved oppsett, frosset
);

CREATE TABLE game_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES games(id),
  round_id uuid REFERENCES rounds(id),
  hole_number int,
  player_id uuid,                   -- nullable
  team_id uuid,                     -- nullable
  event_type text NOT NULL,         -- 'drive_used', 'mulligan', 'gilligan_sent', 'club_lottery', ...
  payload jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
```

`game_events` er append-only → trygg for samtidig tasting og dvale/re-sync (samme mønster som scores i dag).

### 3.2 Scores med lag-støtte

```sql
ALTER TABLE scores ALTER COLUMN player_id DROP NOT NULL;
ALTER TABLE scores ADD COLUMN team_id uuid REFERENCES game_teams(id);
-- CHECK: nøyaktig én av player_id/team_id satt
```

Delt ball-spill (scramble, foursome, greensome) scorer på `team_id`. **Bonus:** personlig statistikk forurenses ikke — lagscore har ingen spillerrader, så profilstatistikken holder seg ren uten ekstra logikk. Best ball (egen ball) beholder personlige scores; lagresultatet beregnes.

### 3.3 Spillmodul-mønsteret

Hvert spill er én JS-modul med samme kontrakt.

⚠️ STATUS (13. aug): den bygde kontrakten avviker fra skissen under — `compute`,
`trackerUI`, `summaryUI` og `settle` tar ETT `ctx`-objekt (ikke løse argumenter),
og modulen har fått `defaultConfig()` + `settle(ctx)`. Faktisk kontrakt:

```js
{
  type: 'scramble',
  meta: { navn, beskrivelse, minSpillere, maxSpillere, kreverLag,
          kreverIndividuellScore, roles:['main'|'addon'], status:'ready' },
  defaultConfig()      // seed for games.config (wizarden bygger videre)
  setupUI(config)      // rendrer oppsettvalgene
  validate(ctx)        // varsler rare kombinasjoner
  compute(ctx)         // ctx = {round, holes, scores|teamScores, teams|flights, events, fullCoursePar} → stilling
  trackerUI(ctx)       // stripe på scoring-skjermen
  summaryUI(ctx)       // seksjon i rundeoppsummeringen
  settle(ctx)          // valgfri: {type,label,amount?,perPlayer} for oppgjøret (§8), ellers null
}
```

**Skins ER migrert inn som første spill** (kolonnen `rounds.skins_amount` er
dvalende, droppes senere). Modulene ligger i `game-*.js`, ikke `games.js`
(splittet). Etter motoren er hvert nytt spill 50–150 linjer.

**Rekkefølge (kritisk):** 1) tag `v1.94-hcp`, 2) bygg motor + migrer skins, 3) lag-støtte i scores, 4) spill for spill. Motoren FØR spill nr. 2 — ellers gjentas skins-hardkodingen 15 ganger.

---

## 4. Kompatibilitetsregler (hovedspill + tillegg)

Hvert spill deklarerer krav; appen filtrerer gyldige tillegg automatisk:

| Tillegg | Krever | Kommentar |
|---|---|---|
| Skins (individuell) | individuell score | ikke oppå scramble → tilby lag-skins |
| Lag-skins | lag | stableford per lag per hull |
| Mulligan/Gilligan | — | fungerer overalt; i lagspill eies tokens av laget |
| Kølle-lodd | — | fungerer overalt |
| Nassau | individuell score eller lag | 1–9 / 10–18 / totalt |
| Junk (greenie, sandie …) | — | ett-trykks hendelser |

---

## 5. Spillene (v1)

Mal per spill: **Oppsett** (valg før start) · **Underveis** (input per hull utover score) · **Beregning** · **Kantene** (9 hull, frafall, uavgjort, brutte regler).

⚠️ STATUS (26. sep): i tillegg er Best Ball (§10) og junk/sidekonkurranse bygget.
⚠️ STATUS (13. aug) — bygget vs ikke: ✅ 5.1 Scramble, ✅ 5.3 Skins, ✅ 5.4 Nassau,
✅ 5.5 Quota, samt Stableford (default individuelt hovedspill, ikke egen §-oppføring).
❌ IKKE bygget: 5.2 Wolf, 5.6 Matchplay, 5.7 Mulligans/Gilligans, 5.8 Kølle-lodd.
For scramble er §11.3-kvote/straff bygget men avhenger av «tellende utslag» i
oppsettet; utslags-tracker på scoring-skjermen (drive_used-logging) finnes.

### 5.1 Scramble / Texas scramble ⭐ (gjennomarbeidet eksempel)

- **Oppsett:** lagvelger med levende HCP; lagbrøk WHS-standard (4-mann 25/20/15/10 %, 3-mann 30/20/10 %, 2-mann 35/15 %) eller egendefinert; tellende utslag av/på → min per spiller eller «likt antall»; scoring slag/netto/stableford.
- **Underveis:** lagets score (én taster) + ett trykk: hvem sitt utslag ble brukt. Tracker viser kvote per spiller («Sara 1 av 4 ⚠») og varsler når det haster.
- **Beregning:** netto lagscore mot par/andre lag, lag-HCP fordelt etter SI.
- **Kantene:** kvote ikke nådd → valg ved oppsett: kun varsling / straffeslag per manglende / ute av premie. 9 hull: kvote halveres.

### 5.2 Wolf

- **Oppsett:** 4 spillere, rekkefølge (loddtrekning i appen), poeng eller kroner, lone wolf-multiplikator (×2 standard, ×3 «blind wolf» før utslag).
- **Underveis:** appen holder rotasjonen; ulven velger etter utslagene: partner (2v2) eller lone wolf (1v3). To trykk.
- **Beregning:** beste netto-ball per side; poeng fordeles, lone wolf dobler.
- **Kantene:** hull 17–18 (rotasjonen dekker 16): sistemann i sammendraget er ulv, eller «trailing wolf» (den som ligger sist). Valg ved oppsett. Uavgjort hull = 0 poeng (eller carryover, konfig).

### 5.3 Skins (migreres)

Som i dag: stableford per hull, carryover, kronebeløp. Nytt: også lag-variant; udelt pott ved rundeslutt → valg: deles / ruller til neste runde med samme spillere.

### 5.4 Nassau

- **Oppsett:** beløp per segment (1–9, 10–18, totalt), individuelt eller lag, match/stableford.
- **Underveis:** ingenting ekstra.
- **Beregning:** tre separate oppgjør. Klassisk «press» (nytt veddemål ved 2 ned) = v2.
- **Kantene:** 9-hulls runde → kun totalen.

### 5.5 Quota

- **Oppsett:** mål = 36 − spillende HCP i stablefordpoeng (justerbar formel). Innsats.
- **Underveis:** ingenting ekstra.
- **Beregning:** poeng minus mål; høyest differanse vinner. Tracker viser «mot målet» live (+3/−2).
- **Kantene:** 9 hull → mål halveres.

### 5.6 Matchplay 1v1

- **Oppsett:** to spillere, HCP-differanse fordeles på SI (laveste spiller fra scratch). Innsats.
- **Underveis:** ingenting ekstra.
- **Beregning:** hull vunnet/tapt/delt; «3&2»-notasjon; dormie-varsel i trackeren.
- **Kantene:** delt match → delt pott eller sudden death på hull 1 (konfig). Flere samtidige 1v1-matcher i samme runde støttes (round-robin i flighten).

### 5.7 Mulligans & Gilligans

- **Oppsett:** antall per spiller/lag (typisk 1–2 av hver). Kun utslag eller alle slag (konfig).
- **Underveis:** knapp i trackeren: bruk mulligan (slå om selv) / send gilligan (motstander må slå om et **bra** slag). Logges som event med hull og mottaker.
- **Beregning:** ingen direkte — effekten ligger i omslaget. Feed viser dramaet.
- **Kantene:** gilligan må sendes FØR neste slag slås. På tvers av flighter: «fjern-gilligan» via live-feed — mottakerlagets neste utslag må slås om (se åpne beslutninger).

### 5.8 Kølle-lodd

- **Oppsett:** av/på, trekning per hull eller på valgte hull, hvem rammes (én spiller på rotasjon / hele laget), putter unntatt av/på.
- **Underveis:** appen trekker ved hullstart («Sara: hele hullet med jern 7») — animasjon + feed-event.
- **Beregning:** ingen — ren moro. Statistikk på «beste lodd-hull» i sesongoversikten.
- **Kantene:** spilleren mangler køllen → trekk på nytt.

---

## 6. Underveis: scoring-skjermen

- Hvert aktivt spill får en **tracker-stripe** øverst (som dagens skins-stripe): pott, tokens, kvoter, wolf-valg, lodd.
- Spill som krever valg (wolf, gilligan) legger kort/knapper inn i flyten på riktig tidspunkt.
- Lagspill: scoring-skjermen viser lag i stedet for spillere.

## 7. Live leaderboard og feed

Beskriver det som FAKTISK er bygget (omskrevet 13. aug 2026; den tidligere
`game_events`-feed-ambisjonen er lagt bort for nå).

- **Individuell tverr-flight-stilling:** aggregerer alle flighters spillere til
  én felles live-stilling (stableford), thru per spiller.
- **Score-avledet feed:** «Live feed» regnes ut fra `scores` — birdie/eagle/andre
  utslagsgivende hull utledes av slag mot par (ikke fra `game_events`).
- **Offentlig #live-lenke** som før; join-flyt (§2.7 G3/G4) med runde-spesifikk
  URL. Join-siden poller ~6 s; hoved-live har manuell «Oppdater» + polling.

**Ikke bygget (backlog):** lag-/scramble-visning i live hører til **G1b** (§2.7 —
ett lag = én flight, vis lagene på tvers). En ekte `game_events`-hendelsesfeed
(lodd-trekk, gilligans, mulligans) hører til når de event-drevne spillene bygges
(spillmotor-sporet), ikke som en generell §7-jobb nå.

## 8. Oppgjøret

Rundens beste skjerm: hvert spill gjør opp for seg → appen **netter ut på tvers** til færrest mulig betalinger («Maya → Erik 110 kr»). Delbar oppsummering til gruppechat (bilde/tekst).

## 9. Statistikk (v2, men datamodellen er klar)

- Individuell: som i dag (kun individuelle scores — lagscores holdes utenfor automatisk)
- Sesong-leaderboard per spilltype; rival-statistikk; «mest vunnet i skins»; gilligan-statistikk (mest sendt/mottatt)

## 10. v2-spilliste

~~Best ball~~ (✅ bygget sep 2026)/fourball, foursome, greensome, Vegas, snake, rabbit, junk-pakka (greenie/sandie/barkie/polie), nine-point, bingo bango bongo, Nassau-press, Ryder Cup-helgeformat.

---

## §11 — Regelavklaringer (avgjort 4. aug 2026)

**Prinsipp:** Alle regler skal være deterministiske og beregnbare fra
`game_events`. Ingen regel skal kreve skjønn eller dommeravgjørelse
midt i runden. Nye regler som bryter dette prinsippet avvises eller
omformuleres.

### §11.1 Gilligan — rekkevidde
Gilligan kan kun gis innen egen flight. Mottaker slår slaget på nytt
umiddelbart; hendelsen logges i `game_events` (giver, mottaker, hull).
- v2 (utsatt): cross-flight-variant som «neste utslag» — deterministisk,
  krever ingen valg-dialog på tvers av enheter. Vurderes sammen med
  Gilligan-statistikk.

### §11.2 Wolf — hull 17 og 18
Ulven på hull 17–18 er spilleren med lavest poengsum etter hull 16
(hull 17) og etter hull 17 (hull 18).
- Tiebreak: ved poenglikhet er den som var ulv tidligst i rotasjonen
  ulv på 17; nest tidligst på 18.
- Fullt beregnbart fra game_events — ingen manuell inntasting.

### §11.3 Brutt utslagskvote (scramble)
1. Appen varsler eskalerende når kvoten begynner å bli trang
   (f.eks. «Eriks utslag må brukes på 2 av de 4 siste hullene»).
2. Når kvoten er matematisk umulig å oppfylle: 1 straffeslag per
   manglende utslag, lagt på lagets totalscore automatisk.
Laget fortsetter i premiekampen; regelen håndhever seg selv.

### §11.4 Udelt skins-pott
Udelt pott ved rundeslutt tilbakebetales likt til alle deltakere,
slik at oppgjørsskjermen alltid summerer til null.
- v2 (utsatt): rulling til neste runde. Krever serie-/sesongkonsept;
  vurderes sammen med sesong-leaderboard.

## 12. Teknisk huskeliste

- ✅ Tag `v1.94-hcp` finnes (gjort før sletting)
- ✅ Fjernet: Gimmie-import + differensial-logikk (profile.js — bekreftet i fil-kommentar). `rounds.skins_amount` er migrert til games-rad, kolonnen er dvalende (drop gjenstår)
- ✅ De 4 stableford-variantene er konsolidert til `calcStableford` i games-core.js
- ✅ Supabase keep-alive workflow (`.github/workflows/keep-alive.yml`) er committet (i deploy.sh git-add-lista)
- ⏳ Gjenstår: RLS/grants på nye tabeller (grants-oppryddingen, frist okt 2026); faktisk DROP av `rounds.skins_amount`
