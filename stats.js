// ── STATS PAGE ──
// Ren spillapp (aug 2026): statistikken speiler appen som SPILL, LEK og MORO —
// ikke HCP-forvaltning. Bygger utelukkende på spillmotoren (games, game_teams,
// game_events, scores) og gjenbruker modulenes egen compute (SkinsGame,
// ScrambleGame) så tallene matcher rundeoppsummeringen. Ingen differentials,
// ingen par-snitt, ingen head-to-head på HCP.

async function loadStatsPage() {
  const el = document.getElementById('statsContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Laster statistikk...</div>';
  try {
    const data = await _computeGameStats();
    _renderStats(el, data);
  } catch (e) {
    el.innerHTML = `<div class="empty"><p style="color:var(--cream-dim);">Feil: ${e.message}</p></div>`;
  }
}

async function _computeGameStats() {
  // Alle fullførte runder med spill, lag og flighter.
  const { data: rounds, error } = await db.from('rounds')
    .select('id, date, hole_range, course_id, courses(name), tee_sets(slope, course_rating), games(*, game_teams(*)), flights(id, name, flight_players(player_id, handicap, profiles(display_name)))')
    .eq('status', 'completed')
    .order('date', { ascending: false });
  if (error) throw new Error(error.message);
  if (!rounds?.length) return { players: [], awards: {}, roundCount: 0 };

  const roundIds = rounds.map(r => r.id);
  const courseIds = [...new Set(rounds.map(r => r.course_id).filter(Boolean))];

  const [{ data: scores }, { data: holes }, { data: events }] = await Promise.all([
    db.from('scores').select('round_id, player_id, team_id, hole_number, strokes').in('round_id', roundIds),
    courseIds.length ? db.from('holes').select('course_id, hole_number, par, stroke_index').in('course_id', courseIds) : { data: [] },
    db.from('game_events').select('round_id, player_id, event_type').in('round_id', roundIds),
  ]);

  // Oppslag: hull per bane, scores + lag-scores + hendelser per runde.
  const holesByCourse = {};
  for (const h of (holes || [])) (holesByCourse[h.course_id] = holesByCourse[h.course_id] || {})[h.hole_number] = h;

  const pScoresByRound = {}, tScoresByRound = {};
  for (const s of (scores || [])) {
    if (s.player_id) ((pScoresByRound[s.round_id] = pScoresByRound[s.round_id] || {})[s.player_id] = (pScoresByRound[s.round_id][s.player_id] || {}))[s.hole_number] = s.strokes;
    else if (s.team_id) ((tScoresByRound[s.round_id] = tScoresByRound[s.round_id] || {})[s.team_id] = (tScoresByRound[s.round_id][s.team_id] || {}))[s.hole_number] = s.strokes;
  }
  const eventsByRound = {};
  for (const e of (events || [])) (eventsByRound[e.round_id] = eventsByRound[e.round_id] || []).push(e);

  // Per spiller-aggregat.
  const agg = {};
  const ensure = (id, name) => {
    if (!id) return null;
    if (!agg[id]) agg[id] = { id, name: name || '?', rounds: 0, birdies: 0, eagles: 0, gamesWon: 0, skinsWon: 0, skinsKr: 0, drives: 0, tiedInvolved: 0 };
    else if (name && name !== '?' && agg[id].name === '?') agg[id].name = name;
    return agg[id];
  };
  const pairs = {}; // "idA|idB" -> { a, b, rounds }

  for (const round of rounds) {
    const courseHoles = holesByCourse[round.course_id] || {};
    const fullCoursePar = Object.values(courseHoles).reduce((s, h) => s + (h.par || 0), 0) || 72;
    const hr = round.hole_range || 'all';
    const activeHoles = Object.values(courseHoles)
      .filter(h => hr === 'front9' ? h.hole_number <= 9 : hr === 'back9' ? h.hole_number >= 10 : true)
      .sort((a, b) => a.hole_number - b.hole_number);
    const slope = round.tee_sets?.slope, cr = round.tee_sets?.course_rating;
    const pScores = pScoresByRound[round.id] || {};
    const tScores = tScoresByRound[round.id] || {};
    const roundEvents = eventsByRound[round.id] || [];
    const allFP = (round.flights || []).flatMap(f => f.flight_players || []);

    // Deltakelse + birdies/eagles fra individuelle scores.
    for (const fp of allFP) {
      const a = ensure(fp.player_id, fp.profiles?.display_name);
      if (!a) continue;
      a.rounds++;
      const ps = pScores[fp.player_id] || {};
      for (const h of activeHoles) {
        const s = ps[h.hole_number];
        if (s > 0 && h.par) { const d = s - h.par; if (d <= -2) a.eagles++; else if (d === -1) a.birdies++; }
      }
    }

    // Rivaler: par som spilte samme runde.
    const ids = [...new Set(allFP.map(fp => fp.player_id).filter(Boolean))];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const key = [ids[i], ids[j]].sort().join('|');
      (pairs[key] = pairs[key] || { a: ids[i], b: ids[j], rounds: 0 }).rounds++;
    }

    // ── Spill vunnet: hovedspill ──
    const mg = (round.games || []).find(g => g.is_main);
    if (mg && mg.game_type === 'scramble') {
      const data = ScrambleGame.compute({ round, holes: activeHoles, teamScores: tScores, events: roundEvents, fullCoursePar });
      const win = data?.teams?.find(t => t.thru > 0);
      if (win) (win.team.member_ids || []).forEach(pid => { const a = ensure(pid); if (a) a.gamesWon++; });
    } else {
      // Individuell stableford — vinner(e) på tvers av flighter.
      const totals = {}; let best = -1;
      for (const fp of allFP) {
        const ps = pScores[fp.player_id] || {};
        const hcp = _playingHcp(fp.handicap, slope, cr, fullCoursePar);
        let pts = 0, thru = 0;
        for (const h of activeHoles) { const s = ps[h.hole_number]; if (s > 0 && h.par && h.stroke_index) { pts += calcStableford(s, h.par, hcp, h.stroke_index, 18); thru++; } }
        if (thru > 0) { totals[fp.player_id] = pts; if (pts > best) best = pts; }
      }
      if (best >= 0) Object.entries(totals).filter(([, p]) => p === best).forEach(([pid]) => { const a = ensure(pid); if (a) a.gamesWon++; });
    }

    // ── Skins (sidespill) ──
    const skinsGame = (round.games || []).find(g => g.game_type === 'skins');
    if (skinsGame) {
      const data = SkinsGame.compute({ round, holes: activeHoles, scores: pScores, flights: round.flights, fullCoursePar });
      if (data && data.flights) {
        const kr = data.amount; const roundSkins = {}; let roundBest = 0;
        for (const fl of data.flights) {
          for (const [pid, n] of Object.entries(fl.skinsByPlayer || {})) {
            const a = ensure(pid); if (!a) continue;
            a.skinsWon += n; a.skinsKr += n * kr;
            roundSkins[pid] = (roundSkins[pid] || 0) + n; if (roundSkins[pid] > roundBest) roundBest = roundSkins[pid];
          }
          const tied = (fl.holeResults || []).filter(r => r.tied).length;
          if (tied) (fl.flight.flight_players || []).forEach(x => { const a = ensure(x.player_id); if (a) a.tiedInvolved += tied; });
        }
        // Runde-vinner av skins vinner et «spill».
        if (roundBest > 0) Object.entries(roundSkins).filter(([, n]) => n === roundBest).forEach(([pid]) => { const a = ensure(pid); if (a) a.gamesWon++; });
      }
    }

    // Tellende utslag (scramble drive_used).
    for (const e of roundEvents) if (e.event_type === 'drive_used' && e.player_id) { const a = ensure(e.player_id); if (a) a.drives++; }
  }

  // Topp-par til «Erkerivaler».
  let topPair = null;
  for (const p of Object.values(pairs)) if (!topPair || p.rounds > topPair.rounds) topPair = p;
  const rivalry = topPair && topPair.rounds >= 1 && agg[topPair.a] && agg[topPair.b]
    ? { a: agg[topPair.a], b: agg[topPair.b], rounds: topPair.rounds } : null;

  const players = Object.values(agg);
  const topBy = key => { let b = null; for (const p of players) if (p[key] > 0 && (!b || p[key] > b[key])) b = p; return b; };

  return {
    roundCount: rounds.length,
    players,
    awards: {
      gamesWon: topBy('gamesWon'),
      skinsKr: topBy('skinsKr'),
      birdies: topBy('birdies'),
      drives: topBy('drives'),
      rounds: topBy('rounds'),
      eagles: topBy('eagles'),
      rulle: topBy('tiedInvolved'),
      rivalry,
    },
  };
}

// ── Rendering ──

function _statTrophy(emoji, title, leader, valueStr) {
  const has = !!leader;
  return `<div style="background:${has ? 'rgba(201,168,76,0.07)' : 'rgba(0,0,0,0.2)'};border:1px solid ${has ? 'rgba(201,168,76,0.28)' : 'rgba(255,255,255,0.07)'};border-radius:14px;padding:16px 14px;text-align:center;">
    <div style="font-size:26px;line-height:1;margin-bottom:8px;">${emoji}</div>
    <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">${title}</div>
    <div style="font-family:'Playfair Display',serif;font-size:17px;color:${has ? 'var(--cream)' : 'var(--cream-dim)'};line-height:1.2;">${has ? leader.name.split(' ')[0] : '–'}</div>
    <div style="font-size:12px;color:${has ? 'var(--green-light)' : 'var(--cream-dim)'};margin-top:3px;">${has ? valueStr : 'Ingen ennå'}</div>
  </div>`;
}

function _kaaringCard(emoji, title, line) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:12px;">
    <div style="font-size:24px;flex-shrink:0;">${emoji}</div>
    <div style="min-width:0;">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px;">${title}</div>
      <div style="font-size:14px;color:var(--cream);">${line}</div>
    </div>
  </div>`;
}

function _renderStats(el, data) {
  if (!data.roundCount) {
    el.innerHTML = `<div class="empty" style="padding:48px 20px;text-align:center;">
      <div class="empty-icon" style="font-size:48px;opacity:0.5;">🏌️</div>
      <h3 style="margin-top:12px;">Ingen runder ennå</h3>
      <p style="color:var(--cream-dim);">Statistikken fyller seg når gjengen spiller. Trofeer, skins og kåringer dukker opp her.</p>
    </div>`;
    return;
  }
  const a = data.awards;
  const fmtKr = p => `${p.skinsKr} kr`;

  // A · Troféskap
  const trophies = [
    _statTrophy('🏆', 'Spill-mester', a.gamesWon, a.gamesWon && `${a.gamesWon.gamesWon} spill`),
    _statTrophy('💰', 'Skins-konge', a.skinsKr, a.skinsKr && fmtKr(a.skinsKr)),
    _statTrophy('🐦', 'Birdie-maskin', a.birdies, a.birdies && `${a.birdies.birdies} birdies`),
    _statTrophy('📅', 'Mest aktiv', a.rounds, a.rounds && `${a.rounds.rounds} runder`),
  ];
  if (a.drives) trophies.push(_statTrophy('🎯', 'Utslagsmaskin', a.drives, `${a.drives.drives} utslag`));

  // Sesong-tabell (spill vunnet).
  const sorted = [...data.players].filter(p => p.rounds > 0)
    .sort((x, y) => y.gamesWon - x.gamesWon || y.skinsKr - x.skinsKr || y.birdies - x.birdies || x.name.localeCompare(y.name));
  const tableRows = sorted.map((p, i) => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
      <td style="padding:9px 10px;color:${i === 0 ? 'var(--gold)' : 'var(--cream-dim)'};font-size:13px;width:30px;">${i + 1}</td>
      <td style="padding:9px 10px;color:var(--cream);font-size:14px;">${p.name.split(' ')[0]}</td>
      <td style="padding:9px 8px;text-align:center;font-family:'Playfair Display',serif;font-size:16px;color:${i === 0 ? 'var(--gold)' : 'var(--cream)'};">${p.gamesWon}</td>
      <td style="padding:9px 8px;text-align:center;color:var(--cream-dim);font-size:13px;">${p.rounds}</td>
      <td style="padding:9px 8px;text-align:center;color:var(--cream-dim);font-size:13px;">${p.birdies}</td>
      <td style="padding:9px 10px;text-align:right;color:${p.skinsKr > 0 ? 'var(--green-light)' : 'var(--cream-dim)'};font-size:13px;">${p.skinsKr} kr</td>
    </tr>`).join('');

  // B · Kåringer
  const kaaringer = [];
  if (a.eagles) kaaringer.push(_kaaringCard('🦅', 'Ørnejeger', `<strong>${a.eagles.name.split(' ')[0]}</strong> med ${a.eagles.eagles} eagle${a.eagles.eagles !== 1 ? 's' : ''}`));
  if (a.rulle) kaaringer.push(_kaaringCard('🎰', 'Rulletriggeren', `<strong>${a.rulle.name.split(' ')[0]}</strong> var med på ${a.rulle.tiedInvolved} rullede skins-hull`));
  if (a.rivalry) kaaringer.push(_kaaringCard('🤝', 'Erkerivaler', `<strong>${a.rivalry.a.name.split(' ')[0]}</strong> vs <strong>${a.rivalry.b.name.split(' ')[0]}</strong> — ${a.rivalry.rounds} felles runde${a.rivalry.rounds !== 1 ? 'r' : ''} (${a.rivalry.a.gamesWon}–${a.rivalry.b.gamesWon} i spill vunnet)`));

  el.innerHTML = `
    <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">🏅 Troféskap</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:24px;">${trophies.join('')}</div>

    <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📊 Sesongen · ${data.roundCount} runde${data.roundCount !== 1 ? 'r' : ''}</div>
    <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;margin-bottom:24px;">
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="padding:8px 10px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;width:30px;">#</th>
          <th style="padding:8px 10px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Spiller</th>
          <th style="padding:8px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Spill</th>
          <th style="padding:8px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Runder</th>
          <th style="padding:8px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Birdies</th>
          <th style="padding:8px 10px;text-align:right;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Skins</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>
    </div>

    ${kaaringer.length ? `
      <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">🎉 Kåringer</div>
      <div style="display:flex;flex-direction:column;gap:10px;">${kaaringer.join('')}</div>
    ` : ''}
  `;
}
