Du jobber med "The Fantastic FORE!" — en spill- og konkurranseapp for golf, for norsk vennegjeng. NY RETNING per aug 2026: ren spillapp (à la Golf GameBook), IKKE HCP-forvaltning.

Les SPILLAPP-SPEC.md før større arbeid — den er fasit for retning, arkitektur og spillregler.

Teamet: Haakon (beslutningstaker), Erik (Tech Lead), Sara (UX), Lars (Product Owner), Maya (Innovation), Preben (Golfpro).

Filstruktur: app.js, courses.js, players.js, rounds.js, live.js, profile.js, scoring.js, stats.js, styles.css, sw.js. Spillmotoren er splittet i egne filer (lastes i denne rekkefølgen FØR app.js): games-core.js (registry, kontrakt, _playingHcp, calcStableford, netSettlements, FlightBuilder/TeamBuilder-deling) → game-stableford.js → game-skins.js → game-scramble.js → game-quota.js → game-nassau.js. Nytt spill = ny game-*.js registrert TRE steder: .gitignore-whitelist, deploy.sh git-add-liste, index.html script-tag.

Grunnprinsipper:
- HCP er et tall spilleren taster selv: standard på profil, justerbart per runde i flight_players.handicap. ALDRI beregn, synk eller juster HCP. Ingen Gimmie/Golfbox/NGF-integrasjon.
- Spillende HCP = round(HI × (Slope/113) + (CR − Par)), fordeles etter SI på 18 hull, filtrer på aktive hull for 9-hulls runder. SI 1 = vanskeligst.
- Alle baner har 18 hull. Bruk aldri "inn"/"ut" — bruk "hull 1-9" og "hull 10-18".
- Gammel HCP/Gimmie-variant ligger i git-tag v1.94-hcp. Tag FØR sletting av gammel kode.

Spillmotoren (se SPILLAPP-SPEC.md §3):
- Tabeller: games (round_id, game_type, is_main, config jsonb), game_teams (member_ids, team_handicap), game_events (append-only hendelser).
- scores kan ha player_id ELLER team_id (delt ball-spill scorer på lag; personlig statistikk bruker kun player_id-rader).
- Hvert spill = én modul med kontrakten: meta, defaultConfig, setupUI, validate, compute(ctx), trackerUI(ctx), summaryUI(ctx), og valgfri settle(ctx) for pengeoppgjør (§8). compute/tracker/summary/settle tar ETT ctx-objekt, ikke løse argumenter. Skins ER migrert inn i motoren (game-skins.js); rounds.skins_amount er dvalende og droppes senere. scoring.js/live.js kaller motoren, men har fortsatt tynne wrappere som mounter skins- og scramble-stripene på scoring-skjermen (ikke egen spill-logikk — kall inn i modulen).
- En runde kan ha ett hovedspill + flere sidespill. Kompatibilitet filtreres via meta-krav.

Arbeidsregler:
- Deploy med ./deploy.sh
- Kommandoer på én linje uten linjeskift
- Spør før du koder større endringer
- Stableford-beregningen ER konsolidert til calcStableford(strokes,par,hcp,si,totalHoles=18) i games-core.js; alle kallsteder peker dit. De fire gamle variantene er slettet.
