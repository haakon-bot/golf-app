// ==========================================================================
// Nassau (SPILLAPP-SPEC.md §5.4) — sidespill (individuell score).
// Tre separate oppgjør: Hull 1–9, Hull 10–18, Totalt. Hvert segment er en egen
// «lik pott» (samme modell som skins): alle betaler innsatsen inn, høyest
// stablefordpoeng i segmentet tar potten (uavgjort deler). 9-hulls runde →
// kun «Totalt» (§5.4). «Press» og match-variant er v2.
// ==========================================================================
const NassauGame = {
  type: 'nassau',
  meta: {
    navn: 'Nassau',
    beskrivelse: 'Tre veddemål i ett: første 9, siste 9 og hele runden. Høyest poeng i hvert segment tar potten.',
    minSpillere: 2,
    maxSpillere: 4,
    kreverLag: false,
    kreverIndividuellScore: true,
    roles: ['addon'],
    status: 'ready',
  },

  defaultConfig() { return { amount: 50 }; },

  setupUI(config = {}) {
    const amt = config.amount ?? 50;
    return `<label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--cream);">
      <span>Innsats per segment <span style="color:var(--cream-dim);font-size:11px;">(kr)</span></span>
      <input type="number" id="nassauAmount" value="${amt}" min="1" max="1000" style="width:64px;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;text-align:center;">
    </label>`;
  },

  validate(ctx) {
    const n = (ctx.flights || []).flatMap(f => f.flight_players || []).length;
    if (n < 2) return { ok: false, warning: 'Nassau krever minst 2 spillere.' };
    return { ok: true };
  },

  // ctx = { round, holes (aktive), scores, flights, fullCoursePar }
  // → { amount, segments: [{ key, label, players:[{playerId,name,points,thru}], winnerIds, pot }] }
  compute(ctx) {
    const g = gameOfType(ctx.round, 'nassau');
    const amount = (g && g.config && g.config.amount) || 0;
    if (!amount) return null;
    const holes = ctx.holes || [];
    const front = holes.filter(h => h.hole_number <= 9);
    const back = holes.filter(h => h.hole_number >= 10);
    const both = front.length && back.length;
    const segDefs = both
      ? [{ key: 'front', label: 'Hull 1–9', holes: front }, { key: 'back', label: 'Hull 10–18', holes: back }, { key: 'total', label: 'Totalt', holes }]
      : [{ key: 'total', label: 'Totalt', holes }];
    const slope = ctx.round?.tee_sets?.slope, cr = ctx.round?.tee_sets?.course_rating;
    const par = ctx.fullCoursePar || 72;
    const allFP = (ctx.flights || []).flatMap(f => f.flight_players || []);
    const hcpById = {};
    allFP.forEach(fp => { hcpById[fp.player_id] = _playingHcp(fp.handicap, slope, cr, par); });

    const segments = segDefs.map(seg => {
      const players = allFP.map(fp => {
        const ps = (ctx.scores || {})[fp.player_id] || {};
        let points = 0, thru = 0;
        for (const h of seg.holes) {
          const s = ps[h.hole_number];
          if (s > 0 && h.par && h.stroke_index) { points += calcStableford(s, h.par, hcpById[fp.player_id], h.stroke_index, 18); thru++; }
        }
        return { playerId: fp.player_id, name: fp.profiles?.display_name || '?', points, thru };
      });
      const played = players.filter(p => p.thru > 0);
      const top = played.length ? Math.max(...played.map(p => p.points)) : null;
      const winnerIds = top != null ? played.filter(p => p.points === top).map(p => p.playerId) : [];
      // uavgjort mellom ALLE (eller ingen spilt) → ingen reell vinner
      const decided = winnerIds.length > 0 && winnerIds.length < played.length;
      return { key: seg.key, label: seg.label, players, winnerIds: decided ? winnerIds : [], pot: amount * allFP.length };
    });
    return { amount, segments, playerCount: allFP.length };
  },

  trackerUI() { return ''; },   // §5.4: ingenting ekstra underveis

  summaryUI(ctx) {
    const data = NassauGame.compute(ctx);
    if (!data || !data.segments.some(s => s.players.some(p => p.thru))) return '';
    const nameFirst = n => (n || '?').split(' ')[0];
    const segBlocks = data.segments.map(seg => {
      const ranked = [...seg.players].sort((a, b) => b.points - a.points);
      const cells = ranked.map(p => {
        const win = seg.winnerIds.includes(p.playerId);
        return `<span style="color:${win ? 'var(--gold)' : p.thru ? 'var(--cream)' : 'var(--cream-dim)'};">${nameFirst(p.name)} ${p.thru ? p.points + 'p' : '–'}${win ? ' 🏆' : ''}</span>`;
      }).join(' · ');
      const outcome = seg.winnerIds.length === 1
        ? `<span style="color:var(--gold);">${nameFirst(seg.players.find(p => p.playerId === seg.winnerIds[0])?.name)} tar ${seg.pot} kr</span>`
        : `<span style="color:var(--green-light);">uavgjort — pott ruller</span>`;
      return `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:3px;">
          <span style="color:var(--gold-dim);text-transform:uppercase;letter-spacing:1px;font-size:10px;">${seg.label}</span>${outcome}
        </div>
        <div style="font-size:12px;color:var(--cream-dim);">${cells}</div>
      </div>`;
    }).join('');
    return `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:16px;">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">🎲 Nassau · ${data.amount} kr/segment</div>
      ${segBlocks}
    </div>`;
  },

  // Hvert segment = egen «lik pott»: alle betaler innsatsen, vinner(e) tar potten.
  settle(ctx) {
    const data = NassauGame.compute(ctx);
    if (!data) return null;
    const amount = data.amount;
    const perPlayer = {};
    let any = false;
    for (const seg of data.segments) {
      if (!seg.winnerIds.length) continue;            // uavgjort/ikke spilt → rull, ingen oppgjør
      any = true;
      const players = seg.players.map(p => p.playerId);
      const share = (amount * players.length) / seg.winnerIds.length;
      players.forEach(pid => { perPlayer[pid] = (perPlayer[pid] || 0) - amount; });
      seg.winnerIds.forEach(pid => { perPlayer[pid] += share; });
    }
    return any ? { type: 'nassau', label: 'Nassau · lik pott per segment', amount, perPlayer } : null;
  },
};
registerGame(NassauGame);
