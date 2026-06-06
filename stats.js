// ── STATS PAGE ──

let _currentStatsTab = 'sesong';
let _h2hState = { p1Id: null, p2Id: null, year: 'all', players: [] };
let _h2hInitialized = false;

function switchStatsTab(tab) {
  _currentStatsTab = tab;
  document.getElementById('statsTabSesong').classList.toggle('active', tab === 'sesong');
  document.getElementById('statsTabH2h').classList.toggle('active', tab === 'h2h');
  document.getElementById('statsContentSesong').style.display = tab === 'sesong' ? 'block' : 'none';
  document.getElementById('statsContentH2h').style.display = tab === 'h2h' ? 'block' : 'none';
  if (tab === 'h2h') initH2hTab();
}

async function loadStatsPage() {
  _h2hInitialized = false;
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
        let roundTotal = 0, roundStrokes = 0, holesPlayed = 0;

        for (const hole of activeHoles) {
          const strokes = pScores[hole.hole_number];
          if (!strokes || strokes <= 0) continue;

          const sf = calcStableford(strokes, hole.par, phcp, hole.stroke_index);
          roundTotal += sf;
          roundStrokes += strokes;
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
          // Normalize 9-hole rounds to 18-hole equivalent: fill unplayed holes with netto par,
          // matching the same logic as calculateEstimatedHCP in profile.js.
          let normalizedTotal = roundTotal;
          const is9Hole = round.hole_range === 'front9' || round.hole_range === 'back9';
          if (is9Hole) {
            const playedNums = new Set(activeHoles.map(h => h.hole_number));
            for (const h of Object.values(courseHoles)) {
              if (playedNums.has(h.hole_number) || !h.par || !h.stroke_index) continue;
              let tildelte = Math.floor(phcp / 18);
              if (h.stroke_index <= (phcp % 18)) tildelte++;
              normalizedTotal += calcStableford(h.par + tildelte, h.par, phcp, h.stroke_index);
            }
          }
          if (!playerStats[fp.player_id]) {
            playerStats[fp.player_id] = { name: fp.profiles?.display_name || 'Ukjent', totalPoints: 0, roundCount: 0, totalStrokes: 0, totalHolesForStrokes: 0 };
          }
          playerStats[fp.player_id].totalPoints += normalizedTotal;
          playerStats[fp.player_id].roundCount++;
          playerStats[fp.player_id].totalStrokes += roundStrokes;
          playerStats[fp.player_id].totalHolesForStrokes += holesPlayed;
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
    .map(p => ({
      ...p,
      avg: p.totalPoints / p.roundCount,
      avgStrokes18: p.totalHolesForStrokes > 0 ? Math.round(p.totalStrokes / p.totalHolesForStrokes * 18) : null,
    }))
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
              <div style="font-size:10px;color:var(--cream-dim);">${p.avgStrokes18 != null ? `snitt ${p.avgStrokes18} slag` : 'snitt'}</div>
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

// ── HEAD-TO-HEAD ──

async function initH2hTab() {
  if (_h2hInitialized) return;
  _h2hInitialized = true;
  const el = document.getElementById('statsContentH2h');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Laster spillere...</div>';
  try {
    const { data: players, error } = await db.from('profiles')
      .select('id, display_name, handicap')
      .eq('approved', true)
      .order('display_name');
    if (error) throw new Error(error.message);
    _h2hState.players = players || [];
    _renderH2hShell(el);
  } catch (e) {
    el.innerHTML = `<div class="empty"><p style="color:var(--cream-dim);">Feil: ${e.message}</p></div>`;
  }
}

function _h2hInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function _renderH2hPickerCard(slot, playerId) {
  const player = playerId ? _h2hState.players.find(p => p.id === playerId) : null;
  const initials = player ? _h2hInitials(player.display_name) : '+';
  return `
    <div onclick="openH2hPicker(${slot})" style="background:rgba(0,0,0,0.2);border:1px solid ${player ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.08)'};border-radius:12px;padding:14px 12px;text-align:center;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent;">
      <div style="width:44px;height:44px;border-radius:50%;background:${player ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.06)'};display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-size:${player ? '15px' : '20px'};font-weight:600;color:${player ? 'var(--gold)' : 'var(--cream-dim)'};">
        ${initials}
      </div>
      <div style="font-size:13px;color:${player ? 'var(--cream)' : 'var(--cream-dim)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${player ? player.display_name : 'Velg spiller'}
      </div>
      ${player ? `<div style="font-size:11px;color:var(--cream-dim);margin-top:2px;">HCP ${player.handicap ?? '–'}</div>` : ''}
      <div style="position:absolute;top:8px;right:8px;color:var(--cream-dim);font-size:14px;"><i class="ti ti-pencil"></i></div>
    </div>`;
}

function _renderH2hShell(el) {
  const { p1Id, p2Id, year } = _h2hState;
  const years = ['all', '2026', '2025'];

  el.innerHTML = `
    <div style="padding-bottom:40px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
        <div style="flex:1;" id="h2hSlot0">${_renderH2hPickerCard(0, p1Id)}</div>
        <div style="font-size:12px;font-weight:700;color:var(--cream-dim);flex-shrink:0;letter-spacing:1px;">VS</div>
        <div style="flex:1;" id="h2hSlot1">${_renderH2hPickerCard(1, p2Id)}</div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;">
        ${years.map(y => `
          <button onclick="setH2hYear('${y}')" style="padding:7px 14px;border-radius:8px;border:1px solid ${year === y ? 'var(--gold)' : 'rgba(255,255,255,0.12)'};background:${year === y ? 'rgba(201,168,76,0.15)' : 'transparent'};color:${year === y ? 'var(--gold)' : 'var(--cream-dim)'};font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
            ${y === 'all' ? 'Alle' : y}
          </button>`).join('')}
      </div>
      <div id="h2hData">
        ${p1Id && p2Id
          ? '<div class="loading"><div class="spinner"></div> Henter data...</div>'
          : '<div style="text-align:center;padding:32px 0;color:var(--cream-dim);font-size:14px;">Velg to spillere for å se statistikk</div>'}
      </div>
    </div>`;

  if (p1Id && p2Id) _loadAndRenderH2h();
}

function openH2hPicker(slot) {
  const { players, p1Id, p2Id } = _h2hState;
  const otherId = slot === 0 ? p2Id : p1Id;

  const existing = document.getElementById('h2hPickerOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'h2hPickerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:500;display:flex;align-items:flex-end;justify-content:center;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:#111f17;border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:500px;max-height:70vh;overflow-y:auto;border-top:1px solid rgba(201,168,76,0.2);';

  const available = players.filter(p => p.id !== otherId);
  sheet.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="font-family:'Playfair Display',serif;font-size:17px;color:var(--cream);">Velg spiller</div>
      <button onclick="document.getElementById('h2hPickerOverlay').remove()" style="background:none;border:none;color:var(--cream-dim);font-size:22px;cursor:pointer;-webkit-tap-highlight-color:transparent;"><i class="ti ti-x"></i></button>
    </div>
    ${available.map(p => `
      <div onclick="selectH2hPlayer(${slot}, '${p.id}')" style="display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:10px;cursor:pointer;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);-webkit-tap-highlight-color:transparent;">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(201,168,76,0.15);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:var(--gold);flex-shrink:0;">${_h2hInitials(p.display_name)}</div>
        <div>
          <div style="font-size:15px;color:var(--cream);">${p.display_name}</div>
          <div style="font-size:11px;color:var(--cream-dim);">HCP ${p.handicap ?? '–'}</div>
        </div>
      </div>`).join('')}`;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

function selectH2hPlayer(slot, playerId) {
  const overlay = document.getElementById('h2hPickerOverlay');
  if (overlay) overlay.remove();
  if (slot === 0) _h2hState.p1Id = playerId;
  else _h2hState.p2Id = playerId;
  const el = document.getElementById('statsContentH2h');
  _renderH2hShell(el);
}

function setH2hYear(year) {
  _h2hState.year = year;
  const el = document.getElementById('statsContentH2h');
  _renderH2hShell(el);
}

async function _loadAndRenderH2h() {
  const { p1Id, p2Id, year, players } = _h2hState;
  const dataEl = document.getElementById('h2hData');
  if (!dataEl) return;

  try {
    // Build date range
    let gteDate = null, ltDate = null;
    if (year !== 'all') {
      gteDate = `${year}-01-01`;
      ltDate = `${parseInt(year) + 1}-01-01`;
    }

    // Fetch completed rounds
    let q = db.from('rounds')
      .select('id, date, course_id, hole_range, courses(name), tee_sets(slope, course_rating)')
      .eq('status', 'completed')
      .order('date', { ascending: false });
    if (gteDate) q = q.gte('date', gteDate);
    if (ltDate) q = q.lt('date', ltDate);

    const { data: allRounds, error: rErr } = await q;
    if (rErr) throw new Error(rErr.message);
    if (!allRounds?.length) {
      dataEl.innerHTML = `<div style="text-align:center;padding:32px 0;color:var(--cream-dim);font-size:14px;">Ingen fullførte runder${year !== 'all' ? ` i ${year}` : ''}.</div>`;
      return;
    }

    const roundIds = allRounds.map(r => r.id);

    // Find shared rounds via flight_players
    const { data: flightData, error: fErr } = await db.from('flights')
      .select('round_id, flight_players(player_id, handicap)')
      .in('round_id', roundIds);
    if (fErr) throw new Error(fErr.message);

    // round_id -> { playerIds: Set, hcpMap: {playerId: hcp} }
    const roundInfo = {};
    for (const f of (flightData || [])) {
      if (!roundInfo[f.round_id]) roundInfo[f.round_id] = { playerIds: new Set(), hcpMap: {} };
      for (const fp of (f.flight_players || [])) {
        roundInfo[f.round_id].playerIds.add(fp.player_id);
        roundInfo[f.round_id].hcpMap[fp.player_id] = fp.handicap;
      }
    }

    const sharedRounds = allRounds.filter(r => roundInfo[r.id]?.playerIds.has(p1Id) && roundInfo[r.id]?.playerIds.has(p2Id));

    if (!sharedRounds.length) {
      dataEl.innerHTML = `<div style="text-align:center;padding:32px 0;color:var(--cream-dim);font-size:14px;">Ingen felles runder${year !== 'all' ? ` i ${year}` : ''}.</div>`;
      return;
    }

    const sharedIds = sharedRounds.map(r => r.id);
    const courseIds = [...new Set(sharedRounds.map(r => r.course_id).filter(Boolean))];

    const [{ data: scores }, { data: holes }] = await Promise.all([
      db.from('scores').select('round_id, player_id, hole_number, strokes').in('round_id', sharedIds),
      courseIds.length ? db.from('holes').select('course_id, hole_number, par, stroke_index').in('course_id', courseIds) : { data: [] },
    ]);

    const scoreMap = {};
    for (const s of (scores || [])) {
      const key = `${s.round_id}_${s.player_id}`;
      (scoreMap[key] = scoreMap[key] || {})[s.hole_number] = s.strokes;
    }

    const holesByCourse = {};
    for (const h of (holes || [])) {
      (holesByCourse[h.course_id] = holesByCourse[h.course_id] || {})[h.hole_number] = h;
    }

    // Compute per-round results
    const roundResults = [];
    for (const round of sharedRounds) {
      const courseHoles = holesByCourse[round.course_id] || {};
      const coursePar = Object.values(courseHoles).reduce((s, h) => s + (h.par || 0), 0) || 72;
      const hr = round.hole_range || 'all';
      const activeHoles = Object.values(courseHoles)
        .filter(h => hr === 'front9' ? h.hole_number <= 9 : hr === 'back9' ? h.hole_number >= 10 : true)
        .sort((a, b) => a.hole_number - b.hole_number);

      const computeSF = (playerId) => {
        const phcp = _playingHcp(roundInfo[round.id]?.hcpMap[playerId], round.tee_sets?.slope, round.tee_sets?.course_rating, coursePar);
        const pScores = scoreMap[`${round.id}_${playerId}`] || {};
        let total = 0, holesPlayed = 0;
        for (const hole of activeHoles) {
          const strokes = pScores[hole.hole_number];
          if (!strokes || strokes <= 0) continue;
          total += calcStableford(strokes, hole.par, phcp, hole.stroke_index);
          holesPlayed++;
        }
        let normalized = total;
        if ((round.hole_range === 'front9' || round.hole_range === 'back9') && holesPlayed >= 9) {
          const playedNums = new Set(activeHoles.map(h => h.hole_number));
          for (const h of Object.values(courseHoles)) {
            if (playedNums.has(h.hole_number) || !h.par || !h.stroke_index) continue;
            let tildelte = Math.floor(phcp / 18);
            if (h.stroke_index <= (phcp % 18)) tildelte++;
            normalized += calcStableford(h.par + tildelte, h.par, phcp, h.stroke_index);
          }
        }
        return { total, normalized, holesPlayed };
      };

      const p1r = computeSF(p1Id);
      const p2r = computeSF(p2Id);
      if (p1r.holesPlayed < 9 || p2r.holesPlayed < 9) continue;

      const winner = p1r.total > p2r.total ? 'p1' : p2r.total > p1r.total ? 'p2' : 'draw';
      roundResults.push({ round, p1: p1r, p2: p2r, winner });
    }

    if (!roundResults.length) {
      dataEl.innerHTML = `<div style="text-align:center;padding:32px 0;color:var(--cream-dim);font-size:14px;">Ingen fullstendige felles runder.</div>`;
      return;
    }

    // Aggregate
    let p1Wins = 0, p2Wins = 0, draws = 0;
    let p1SFSum = 0, p2SFSum = 0;
    let p1Best = -Infinity, p2Best = -Infinity;
    const courseCounts = {};

    for (const r of roundResults) {
      if (r.winner === 'p1') p1Wins++;
      else if (r.winner === 'p2') p2Wins++;
      else draws++;
      p1SFSum += r.p1.normalized;
      p2SFSum += r.p2.normalized;
      if (r.p1.normalized > p1Best) p1Best = r.p1.normalized;
      if (r.p2.normalized > p2Best) p2Best = r.p2.normalized;
      const cn = r.round.courses?.name || 'Ukjent';
      courseCounts[cn] = (courseCounts[cn] || 0) + 1;
    }

    const n = roundResults.length;
    const p1Avg = p1SFSum / n;
    const p2Avg = p2SFSum / n;
    const favCourse = Object.entries(courseCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '–';

    const p1Info = players.find(p => p.id === p1Id);
    const p2Info = players.find(p => p.id === p2Id);
    const p1Name = p1Info?.display_name ?? '–';
    const p2Name = p2Info?.display_name ?? '–';

    // Win/loss bar
    const winBarHtml = `
      <div style="margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--cream-dim);margin-bottom:8px;">
          <span style="color:var(--gold);font-weight:500;">${p1Name} (${p1Wins})</span>
          ${draws > 0 ? `<span>Uavgjort (${draws})</span>` : ''}
          <span style="color:var(--green-light);font-weight:500;">(${p2Wins}) ${p2Name}</span>
        </div>
        <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;gap:2px;">
          ${p1Wins > 0 ? `<div style="flex:${p1Wins};background:var(--gold);"></div>` : ''}
          ${draws > 0 ? `<div style="flex:${draws};background:rgba(255,255,255,0.18);"></div>` : ''}
          ${p2Wins > 0 ? `<div style="flex:${p2Wins};background:var(--green-light);"></div>` : ''}
        </div>
        <div style="text-align:center;font-size:11px;color:var(--cream-dim);margin-top:6px;">${n} felles runde${n !== 1 ? 'r' : ''}</div>
      </div>`;

    // Stats grid
    const statsGridHtml = `
      <div style="margin-bottom:24px;">
        <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Statistikk</div>
        <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;">
          ${_h2hStatRow(p1Avg.toFixed(1), 'Snitt Stableford', p2Avg.toFixed(1), p1Avg > p2Avg, p2Avg > p1Avg)}
          ${_h2hStatRow(p1Best.toFixed(1), 'Beste runde', p2Best.toFixed(1), p1Best > p2Best, p2Best > p1Best)}
          ${_h2hStatRow(p1Info?.handicap ?? '–', 'Nåværende HCP', p2Info?.handicap ?? '–', false, false)}
          <div style="padding:13px 16px;border-top:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;gap:8px;">
            <div style="font-size:12px;color:var(--cream-dim);flex-shrink:0;white-space:nowrap;">Favorittbane</div>
            <div style="flex:1;text-align:right;font-size:14px;color:var(--cream);font-weight:500;">${favCourse}</div>
          </div>
        </div>
      </div>`;

    // Recent rounds
    const recent = roundResults.slice(0, 10);
    const recentHtml = `
      <div>
        <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Siste runder</div>
        <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;">
          <div style="display:grid;grid-template-columns:14px 1fr auto;gap:10px;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <div></div>
            <div style="font-size:10px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;">Bane</div>
            <div style="display:flex;gap:16px;font-size:10px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;">
              <span style="width:22px;text-align:center;">${_h2hInitials(p1Name)}</span>
              <span style="width:22px;text-align:center;">${_h2hInitials(p2Name)}</span>
            </div>
          </div>
          ${recent.map((r, i) => {
            const dot = r.winner === 'p1' ? 'var(--gold)' : r.winner === 'p2' ? 'var(--green-light)' : 'rgba(255,255,255,0.3)';
            const dateStr = r.round.date ? r.round.date.slice(0, 10) : '–';
            return `
              <div style="display:grid;grid-template-columns:14px 1fr auto;align-items:center;gap:10px;padding:12px 14px;${i < recent.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : ''}">
                <div style="width:10px;height:10px;border-radius:50%;background:${dot};flex-shrink:0;"></div>
                <div>
                  <div style="font-size:13px;color:var(--cream);">${r.round.courses?.name || 'Ukjent'}</div>
                  <div style="font-size:11px;color:var(--cream-dim);">${dateStr}</div>
                </div>
                <div style="display:flex;gap:16px;">
                  <div style="width:22px;text-align:center;font-size:15px;font-weight:700;color:${r.winner === 'p1' ? 'var(--gold)' : 'var(--cream)'};">${r.p1.total}</div>
                  <div style="width:22px;text-align:center;font-size:15px;font-weight:700;color:${r.winner === 'p2' ? 'var(--gold)' : 'var(--cream)'};">${r.p2.total}</div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;

    dataEl.innerHTML = winBarHtml + statsGridHtml + recentHtml;
  } catch (e) {
    dataEl.innerHTML = `<div class="empty"><p style="color:var(--cream-dim);">Feil: ${e.message}</p></div>`;
  }
}

function _h2hStatRow(v1, label, v2, p1Better, p2Better) {
  return `
    <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="font-size:18px;font-weight:700;color:${p1Better ? 'var(--gold)' : 'var(--cream)'};">${v1}</div>
      <div style="font-size:11px;color:var(--cream-dim);text-align:center;white-space:nowrap;">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${p2Better ? 'var(--gold)' : 'var(--cream)'};text-align:right;">${v2}</div>
    </div>`;
}
