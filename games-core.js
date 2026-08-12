// ==========================================================================
// Spillmotoren — register, spillmodul-kontrakt og delte helpers
// SPILLAPP-SPEC.md §3. Rene globale <script>-filer (ingen modulsystem),
// så registeret er et globalt objekt og modulene registrerer seg selv.
// ==========================================================================

// ---- Delte beregningshelpers --------------------------------------------

// Spillende HCP = round(HI × Slope/113 + (CR − Par)). Par = full 18-hulls par.
// Flyttet hit fra scoring.js så motoren er selvstendig; fortsatt global.
function _playingHcp(hi, slope, cr, par) {
  return Math.round((hi || 36) * (slope || 113) / 113 + ((cr || 72) - (par || 72)));
}

// KONSOLIDERT stableford (SPILLAPP-SPEC.md §12). Erstatter de fire tidligere
// variantene (calcStableford / *WithHoles / *Static / *Live). SI 1 = vanskeligst.
// totalHoles styrer slagfordelingen — standard 18 (slag fordeles alltid over 18
// hull, filtreres på aktive hull for 9-hulls runder, jf. CLAUDE.md).
function calcStableford(strokes, par, hcp, si, totalHoles = 18) {
  if (!strokes || !par || !si) return 0;
  let extra = Math.floor(hcp / totalHoles);
  if (si <= (hcp % totalHoles)) extra++;
  return Math.max(0, par - (strokes - extra) + 2);
}

// ---- Register ------------------------------------------------------------

const GameRegistry = {};
function registerGame(mod) { GameRegistry[mod.type] = mod; }
function getGame(type) { return GameRegistry[type]; }
function listGames() { return Object.values(GameRegistry); }

// Games-rader lastes med runden (embed: rounds.select('*, games(*)')).
function roundGames(round) { return round?.games || []; }
function gameOfType(round, type) { return roundGames(round).find(g => g.game_type === type) || null; }
function mainGame(round) { return roundGames(round).find(g => g.is_main) || null; }
function sideGames(round) { return roundGames(round).filter(g => !g.is_main); }

// Rollehjelpere (§2.2): hvilke spill kan velges som hovedspill / tillegg.
// coming_soon-spill tas MED i mainGames (vises nedtonet i velgeren), men
// filtreres bort som tillegg (kan ikke aktiveres ennå).
function hasRole(g, role) { return (g.meta.roles || []).includes(role); }
function mainGames() { return listGames().filter(g => hasRole(g, 'main')); }

// Hvorfor et tillegg ikke passer et hovedspill — null = passer (§4/§2.2).
function _addonReason(main, g) {
  if (g.meta.status === 'coming_soon') return 'kommer snart';
  if (g.meta.kreverIndividuellScore && main.meta.kreverLag && !main.meta.kreverIndividuellScore) return 'krever individuell scoring';
  if (g.meta.kreverLag && !main.meta.kreverLag) return 'krever lagspill';
  return null;
}

// Kompatibilitet (§2.2 steg 4): { compatible:[game], hidden:[{game, reason}] }.
// Steg 4 foreslår compatible og skjuler hidden med kort begrunnelse.
function addonCompatibility(mainType) {
  const main = getGame(mainType);
  const compatible = [], hidden = [];
  if (main) listGames().forEach(g => {
    if (g.type === mainType || !hasRole(g, 'addon')) return;
    const reason = _addonReason(main, g);
    if (reason) hidden.push({ game: g, reason }); else compatible.push(g);
  });
  return { compatible, hidden };
}
function compatibleAddons(mainType) { return addonCompatibility(mainType).compatible; }

// ── Oppgjøret (§8) ────────────────────────────────────────────────────────
// Nett ut netto-saldoer til færrest mulig betalinger (grådig min-cash-flow).
// perPlayer: { playerId: nettokr } (positiv = skal ha, negativ = skylder).
// Runder til hele kroner og balanserer avrundingsrest mot største bidrag så
// summen alltid blir 0. Returnerer [{ from, to, amount }].
function netSettlements(perPlayer) {
  const rounded = Object.keys(perPlayer || {}).map(id => ({ id, amt: Math.round(perPlayer[id] || 0) }));
  const residual = rounded.reduce((s, r) => s + r.amt, 0);
  if (residual !== 0 && rounded.length) {
    const k = rounded.reduce((a, b) => Math.abs(b.amt) > Math.abs(a.amt) ? b : a);
    k.amt -= residual;                       // hold totalsummen på 0
  }
  const creditors = rounded.filter(r => r.amt > 0).sort((a, b) => b.amt - a.amt);
  const debtors = rounded.filter(r => r.amt < 0).map(r => ({ id: r.id, amt: -r.amt })).sort((a, b) => b.amt - a.amt);
  const tx = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) tx.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amt -= pay; creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return tx;
}
