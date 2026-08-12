// ==========================================================================
// Quota (SPILLAPP-SPEC.md §5.5) — individuelt hovedspill.
// Mål = base − spille-HCP (base 36 = scratch på 18 hull; halveres for 9 hull).
// Stablefordpoeng − mål = differanse; høyest differanse vinner. Ren compute
// over individuelle scores — ingen ekstra input underveis.
// ==========================================================================
const QuotaGame = {
  type: 'quota',
  meta: {
    navn: 'Quota',
    beskrivelse: 'Slå ditt eget mål (36 − HCP i poeng). Høyest differanse mot målet vinner.',
    minSpillere: 1,
    maxSpillere: 4,
    kreverLag: false,
    kreverIndividuellScore: true,
    roles: ['main'],
    status: 'ready',
  },

  defaultConfig() { return { base: 36, amount: 0 }; },

  setupUI(config = {}) {
    const base = config.base ?? 36;
    const amt = config.amount ?? 0;
    const numStyle = 'width:64px;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;text-align:center;';
    return `<div style="display:flex;flex-direction:column;gap:10px;">
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--cream);">
        <span>Mål-basis <span style="color:var(--cream-dim);font-size:11px;">(scratch-poeng, standard 36)</span></span>
        <input type="number" id="quotaBase" value="${base}" min="18" max="54" style="${numStyle}">
      </label>
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--cream);">
        <span>Innsats <span style="color:var(--cream-dim);font-size:11px;">(kr, 0 = av)</span></span>
        <input type="number" id="quotaAmount" value="${amt}" min="0" max="1000" style="${numStyle}">
      </label>
    </div>`;
  },

  validate() { return { ok: true }; },

  // ctx = { round, holes (aktive), scores (playerId→hull→slag), flights, fullCoursePar }
  compute(ctx) {
    const g = gameOfType(ctx.round, 'quota');
    const cfg = (g && g.config) || {};
    const base = cfg.base ?? 36;
    const holes = ctx.holes || [];
    const isNine = holes.length > 0 && holes.length <= 9;
    const slope = ctx.round?.tee_sets?.slope, cr = ctx.round?.tee_sets?.course_rating;
    const par = ctx.fullCoursePar || 72;
    const allFP = (ctx.flights || []).flatMap(f => f.flight_players || []);
    const players = allFP.map(fp => {
      const phcp = _playingHcp(fp.handicap, slope, cr, par);
      const ps = (ctx.scores || {})[fp.player_id] || {};
      let points = 0, thru = 0;
      for (const h of holes) {
        const s = ps[h.hole_number];
        if (s > 0 && h.par && h.stroke_index) { points += calcStableford(s, h.par, phcp, h.stroke_index, 18); thru++; }
      }
      const target = Math.round((base - phcp) * (isNine ? 0.5 : 1));
      return { playerId: fp.player_id, name: fp.profiles?.display_name || '?', phcp, points, target, diff: points - target, thru };
    });
    players.sort((a, b) => b.diff - a.diff || b.points - a.points);
    return { base, isNine, amount: cfg.amount || 0, players };
  },

  trackerUI(ctx) {
    const data = QuotaGame.compute(ctx);
    if (!data || !data.players.length) return '';
    const max = Math.max(...data.players.map(p => p.thru ? p.diff : -Infinity));
    return data.players.map(p => {
      const lead = p.thru > 0 && p.diff === max;
      const d = p.diff > 0 ? `+${p.diff}` : `${p.diff}`;
      return `<div style="flex-shrink:0;text-align:center;padding:7px 12px;border-radius:8px;border:1px solid ${lead ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.07)'};background:${lead ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};">
        <div style="font-size:10px;color:var(--cream-dim);">${p.name.split(' ')[0]}</div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:${lead ? 'var(--gold)' : p.diff >= 0 ? 'var(--green-light)' : 'var(--cream)'};">${p.thru ? d : '–'}</div>
        <div style="font-size:9px;color:var(--cream-dim);">mål ${p.target}</div>
      </div>`;
    }).join('');
  },

  summaryUI(ctx) {
    const data = QuotaGame.compute(ctx);
    if (!data || !data.players.some(p => p.thru)) return '';
    const rows = data.players.map((p, i) => {
      const win = i === 0 && p.thru > 0;
      const d = p.diff > 0 ? `+${p.diff}` : `${p.diff}`;
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:7px 10px;color:${win ? 'var(--gold)' : 'var(--cream-dim)'};font-size:13px;width:34px;">${i + 1}${win ? ' 🏆' : ''}</td>
        <td style="padding:7px 10px;color:var(--cream);font-size:14px;">${p.name.split(' ')[0]}</td>
        <td style="padding:7px 8px;text-align:center;color:var(--cream-dim);font-size:12px;">${p.points}p</td>
        <td style="padding:7px 8px;text-align:center;color:var(--cream-dim);font-size:12px;">${p.target}</td>
        <td style="padding:7px 10px;text-align:right;font-family:'Playfair Display',serif;font-size:16px;color:${p.thru ? (p.diff >= 0 ? 'var(--green-light)' : '#e8a070') : 'var(--cream-dim)'};">${p.thru ? d : '–'}</td>
      </tr>`;
    }).join('');
    return `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:16px;">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">🎯 Quota${data.isNine ? ' · 9 hull' : ''} · mål-basis ${data.base}</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="padding:5px 10px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">#</th>
          <th style="padding:5px 10px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Spiller</th>
          <th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Poeng</th>
          <th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Mål</th>
          <th style="padding:5px 10px;text-align:right;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Mot mål</th>
        </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  },

  // Innsats (valgfri): vinner(e) tar potten — alle betaler likt inn, høyest
  // differanse tar potten (uavgjort deler). Netto per spiller.
  settle(ctx) {
    const data = QuotaGame.compute(ctx);
    if (!data || !data.amount) return null;
    const played = data.players.filter(p => p.thru > 0);
    if (played.length < 2) return null;
    const amount = data.amount;
    const topDiff = Math.max(...played.map(p => p.diff));
    const winners = played.filter(p => p.diff === topDiff);
    const share = (amount * played.length) / winners.length;
    const perPlayer = {};
    played.forEach(p => { perPlayer[p.playerId] = -amount; });
    winners.forEach(w => { perPlayer[w.playerId] += share; });
    return { type: 'quota', label: 'Quota · vinner tar potten', amount, perPlayer };
  },
};
registerGame(QuotaGame);
