// ── STATS PAGE ──

let _currentStatsTab = 'sesong';

function switchStatsTab(tab) {
  _currentStatsTab = tab;
  document.getElementById('statsTabSesong').classList.toggle('active', tab === 'sesong');
  document.getElementById('statsTabH2h').classList.toggle('active', tab === 'h2h');
  document.getElementById('statsContentSesong').style.display = tab === 'sesong' ? 'block' : 'none';
  document.getElementById('statsContentH2h').style.display = tab === 'h2h' ? 'block' : 'none';
}

async function loadStatsPage() {
  if (_currentStatsTab !== 'sesong') switchStatsTab('sesong');
  const el = document.getElementById('statsContentSesong');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Laster statistikk...</div>';
  try {
    const data = await _fetchAndComputeStats();
    _renderSesong(el, data);
  } catch (e) {
    el.innerHTML = `<div class="empty"><p style="color:var(--cream-dim);">Feil: ${e.message}</p></div>`;
  }
}

async function _fetchAndComputeStats() {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const dateStr = cutoff.toISOString().split('T')[0];

  const { data: rounds, error: rErr } = await db.from('rounds')
    .select('id, course_id, hole_range, courses(name), tee_sets(slope, course_rating)')
    .eq('status', 'completed')
    .gte('date', dateStr);
  if (rErr) throw new Error(rErr.message);
  if (!rounds?.length) return null;

  const roundIds = rounds.map(r => r.id);
  const courseIds = [...new Set(rounds.map(r => r.course_id).filter(Boolean))];

  const [{ data: flights }, { data: allScores }, { data: holes }] = await Promise.all([
    db.from('flights')
      .select('id, round_id, flight_players(player_id, handicap, profiles(display_name))')
      .in('round_id', roundIds),
    db.from('scores').select('round_id, player_id, hole_number, strokes').in('round_id', roundIds),
    courseIds.length ? db.from('holes').select('course_id, hole_number, par, stroke_index').in('course_id', courseIds) : { data: [] },
  ]);

  const flightsByRound = {};
  for (const f of (flights || [])) {
    (flightsByRound[f.round_id] = flightsByRound[f.round_id] || []).push(f);
  }

  const scoreMap = {};
  for (const s of (allScores || [])) {
    const key = `${s.round_id}_${s.player_id}`;
    (scoreMap[key] = scoreMap[key] || {})[s.hole_number] = s.strokes;
  }

  const holesByCourse = {};
  for (const h of (holes || [])) {
    (holesByCourse[h.course_id] = holesByCourse[h.course_id] || {})[h.hole_number] = h;
  }

  const playerStats = {};
  const parTypeStats = { 3: { total: 0, count: 0 }, 4: { total: 0, count: 0 }, 5: { total: 0, count: 0 } };
  const scoreDist = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
  const holeStatsMap = {};

  for (const round of rounds) {
    const courseHoles = holesByCourse[round.course_id] || {};
    const coursePar = Object.values(courseHoles).reduce((s, h) => s + (h.par || 0), 0) || 72;
    const hr = round.hole_range || 'all';
    const activeHoles = Object.values(courseHoles)
      .filter(h => hr === 'front9' ? h.hole_number <= 9 : hr === 'back9' ? h.hole_number >= 10 : true)
      .sort((a, b) => a.hole_number - b.hole_number);

    for (const flight of (flightsByRound[round.id] || [])) {
      for (const fp of (flight.flight_players || [])) {
        const phcp = _playingHcp(fp.handicap, round.tee_sets?.slope, round.tee_sets?.course_rating, coursePar);
        const pScores = scoreMap[`${round.id}_${fp.player_id}`] || {};
        let roundTotal = 0, holesPlayed = 0;

        for (const hole of activeHoles) {
          const strokes = pScores[hole.hole_number];
          if (!strokes || strokes <= 0) continue;

          const sf = calcStableford(strokes, hole.par, phcp, hole.stroke_index);
          roundTotal += sf;
          holesPlayed++;

          if (hole.par >= 3 && hole.par <= 5) {
            parTypeStats[hole.par].total += sf;
            parTypeStats[hole.par].count++;
          }

          const vsPar = strokes - hole.par;
          if (vsPar <= -2) scoreDist.eagle++;
          else if (vsPar === -1) scoreDist.birdie++;
          else if (vsPar === 0) scoreDist.par++;
          else if (vsPar === 1) scoreDist.bogey++;
          else scoreDist.double++;

          const hk = `${round.course_id}_${hole.hole_number}`;
          if (!holeStatsMap[hk]) {
            holeStatsMap[hk] = { hole: hole.hole_number, par: hole.par, si: hole.stroke_index, course: round.courses?.name || '', total: 0, count: 0 };
          }
          holeStatsMap[hk].total += sf;
          holeStatsMap[hk].count++;
        }

        if (holesPlayed >= 9) {
          if (!playerStats[fp.player_id]) {
            playerStats[fp.player_id] = { name: fp.profiles?.display_name || 'Ukjent', totalPoints: 0, roundCount: 0 };
          }
          playerStats[fp.player_id].totalPoints += roundTotal;
          playerStats[fp.player_id].roundCount++;
        }
      }
    }
  }

  return { playerStats, parTypeStats, scoreDist, holeStatsMap };
}

function _renderSesong(el, data) {
  if (!data) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">⛳</div><h3>Ingen data</h3><p>Ingen fullførte runder siste 12 måneder.</p></div>`;
    return;
  }

  const { playerStats, parTypeStats, scoreDist, holeStatsMap } = data;

  // Leaderboard
  const leaderboard = Object.values(playerStats)
    .filter(p => p.roundCount > 0)
    .map(p => ({ ...p, avg: p.totalPoints / p.roundCount }))
    .sort((a, b) => b.avg - a.avg);

  const leaderHtml = `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Leaderboard – siste 12 mnd</div>
      <div style="background:rgba(0,0,0,0.2);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
        ${leaderboard.length ? leaderboard.map((p, i) => `
          <div style="display:flex;align-items:center;gap:12px;padding:13px 16px;${i < leaderboard.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : ''}${i === 0 ? 'background:rgba(201,168,76,0.07);' : ''}">
            <div style="font-size:13px;color:var(--cream-dim);min-width:20px;">${i + 1}</div>
            <div style="flex:1;">
              <div style="font-size:15px;color:var(--cream);font-weight:${i === 0 ? '600' : '400'};">${p.name}</div>
              <div style="font-size:11px;color:var(--cream-dim);">${p.roundCount} runde${p.roundCount !== 1 ? 'r' : ''}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:20px;font-weight:700;color:var(--gold);">${p.avg.toFixed(1)}</div>
              <div style="font-size:10px;color:var(--cream-dim);">snitt</div>
            </div>
          </div>`).join('') : '<div style="padding:24px;text-align:center;color:var(--cream-dim);font-size:14px;">Ingen spillere ennå</div>'}
      </div>
    </div>`;

  // Per-par grid
  const parLabels = { 3: 'Par 3', 4: 'Par 4', 5: 'Par 5' };
  const parGridHtml = `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Snitt Stableford per partype</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        ${[3, 4, 5].map(par => {
          const st = parTypeStats[par];
          const avg = st.count > 0 ? (st.total / st.count).toFixed(2) : '–';
          return `<div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 10px;text-align:center;">
            <div style="font-size:11px;color:var(--cream-dim);margin-bottom:6px;">${parLabels[par]}</div>
            <div style="font-size:26px;font-weight:700;color:var(--gold);">${avg}</div>
            <div style="font-size:10px;color:var(--cream-dim);margin-top:3px;">${st.count} hull</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  // Scoring distribution
  const distItems = [
    { key: 'eagle', label: 'Eagle', color: '#c9a84c' },
    { key: 'birdie', label: 'Birdie', color: '#85b7eb' },
    { key: 'par', label: 'Par', color: '#52b788' },
    { key: 'bogey', label: 'Bogey', color: '#f09595' },
    { key: 'double', label: 'Double+', color: '#e24b4a' },
  ];
  const maxDist = Math.max(...distItems.map(d => scoreDist[d.key]), 1);
  const totalDist = distItems.reduce((s, d) => s + scoreDist[d.key], 0);

  const distHtml = `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Scorefordeling</div>
      <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px;">
        ${distItems.map(d => {
          const count = scoreDist[d.key];
          const pct = totalDist > 0 ? (count / totalDist * 100).toFixed(1) : '0.0';
          const barW = (count / maxDist * 100).toFixed(1);
          return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;last-child:margin-bottom:0;">
            <div style="width:64px;font-size:13px;color:var(--cream-dim);flex-shrink:0;">${d.label}</div>
            <div style="flex:1;background:rgba(255,255,255,0.06);border-radius:4px;height:18px;overflow:hidden;">
              <div style="height:100%;width:${barW}%;background:${d.color};border-radius:4px;"></div>
            </div>
            <div style="min-width:36px;text-align:right;font-size:13px;color:var(--cream);">${count}</div>
            <div style="min-width:40px;text-align:right;font-size:11px;color:var(--cream-dim);">${pct}%</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  // Top 3 best holes
  const topHoles = Object.values(holeStatsMap)
    .filter(h => h.count >= 3)
    .map(h => ({ ...h, avg: h.total / h.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3);

  const medals = ['🥇', '🥈', '🥉'];
  const holesHtml = topHoles.length ? `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Beste hull (snitt Stableford)</div>
      ${topHoles.map((h, i) => `
        <div style="display:flex;align-items:center;gap:14px;padding:13px 16px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:10px;margin-bottom:8px;">
          <div style="font-size:20px;flex-shrink:0;">${medals[i]}</div>
          <div style="flex:1;">
            <div style="font-size:15px;color:var(--cream);font-weight:500;">Hull ${h.hole}</div>
            <div style="font-size:12px;color:var(--cream-dim);margin-top:2px;">Par ${h.par} · SI ${h.si ?? '–'} · ${h.course}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:20px;font-weight:700;color:var(--gold);">${h.avg.toFixed(2)}</div>
            <div style="font-size:10px;color:var(--cream-dim);">${h.count} runder</div>
          </div>
        </div>`).join('')}
    </div>` : '';

  el.innerHTML = leaderHtml + parGridHtml + distHtml + holesHtml;
}
