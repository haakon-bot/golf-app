// ==========================================================================
// Stableford (SPILLAPP-SPEC.md §5) — individuelt standard-hovedspill.
// Scoring-skjermen rendrer individuell stableford nativt (renderPlayerInputs,
// mini-ledertavle, oppsummerings-faner), så modulens compute/tracker/summary
// er bevisst no-ops. Rollen er å figurere i spillvelgeren (§2.2 steg 1) som
// standardvalget og skrive en informativ games-rad (game_type='stableford').
// ==========================================================================
const StablefordGame = {
  type: 'stableford',
  meta: {
    navn: 'Stableford',
    beskrivelse: 'Klassisk individuell stableford — netto poeng per hull mot par.',
    minSpillere: 1,
    maxSpillere: 4,          // ett spill = én flight, maks 4 (§2.5)
    kreverLag: false,
    kreverIndividuellScore: true,
    roles: ['main'],
    status: 'ready',
  },
  setupUI() { return ''; },                 // ingen variantvalg
  validate() { return { ok: true }; },
  compute() { return null; },               // native scoring håndterer det
  trackerUI() { return ''; },
  summaryUI() { return ''; },
};
registerGame(StablefordGame);
