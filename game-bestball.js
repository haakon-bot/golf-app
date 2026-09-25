// ==========================================================================
// Best Ball — individuelt hovedspill, lagresultat regnet ut i etterkant.
// Alle spiller egen ball hele runden (helt vanlig individuell scoring,
// akkurat som Stableford/Quota — INGEN endring i scoring-skjermens
// spillerinput). Flighten ER laget: maks 4 per flight (samme grense som
// FlightBuilder/TeamBuilder ellers), ingen egen lag-oppsett-UI trengs.
// Lagets poengsum per hull = beste Stableford-resultat blant lagkameratene
// som har scoret det hullet. Ingen lag-HCP — hver spiller bruker sin egen
// spillende HCP, som i en vanlig individuell runde.
// ==========================================================================
const BestBallGame = {
  type: 'bestball',
  meta: {
    navn: 'Best Ball',
    beskrivelse: 'Alle spiller egen ball fra tee til hull — ingen delt ball. Lagets (flightens) poengsum per hull er beste Stableford-resultat blant lagkameratene.',
    minSpillere: 2,
    maxSpillere: 99,
    kreverLag: false,
    kreverIndividuellScore: true,
    roles: ['main'],
    status: 'ready',
  },

  defaultConfig() { return {}; },

  setupUI() { return ''; },   // ingen innstillinger — flighten er laget

  validate() { return { ok: true }; },

  // ctx = { round, holes (aktive), scores (playerId→hull→slag), flights, fullCoursePar }
  // → { teams: [{ flightId, name, members, holeResults, total, thru }] }, sortert best først.
  compute(ctx) {
    const holes = ctx.holes || [];
    const fullPar = ctx.fullCoursePar || 72;
    const slope = ctx.round?.tee_sets?.slope, cr = ctx.round?.tee_sets?.course_rating;
    const teams = (ctx.flights || [])
      .map(flight => {
        const members = flight.flight_players || [];
        let total = 0, thru = 0;
        const holeResults = holes.map(h => {
          let best = null, bestName = null;
          members.forEach(fp => {
            const strokes = (ctx.scores || {})[fp.player_id]?.[h.hole_number];
            if (!strokes || !h.par || !h.stroke_index) return;
            const phcp = _playingHcp(fp.handicap, slope, cr, fullPar);
            const sf = calcStableford(strokes, h.par, phcp, h.stroke_index, 18);
            if (best == null || sf > best) { best = sf; bestName = (fp.profiles?.display_name || '?').split(' ')[0]; }
          });
          if (best != null) { total += best; thru++; }
          return { holeNumber: h.hole_number, par: h.par, si: h.stroke_index, best, bestName };
        });
        return { flightId: flight.id, name: flight.name, members, holeResults, total, thru };
      })
      .filter(t => t.members.length);
    teams.sort((a, b) => b.total - a.total);
    return { teams };
  },

  // Live mini-strip (mountes generisk av scoring.js' renderGameTrackers — ingen
  // egen wrapper trengs her, containeren er allerede display:flex).
  trackerUI(ctx) {
    const data = BestBallGame.compute(ctx);
    if (!data || data.teams.length < 2) return '';
    const max = Math.max(...data.teams.map(t => t.thru ? t.total : -Infinity));
    return data.teams.map(t => {
      const lead = t.thru > 0 && t.total === max;
      return `<div style="flex-shrink:0;text-align:center;padding:7px 12px;border-radius:8px;border:1px solid ${lead ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.07)'};background:${lead ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};">
        <div style="font-size:10px;color:var(--cream-dim);">${t.name}</div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:${lead ? 'var(--gold)' : 'var(--cream)'};">${t.thru ? t.total + 'p' : '–'}</div>
      </div>`;
    }).join('');
  },

  // Rundeoppsummering (mountes generisk av scoring.js' sideGamesSummary).
  summaryUI(ctx) {
    const data = BestBallGame.compute(ctx);
    if (!data || !data.teams.some(t => t.thru)) return '';
    const rows = data.teams.map((t, i) => {
      const win = i === 0 && t.thru > 0;
      const memberNames = t.members.map(fp => (fp.profiles?.display_name || '?').split(' ')[0]).join(', ');
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:7px 10px;color:${win ? 'var(--gold)' : 'var(--cream-dim)'};font-size:13px;width:34px;">${i + 1}${win ? ' 🏆' : ''}</td>
        <td style="padding:7px 10px;color:var(--cream);font-size:14px;">${t.name}<div style="font-size:10px;color:var(--cream-dim);margin-top:1px;">${memberNames}</div></td>
        <td style="padding:7px 10px;text-align:right;font-family:'Playfair Display',serif;font-size:16px;color:${win ? 'var(--gold)' : 'var(--cream)'};">${t.thru ? t.total + 'p' : '–'}</td>
      </tr>`;
    }).join('');
    return `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:16px;">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">⛳ Best Ball</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="padding:5px 10px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">#</th>
          <th style="padding:5px 10px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Lag</th>
          <th style="padding:5px 10px;text-align:right;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Poeng</th>
        </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  },

  settle() { return null; },   // ingen pengeoppgjør
};
registerGame(BestBallGame);
