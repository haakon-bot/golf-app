// ── SCORING SCREEN ──
let currentRound = null;
let currentHole = 1;
let roundScores = {};
let roundHoles = [];
let roundFlights = [];
let _fullCoursePar = 72; // full 18-hole par, set when opening a round
// Min identitet i denne runden: innlogget profil ELLER enhets-claim (gjest
// uten login, §2.7 G4). Styrer isParticipant + canEdit per flight.
let _myRoundPlayerId = null;
// Lag-scoring (scramble, §3.2/§5.1): lag-rader og lag-scores holdes adskilt
// fra spillerscores så personlig statistikk ikke forurenses.
let roundTeams = [];        // game_teams for scramble-hovedspillet
let roundTeamScores = {};   // team_id → hull → slag
let _scrambleGameRow = null;
async function deleteRound(roundId) {
  const confirmed = await showConfirm('Slette denne runden? Dette sletter alle scores og kan ikke angres.');
  if (!confirmed) return;
  const { error: e1 } = await db.from('scores').delete().eq('round_id', roundId);
  const { data: flights } = await db.from('flights').select('id').eq('round_id', roundId);
  for (const f of (flights || [])) {
    await db.from('flight_players').delete().eq('flight_id', f.id);
  }
  await db.from('flights').delete().eq('round_id', roundId);
  const { error: e2 } = await db.from('rounds').delete().eq('id', roundId);
  if (e2) {
    alert('Kunne ikke slette runden. Du må være admin eller delta i runden for å slette den.\n\n' + e2.message);
    return;
  }
  loadRounds();
  loadDashboard();
}

async function openRound(roundId) {
  // Show scoring screen immediately so the tap always feels responsive
  document.getElementById('scCourseName').textContent = 'Laster runde...';
  document.getElementById('scRoundDate').textContent = '';
  document.getElementById('scPlayerScores').innerHTML = '<div style="padding:40px;text-align:center;color:var(--cream-dim);">Laster...</div>';
  document.getElementById('scoringScreen').style.display = 'flex';
  document.getElementById('scoringScreen').style.flexDirection = 'column';
  const { data: round } = await db.from('rounds')
    .select('*, courses(name, holes), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name, username))), games(*, game_teams(*))')
    .eq('id', roundId).single();
  if (!round) { document.getElementById('scoringScreen').style.display = 'none'; return; }
  if (!round.course_id) {
    document.getElementById('scoringScreen').style.display = 'none';
    alert('Denne runden mangler bane og kan ikke åpnes. Slett den fra rundeoversikten.');
    return;
  }
  const { data: holes } = await db.from('holes').select('*').eq('course_id', round.course_id).order('hole_number');
  const { data: scores } = await db.from('scores').select('*').eq('round_id', roundId);
  currentRound = round;
  const holeRange = round.hole_range || 'all';
  const allHoles = holes || [];
  _fullCoursePar = allHoles.reduce((s,h) => s + (h.par||0), 0) || 72;
  if (holeRange === 'front9') {
    roundHoles = allHoles.filter(h => h.hole_number <= 9);
  } else if (holeRange === 'back9') {
    roundHoles = allHoles.filter(h => h.hole_number >= 10);
  } else {
    roundHoles = allHoles;
  }
  currentHole = roundHoles.length > 0 ? Math.min(...roundHoles.map(h => h.hole_number)) : 1;
  roundFlights = round.flights || [];
  _scrambleGameRow = scrambleGame(round);
  roundTeams = _scrambleGameRow?.game_teams || [];
  roundScores = {};
  roundTeamScores = {};
  (scores || []).forEach(s => {
    if (s.team_id) {
      if (!roundTeamScores[s.team_id]) roundTeamScores[s.team_id] = {};
      roundTeamScores[s.team_id][s.hole_number] = s.strokes;
    } else if (s.player_id) {
      if (!roundScores[s.player_id]) roundScores[s.player_id] = {};
      roundScores[s.player_id][s.hole_number] = s.strokes;
    }
  });
  document.getElementById('scCourseName').textContent = round.courses?.name || '';
  document.getElementById('scRoundDate').textContent = round.date;
  const teeBtnEl = document.getElementById('scTeeBtn');
  if (teeBtnEl) teeBtnEl.textContent = round.tee_sets?.name ? `Tee: ${round.tee_sets.name} ✏️` : '';

  // Identitet i denne runden: et EKSPLISITT valg («velg deg selv» via #join,
  // lagret i localStorage) vinner over innlogget profil — slik at hvis du velger
  // deg i flight 2, taster du i flight 2 (ikke innloggings-flighten din). Faller
  // tilbake på innlogget profil når du ikke har valgt deg selv (§2.7).
  _myRoundPlayerId = (() => {
    const fpId = localStorage.getItem('fore_me_' + round.id);
    if (fpId) {
      const fp = (round.flights || []).flatMap(f => f.flight_players || []).find(x => x.id === fpId);
      if (fp?.player_id) return fp.player_id;
    }
    return currentProfile?.id || null;
  })();
  const isParticipant = roundFlights.some(f => f.flight_players?.some(fp => fp.player_id === _myRoundPlayerId));
  const finishBtn = document.getElementById('scFinishBtn');
  const nextBottom = document.getElementById('scNextHoleBottom');
  if (finishBtn) finishBtn.style.display = isParticipant ? 'inline-block' : 'none';
  if (nextBottom) nextBottom.style.display = isParticipant ? 'block' : 'none';
  // ⚙ Oppsett kun for deltakere i en aktiv runde (§2.6 rediger oppsett)
  const editBtn = document.getElementById('scEditBtn');
  if (editBtn) editBtn.style.display = (isParticipant && round.status === 'active') ? 'inline-block' : 'none';

  renderScoringHole();
  document.getElementById('scoringScreen').style.display = 'flex';
  document.getElementById('scoringScreen').style.flexDirection = 'column';
}
async function closeScoringScreen() {
  if (currentRound?.status === 'active') {
    const ok = await showConfirm('Forlate spillet? Det lagres og kan gjenopptas fra oversikten.', 'Forlat');
    if (!ok) return;
  }
  document.getElementById('scoringScreen').style.display = 'none';
  if (currentProfile) { loadRounds(); loadDashboard(); }
  else if (typeof showJoinPage === 'function') { showJoinPage(); }   // gjest → tilbake til bli-med
}
function renderScoringHole() {
  const holeData = roundHoles.find(h => h.hole_number === currentHole) || { par: null, stroke_index: null };
  const firstHole = roundHoles.length > 0 ? Math.min(...roundHoles.map(h => h.hole_number)) : 1;
  const lastHole = roundHoles.length > 0 ? Math.max(...roundHoles.map(h => h.hole_number)) : (currentRound?.courses?.holes || 18);
  const isLastHole = currentHole === lastHole;
  document.getElementById('scHoleNum').textContent = currentHole;
  document.getElementById('scPar').textContent = holeData.par ?? '?';
  document.getElementById('scSI').textContent = holeData.stroke_index ?? '?';
  document.getElementById('scPrevHole').style.opacity = currentHole === firstHole ? '0.3' : '1';
  // Oppdater begge Neste-knapper
  const nextTop = document.getElementById('scNextHole');
  const nextBottom = document.getElementById('scNextHoleBottom');
  if (nextTop) nextTop.textContent = isLastHole ? 'Avslutt →' : 'Neste →';
  if (nextBottom) {
    nextBottom.textContent = isLastHole ? '🏁 Avslutt runde' : 'Neste hull →';
    nextBottom.style.background = isLastHole ? 'var(--green-mid)' : 'var(--gold)';
    nextBottom.style.color = isLastHole ? 'var(--gold-light)' : 'var(--green-deep)';
  }
  if (!holeData.par) {
    document.getElementById('scPar').style.color = 'var(--gold)';
  } else {
    document.getElementById('scPar').style.color = 'var(--cream)';
  }
  renderHoleStats();
  if (_scrambleGameRow) {
    renderTeamInputs(holeData);
  } else {
    renderPlayerInputs(holeData);
  }
  renderMiniLeaderboard();
  renderScrambleTracker();
  renderSkinsTracker();
}
function renderHoleStats() {
  const allFP = roundFlights.flatMap(f => f.flight_players || []);
  const parStats = {};
  for (const hole of roundHoles) {
    const p = hole.par;
    if (![3, 4, 5].includes(p)) continue;
    if (!parStats[p]) parStats[p] = {};
    for (const fp of allFP) {
      const s = roundScores[fp.player_id]?.[hole.hole_number];
      if (!s || s <= 0) continue;
      const firstName = (fp.profiles?.display_name || '?').split(' ')[0];
      if (!parStats[p][fp.player_id]) parStats[p][fp.player_id] = { name: firstName, sum: 0, count: 0 };
      parStats[p][fp.player_id].sum += s;
      parStats[p][fp.player_id].count++;
    }
  }
  const colStyle = 'flex:1;padding:8px 4px;text-align:center;border-right:1px solid rgba(255,255,255,0.05);';
  const html = [3, 4, 5].map((p, i) => {
    const data = parStats[p];
    const isLast = i === 2;
    const players = data ? Object.values(data) : [];
    const totalCount = players.reduce((s, pl) => s + pl.count, 0);
    const avg = totalCount ? (players.reduce((s, pl) => s + pl.sum, 0) / totalCount).toFixed(1) : null;
    const best = players.length ? [...players].sort((a, b) => (a.sum/a.count) - (b.sum/b.count))[0] : null;
    return `<div style="${colStyle}${isLast ? 'border-right:none;' : ''}">
      <div style="font-size:9px;color:var(--cream-dim);letter-spacing:1px;text-transform:uppercase;">Par ${p}</div>
      <div style="font-family:'Playfair Display',serif;font-size:20px;color:${avg ? 'var(--gold-light)' : 'var(--cream-dim)'};">${avg ?? '–'}</div>
      <div style="font-size:9px;color:var(--gold);min-height:12px;">${best ? best.name : ''}</div>
    </div>`;
  }).join('');
  document.getElementById('scParStats').innerHTML = html;
}
function renderPlayerInputs(holeData) {
  const _rSlope = currentRound?.tee_sets?.slope, _rCr = currentRound?.tee_sets?.course_rating;
  let html = '';
  roundFlights.forEach(flight => {
    const canEdit = flight.flight_players?.some(fp => fp.player_id === _myRoundPlayerId);
    html += `<div style="margin-bottom:16px;">
      <div style="font-size:11px; color:var(--cream-dim); letter-spacing:1.5px; text-transform:uppercase; margin-bottom:8px;">${flight.name}${canEdit ? ' · <span style="color:var(--green-light);">din flight</span>' : ' <span style="color:rgba(255,255,255,0.3);">· kun visning</span>'}</div>`;
    (flight.flight_players || []).forEach(fp => {
      const player = fp.profiles;
      const strokes = roundScores[fp.player_id]?.[currentHole] || 0;
      const _phcp = _playingHcp(fp.handicap, _rSlope, _rCr, _fullCoursePar);
      const stableford = (holeData.par && holeData.stroke_index)
        ? calcStableford(strokes, holeData.par, _phcp, holeData.stroke_index)
        : 0;
      const scoreColor = holeData.par ? getScoreColor(strokes, holeData.par) : 'var(--cream)';
      const scoreName = holeData.par ? getScoreName(strokes, holeData.par) : '';
      const activeHcpBadge = _activeStrokes(_phcp, roundHoles);
      let extraStrokes = 0;
      if (holeData.stroke_index) {
        extraStrokes = Math.floor(_phcp / 18);
        if (holeData.stroke_index <= (_phcp % 18)) extraStrokes++;
      }
      const strokesLabel = extraStrokes > 0
        ? `<span style="color:var(--green-light); font-size:11px;">${extraStrokes === 1 ? '+1 slag' : `+${extraStrokes} slag`}</span>`
        : '';
      html += `
      <div style="display:flex; align-items:center; gap:12px; padding:12px; background:rgba(0,0,0,0.2); border-radius:10px; margin-bottom:8px; border:1px solid rgba(255,255,255,0.06);">
        <div style="width:36px; height:36px; border-radius:50%; background:var(--green-mid); border:2px solid var(--gold-dim); display:flex; align-items:center; justify-content:center; font-family:'Playfair Display',serif; font-size:14px; color:var(--gold-light); flex-shrink:0;">
          ${(player?.display_name || '?')[0]}
        </div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <div style="font-size:14px;color:var(--cream);font-weight:500;">${player?.display_name || '?'}</div>
            <div style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(201,168,76,0.15);color:var(--gold-dim);white-space:nowrap;">${activeHcpBadge} slag</div>
          </div>
          <div style="font-size:11px;color:var(--cream-dim);">HCP ${fp.handicap || '–'} ${strokesLabel} ${strokes > 0 ? `· <span style="color:${scoreColor}">${scoreName}</span> · ${stableford}p` : ''}</div>
        </div>
        ${canEdit ? `
        <div style="display:flex; align-items:center; gap:8px;">
          <button onclick="adjustScore('${fp.player_id}', -1)" style="width:48px; height:48px; border-radius:50%; border:1px solid rgba(255,255,255,0.2); background:transparent; color:var(--cream); font-size:24px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1; touch-action:manipulation; -webkit-tap-highlight-color:transparent; user-select:none;">−</button>
          <div id="score-${fp.player_id}" style="font-family:'Playfair Display',serif; font-size:36px; color:${scoreColor}; min-width:40px; text-align:center;">${strokes || '–'}</div>
          <button onclick="adjustScore('${fp.player_id}', 1)" style="width:48px; height:48px; border-radius:50%; background:var(--green-mid); border:none; color:var(--cream); font-size:24px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1; touch-action:manipulation; -webkit-tap-highlight-color:transparent; user-select:none;">+</button>
        </div>` : `
        <div style="font-family:'Playfair Display',serif; font-size:32px; color:${scoreColor}; min-width:36px; text-align:center;">${strokes || '–'}</div>`}
      </div>`;
    });
    html += '</div>';
  });
  document.getElementById('scPlayerScores').innerHTML = html;
}

// ── Lag-scoring (scramble) ──────────────────────────────────────────────
// ctx til spillmotoren. events tom i increment 1 (utslags-tracker kommer i
// increment 2) — compute takler det (kvote dvaler når countingDrives er av).
function _scrambleCtx() {
  return { round: currentRound, holes: roundHoles, teamScores: roundTeamScores, teams: roundTeams, events: [], fullCoursePar: _fullCoursePar };
}
function _memberFirstName(playerId) {
  for (const f of roundFlights) {
    const fp = (f.flight_players || []).find(x => x.player_id === playerId);
    if (fp) return (fp.profiles?.display_name || '?').split(' ')[0];
  }
  return '?';
}
function renderTeamInputs(holeData) {
  let html = '';
  roundTeams.forEach(team => {
    const canEdit = (team.member_ids || []).includes(_myRoundPlayerId);
    const teamHcp = team.team_handicap != null ? Number(team.team_handicap) : 0;
    const strokes = roundTeamScores[team.id]?.[currentHole] || 0;
    const extra = _teamExtraStrokes(teamHcp, holeData.stroke_index);
    const net = strokes ? strokes - extra : 0;
    const stableford = (holeData.par && holeData.stroke_index && strokes) ? calcStableford(strokes, holeData.par, teamHcp, holeData.stroke_index) : 0;
    const scoreColor = holeData.par ? getScoreColor(strokes, holeData.par) : 'var(--cream)';
    const scoreName = holeData.par ? getScoreName(strokes, holeData.par) : '';
    const memberNames = (team.member_ids || []).map(_memberFirstName).join(', ');
    const strokesLabel = extra > 0 ? `<span style="color:var(--green-light); font-size:11px;">${extra === 1 ? '+1 slag' : `+${extra} slag`}</span>` : '';
    html += `
    <div style="display:flex; align-items:center; gap:12px; padding:12px; background:rgba(0,0,0,0.2); border-radius:10px; margin-bottom:8px; border:1px solid rgba(255,255,255,0.06);">
      <div style="width:36px; height:36px; border-radius:50%; background:var(--green-mid); border:2px solid var(--gold-dim); display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">⛳</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <div style="font-size:14px;color:var(--cream);font-weight:500;">${team.name}</div>
          <div style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(201,168,76,0.15);color:var(--gold-dim);white-space:nowrap;">HCP ${team.team_handicap ?? '–'}</div>
        </div>
        <div style="font-size:11px;color:var(--cream-dim);">${memberNames} ${strokesLabel} ${strokes > 0 ? `· <span style="color:${scoreColor}">${scoreName}</span> · netto ${net} · ${stableford}p` : ''}</div>
      </div>
      ${canEdit ? `
      <div style="display:flex; align-items:center; gap:8px;">
        <button onclick="adjustTeamScore('${team.id}', -1)" style="width:48px; height:48px; border-radius:50%; border:1px solid rgba(255,255,255,0.2); background:transparent; color:var(--cream); font-size:24px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1; touch-action:manipulation; -webkit-tap-highlight-color:transparent; user-select:none;">−</button>
        <div id="teamscore-${team.id}" style="font-family:'Playfair Display',serif; font-size:36px; color:${scoreColor}; min-width:40px; text-align:center;">${strokes || '–'}</div>
        <button onclick="adjustTeamScore('${team.id}', 1)" style="width:48px; height:48px; border-radius:50%; background:var(--green-mid); border:none; color:var(--cream); font-size:24px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1; touch-action:manipulation; -webkit-tap-highlight-color:transparent; user-select:none;">+</button>
      </div>` : `
      <div style="font-family:'Playfair Display',serif; font-size:32px; color:${scoreColor}; min-width:36px; text-align:center;">${strokes || '–'}</div>`}
    </div>`;
  });
  document.getElementById('scPlayerScores').innerHTML = html;
}
let _adjustTeamLock = false;
async function adjustTeamScore(teamId, delta) {
  if (_adjustTeamLock) return;
  _adjustTeamLock = true;
  setTimeout(() => { _adjustTeamLock = false; }, 300);
  if (!roundTeamScores[teamId]) roundTeamScores[teamId] = {};
  const current = roundTeamScores[teamId][currentHole] || 0;
  const newVal = Math.max(1, Math.min(current + delta, 15));
  if (delta === -1 && current <= 1) {
    roundTeamScores[teamId][currentHole] = 0;
    await db.from('scores').delete()
      .eq('round_id', currentRound.id)
      .eq('team_id', teamId)
      .eq('hole_number', currentHole);
  } else {
    roundTeamScores[teamId][currentHole] = newVal;
    await db.from('scores').upsert({
      round_id: currentRound.id, team_id: teamId,
      hole_number: currentHole, strokes: newVal,
      updated_at: new Date().toISOString()
    }, { onConflict: 'round_id,team_id,hole_number' });
  }
  const holeData = roundHoles.find(h => h.hole_number === currentHole) || { par: null, stroke_index: null };
  renderTeamInputs(holeData);
  renderMiniLeaderboard();
  renderScrambleTracker();
}
function renderScrambleTracker() {
  const strip = document.getElementById('scScrambleStrip');
  const el = document.getElementById('scScramble');
  if (!strip || !el) return;
  if (!_scrambleGameRow) { strip.style.display = 'none'; el.innerHTML = ''; return; }
  const html = getGame('scramble').trackerUI(_scrambleCtx());
  strip.style.display = html ? 'block' : 'none';
  el.innerHTML = html || '';
}
function renderTeamMiniLeaderboard() {
  const el = document.getElementById('scMiniLeader');
  if (!el) return;
  const data = getGame('scramble').compute(_scrambleCtx());
  if (!data || !data.teams.length) { el.innerHTML = ''; return; }
  const scoring = data.scoring;
  el.innerHTML = data.teams.map((r, i) => {
    const lead = i === 0 && r.thru > 0;
    const vsPar = r.totalGross ? r.totalNet - r.totalPar : null;
    const main = scoring === 'stableford' ? `${r.totalSf}p`
      : scoring === 'slag' ? `${r.totalGross || '–'}`
      : (vsPar == null ? '–' : vsPar === 0 ? 'E' : vsPar > 0 ? `+${vsPar}` : `${vsPar}`);
    return `<div style="flex-shrink:0; text-align:center; padding:8px 14px; background:${lead ? 'rgba(201,168,76,0.2)' : 'rgba(0,0,0,0.2)'}; border-radius:8px; border:1px solid ${lead ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.06)'};">
      <div style="font-size:10px; color:var(--cream-dim);">${i + 1}. ${r.team.name}</div>
      <div style="font-family:'Playfair Display',serif; font-size:20px; color:${lead ? 'var(--gold)' : 'var(--cream)'};">${main}</div>
      <div style="font-size:10px; color:var(--cream-dim);">${r.thru} hull</div>
    </div>`;
  }).join('');
}
// _playingHcp og calcStableford bor nå i games.js (spillmotoren, delte helpers).
// Counts extra strokes from fullHCP that land on the given active holes (full 18-hole distribution).
function _activeStrokes(fullHCP, activeHoles) {
  return (activeHoles || []).reduce((sum, hole) => {
    if (!hole.stroke_index) return sum;
    let extra = Math.floor(fullHCP / 18);
    if (hole.stroke_index <= (fullHCP % 18)) extra++;
    return sum + extra;
  }, 0);
}
function _fmtVsPar(n) {
  if (n == null || isNaN(n)) return '–';
  if (n === 0) return 'E';
  return n > 0 ? '+' + n : '' + n;
}
function _vsParColor(n) {
  if (n == null || isNaN(n)) return 'var(--cream-dim)';
  if (n < 0) return 'var(--green-light)';
  if (n === 0) return 'var(--cream-dim)';
  return '#f09595';
}
function getScoreColor(strokes, par) {
  if (!strokes || !par) return 'var(--cream)';
  const d = strokes - par;
  if (strokes === 1) return '#f5c518';
  if (d <= -3) return '#f5c518';
  if (d === -2) return '#f5c518';
  if (d === -1) return 'var(--gold-light)';
  if (d === 0) return 'var(--cream)';
  if (d === 1) return '#e8a070';
  return 'var(--danger)';
}
function getScoreName(strokes, par) {
  if (!strokes || !par) return '';
  if (strokes === 1) return 'Hole in One! 🏆';
  const d = strokes - par;
  if (d <= -3) return 'Albatross 🦅🦅';
  if (d === -2) return 'Eagle 🦅';
  if (d === -1) return 'Birdie 🐦';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Dobbelt';
  if (d === 3) return 'Trippel';
  return `+${d}`;
}
let _adjustScoreLock = false;
async function adjustScore(playerId, delta) {
  if (_adjustScoreLock) return;
  _adjustScoreLock = true;
  // Always release the lock — even if the DB call fails after wake/network hiccup
  setTimeout(() => { _adjustScoreLock = false; }, 300);
  if (!roundScores[playerId]) roundScores[playerId] = {};
  const current = roundScores[playerId][currentHole] || 0;
  const newVal = Math.max(1, Math.min(current + delta, 15));
  // Ikke gå under 1 (bruk − for å komme til 0/tomt = slett score)
  if (delta === -1 && current <= 1) {
    roundScores[playerId][currentHole] = 0;
    await db.from('scores').delete()
      .eq('round_id', currentRound.id)
      .eq('player_id', playerId)
      .eq('hole_number', currentHole);
  } else {
    roundScores[playerId][currentHole] = newVal;
    await db.from('scores').upsert({
      round_id: currentRound.id, player_id: playerId,
      hole_number: currentHole, strokes: newVal,
      updated_at: new Date().toISOString()
    }, { onConflict: 'round_id,player_id,hole_number' });
  }
  const holeData = roundHoles.find(h => h.hole_number === currentHole) || { par: null, stroke_index: null };
  renderPlayerInputs(holeData);
  renderMiniLeaderboard();
}
function changeHole(delta) {
  const firstHole = roundHoles.length > 0 ? Math.min(...roundHoles.map(h => h.hole_number)) : 1;
  const lastHole = roundHoles.length > 0 ? Math.max(...roundHoles.map(h => h.hole_number)) : (currentRound?.courses?.holes || 18);
  const newHole = currentHole + delta;
  if (newHole < firstHole) return;
  if (newHole > lastHole) { finishRound(); return; }
  currentHole = newHole;
  renderScoringHole();
  document.getElementById('scoringScreen').scrollTo(0, 0);
}
function renderMiniLeaderboard() {
  if (_scrambleGameRow) return renderTeamMiniLeaderboard();
  const _rSlope = currentRound?.tee_sets?.slope, _rCr = currentRound?.tee_sets?.course_rating;
  const allFP = roundFlights.flatMap(f => f.flight_players || []);
  const standings = allFP.map(fp => {
    let total = 0, holes = 0;
    const hcp = _playingHcp(fp.handicap, _rSlope, _rCr, _fullCoursePar);
    Object.entries(roundScores[fp.player_id] || {}).forEach(([h, s]) => {
      if (s > 0) {
        const hd = roundHoles.find(hh => hh.hole_number === parseInt(h));
        if (hd?.par && hd?.stroke_index) {
          let extra = Math.floor(hcp / 18);
          if (hd.stroke_index <= (hcp % 18)) extra++;
          const pts = Math.max(0, hd.par - (s - extra) + 2);
          total += pts;
        }
        holes++;
      }
    });
    return { name: fp.profiles?.display_name?.split(' ')[0] || '?', total, holes };
  }).sort((a, b) => b.total - a.total);
  document.getElementById('scMiniLeader').innerHTML = standings.map((p, i) => `
    <div style="flex-shrink:0; text-align:center; padding:8px 14px; background:${i === 0 ? 'rgba(201,168,76,0.2)' : 'rgba(0,0,0,0.2)'}; border-radius:8px; border:1px solid ${i === 0 ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.06)'};">
      <div style="font-size:10px; color:var(--cream-dim);">${i + 1}. ${p.name}</div>
      <div style="font-family:'Playfair Display',serif; font-size:20px; color:${i === 0 ? 'var(--gold)' : 'var(--cream)'};">${p.total}p</div>
      <div style="font-size:10px; color:var(--cream-dim);">${p.holes} hull</div>
    </div>
  `).join('');
}
// toggleSkinsAmount + skins-beregning/-rendring bor nå i games.js (skins-modulen).
// Tynn wrapper: bygg ctx og la motoren rendre tracker-stripa.
function renderSkinsTracker() {
  const strip = document.getElementById('scSkinsStrip');
  const el = document.getElementById('scSkins');
  if (!strip || !el) return;
  const html = getGame('skins').trackerUI({
    round: currentRound, holes: roundHoles, scores: roundScores,
    flights: roundFlights, fullCoursePar: _fullCoursePar,
  });
  strip.style.display = html ? 'block' : 'none';
  el.innerHTML = html || '';
}

function _scorecardInlineHtml(fp, scores, holes, round, fullCoursePar) {
  const phcp = _playingHcp(fp.handicap, round?.tee_sets?.slope, round?.tee_sets?.course_rating, fullCoursePar || 72);
  let totalBrutto = 0, totalNetto = 0, totalPar = 0, totalStab = 0, played = 0;
  const rows = holes.map(h => {
    const s = scores[h.hole_number];
    if (!s || s <= 0 || !h.par || !h.stroke_index) {
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
        <td style="padding:5px 8px;color:var(--gold-dim);font-weight:600;">${h.hole_number}</td>
        <td style="padding:5px 8px;text-align:center;color:var(--cream-dim);">${h.par || '–'}</td>
        <td colspan="5" style="padding:5px 8px;text-align:center;color:rgba(255,255,255,0.2);">–</td>
      </tr>`;
    }
    let extra = Math.floor(phcp / 18);
    if (h.stroke_index <= (phcp % 18)) extra++;
    const netto = s - extra;
    const bvp = s - h.par;
    const nvp = netto - h.par;
    const stab = Math.max(0, h.par - netto + 2);
    totalBrutto += s; totalNetto += netto; totalPar += h.par; totalStab += stab; played++;
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:5px 8px;color:var(--gold-dim);font-weight:600;">${h.hole_number}</td>
      <td style="padding:5px 8px;text-align:center;color:var(--cream-dim);">${h.par}</td>
      <td style="padding:5px 8px;text-align:center;color:var(--cream);font-weight:500;">${s}</td>
      <td style="padding:5px 8px;text-align:center;font-weight:600;color:${_vsParColor(bvp)};">${_fmtVsPar(bvp)}</td>
      <td style="padding:5px 8px;text-align:center;color:var(--cream);">${netto}</td>
      <td style="padding:5px 8px;text-align:center;font-weight:600;color:${_vsParColor(nvp)};">${_fmtVsPar(nvp)}</td>
      <td style="padding:5px 8px;text-align:center;font-weight:600;color:${stab >= 3 ? 'var(--gold)' : stab === 2 ? 'var(--cream)' : '#f09595'};">${stab}p</td>
    </tr>`;
  }).join('');
  const bvpTot = played ? totalBrutto - totalPar : null;
  const nvpTot = played ? totalNetto - totalPar : null;
  const th = 'padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;';
  return `<div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <th style="${th}text-align:left;">Hull</th><th style="${th}">Par</th>
        <th style="${th}">Slag</th><th style="${th}">±</th>
        <th style="${th}">Netto</th><th style="${th}">N±</th><th style="${th}">Stab</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:1px solid rgba(255,255,255,0.1);">
        <td style="padding:7px 8px;color:var(--cream);font-weight:600;">Tot</td>
        <td style="padding:7px 8px;text-align:center;color:var(--cream-dim);">${totalPar || '–'}</td>
        <td style="padding:7px 8px;text-align:center;color:var(--cream);font-weight:600;">${played ? totalBrutto : '–'}</td>
        <td style="padding:7px 8px;text-align:center;font-weight:700;color:${_vsParColor(bvpTot)};">${_fmtVsPar(bvpTot)}</td>
        <td style="padding:7px 8px;text-align:center;color:var(--cream);">${played ? totalNetto : '–'}</td>
        <td style="padding:7px 8px;text-align:center;font-weight:700;color:${_vsParColor(nvpTot)};">${_fmtVsPar(nvpTot)}</td>
        <td style="padding:7px 8px;text-align:center;font-weight:700;color:var(--gold);">${totalStab}p</td>
      </tr></tfoot>
    </table>
  </div>`;
}
function showLeaderboard() {
  const allFP = roundFlights.flatMap(f => f.flight_players || []);
  const standings = allFP.map(fp => {
    const phcp = _playingHcp(fp.handicap, currentRound?.tee_sets?.slope, currentRound?.tee_sets?.course_rating, _fullCoursePar);
    let brutto = 0, netto = 0, parThru = 0, stab = 0, holesPlayed = 0;
    Object.entries(roundScores[fp.player_id] || {}).forEach(([h, s]) => {
      if (s > 0) {
        const hd = roundHoles.find(hh => hh.hole_number === parseInt(h));
        if (hd?.par && hd?.stroke_index) {
          let extra = Math.floor(phcp / 18);
          if (hd.stroke_index <= (phcp % 18)) extra++;
          brutto += s; netto += s - extra; parThru += hd.par;
          stab += calcStableford(s, hd.par, phcp, hd.stroke_index);
          holesPlayed++;
        }
      }
    });
    return { fp, stab, holesPlayed, bruttoVsPar: holesPlayed ? brutto - parThru : null, nettoVsPar: holesPlayed ? netto - parThru : null };
  }).sort((a, b) => b.stab - a.stab);
  document.getElementById('leaderboardContent').innerHTML = standings.map((p, i) => {
    const isLead = i === 0;
    const firstName = (p.fp.profiles?.display_name || '?').split(' ')[0];
    const scHtml = _scorecardInlineHtml(p.fp, roundScores[p.fp.player_id] || {}, roundHoles, currentRound, _fullCoursePar);
    return `<div style="border-bottom:1px solid rgba(255,255,255,0.05);">
      <div onclick="toggleLeaderboardScorecard('${p.fp.player_id}')" style="display:grid;grid-template-columns:24px 1fr auto auto auto;align-items:center;gap:8px;padding:12px 16px;${isLead ? 'background:rgba(201,168,76,0.07);' : ''}cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div style="font-size:13px;color:${isLead ? 'var(--gold)' : 'var(--cream-dim)'};text-align:center;">${i+1}</div>
        <div>
          <div style="font-size:14px;color:var(--cream);font-weight:${isLead ? '600' : '400'};">${firstName}</div>
          <div style="font-size:11px;color:var(--cream-dim);">thru ${p.holesPlayed} · HCP ${p.fp.handicap ?? '–'}</div>
        </div>
        <div style="text-align:center;min-width:38px;">
          <div style="font-size:10px;color:var(--cream-dim);margin-bottom:2px;">Brutto</div>
          <div style="font-size:14px;font-weight:600;color:${_vsParColor(p.bruttoVsPar)};">${_fmtVsPar(p.bruttoVsPar)}</div>
        </div>
        <div style="text-align:center;min-width:38px;">
          <div style="font-size:10px;color:var(--cream-dim);margin-bottom:2px;">Netto</div>
          <div style="font-size:14px;font-weight:600;color:${_vsParColor(p.nettoVsPar)};">${_fmtVsPar(p.nettoVsPar)}</div>
        </div>
        <div style="text-align:center;min-width:38px;">
          <div style="font-size:10px;color:var(--cream-dim);margin-bottom:2px;">Stab</div>
          <div style="font-size:16px;font-weight:600;color:var(--gold);">${p.stab}p</div>
        </div>
      </div>
      <div id="lbsc-${p.fp.player_id}" style="display:none;padding:0 16px 14px;background:rgba(0,0,0,0.15);">${scHtml}</div>
    </div>`;
  }).join('');
  openModal('modalLeaderboard');
}
function toggleLeaderboardScorecard(playerId) {
  const target = document.getElementById('lbsc-' + playerId);
  if (!target) return;
  const isOpen = target.style.display !== 'none';
  document.querySelectorAll('[id^="lbsc-"]').forEach(e => { e.style.display = 'none'; });
  if (!isOpen) target.style.display = 'block';
}
function showPlayerScorecard(fp, scores, holes, round, fullCoursePar) {
  const name = fp.profiles?.display_name || '?';
  const phcp = _playingHcp(fp.handicap, round?.tee_sets?.slope, round?.tee_sets?.course_rating, fullCoursePar || 72);
  document.getElementById('scorecardModalTitle').textContent = `${name} · ${phcp} slag`;
  document.getElementById('scorecardModalContent').innerHTML = _scorecardInlineHtml(fp, scores, holes, round, fullCoursePar);
  openModal('modalPlayerScorecard');
}
async function openChangeTee() {
  if (!currentRound) return;
  const { data: tees } = await db.from('tee_sets').select('id, name, slope, course_rating').eq('course_id', currentRound.course_id).order('name');
  const sel = document.getElementById('changeTeeSelect');
  sel.innerHTML = (tees || []).map(t => `<option value="${t.id}" ${t.id === currentRound.tee_set_id ? 'selected' : ''}>${t.name} — Slope ${t.slope}, CR ${t.course_rating}</option>`).join('');
  openModal('modalChangeTee');
}
async function applyTeeChange() {
  const newTeeId = document.getElementById('changeTeeSelect').value;
  if (!newTeeId || newTeeId === currentRound.tee_set_id) { closeModal('modalChangeTee'); return; }
  // Score-endrende operasjon (ny slope/CR → ny netto/tildelte slag for alle).
  const ok = await showConfirm('Bytte tee regner om score for alle — fortsett?', 'Bytt tee');
  if (!ok) return;
  await db.from('rounds').update({ tee_set_id: newTeeId }).eq('id', currentRound.id);
  const { data: tee } = await db.from('tee_sets').select('id, name, slope, course_rating').eq('id', newTeeId).single();
  if (tee) {
    currentRound.tee_set_id = tee.id;
    currentRound.tee_sets = tee;
    const teeBtnEl = document.getElementById('scTeeBtn');
    if (teeBtnEl) teeBtnEl.textContent = `Tee: ${tee.name} ✏️`;
    // Individuell netto regnes ut live fra spiller-HCP + ny slope/CR (ok).
    // Scramble: lag-HCP var frosset på gammel tee → utled på nytt via samme
    // WHS-hjelper (én kilde til sannhet), ellers henger lag-netto igjen.
    if (_scrambleGameRow && roundTeams.length) {
      const hcpByPlayer = {};
      roundFlights.flatMap(f => f.flight_players || []).forEach(fp => { hcpByPlayer[fp.player_id] = fp.handicap; });
      const updated = await persistScrambleTeamHandicaps(roundTeams, hcpByPlayer, tee.slope, tee.course_rating, _fullCoursePar);
      updated.forEach(u => { const t = roundTeams.find(x => x.id === u.id); if (t) t.team_handicap = u.team_handicap; });
    }
  }
  closeModal('modalChangeTee');
  renderScoringHole();
}
async function finishRound() {
  const confirmed = await showConfirm('Avslutt runden og se sammendrag?', 'Avslutt');
  if (!confirmed) return;
  const roundId = currentRound.id;
  await db.from('rounds').update({ status: 'completed' }).eq('id', roundId);
  document.getElementById('scoringScreen').style.display = 'none';
  await loadRounds();
  await loadDashboard();
  await showRoundSummary(roundId);
}


// ── ROUND SUMMARY ──
async function showRoundSummary(roundId) {
  if (!roundId) return;
  document.getElementById('summaryTitle').textContent = 'Laster...';
  openModal('modalRoundSummary');
  const { data: round, error } = await db.from('rounds')
    .select('*, courses(name, holes), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name, username))), games(*, game_teams(*))')
    .eq('id', roundId).single();
  if (error || !round) { document.getElementById('summaryTitle').textContent = 'Feil ved lasting'; return; }
  const { data: scores } = await db.from('scores').select('*').eq('round_id', roundId);
  const { data: holes } = await db.from('holes').select('*').eq('course_id', round.course_id).order('hole_number');
  const sc = {};
  const teamScores = {};
  (scores || []).forEach(s => {
    if (s.team_id) {
      if (!teamScores[s.team_id]) teamScores[s.team_id] = {};
      teamScores[s.team_id][s.hole_number] = s.strokes;
    } else if (s.player_id) {
      if (!sc[s.player_id]) sc[s.player_id] = {};
      sc[s.player_id][s.hole_number] = s.strokes;
    }
  });
  const holeRange = round.hole_range || 'all';
  const allDbHoles = holes || [];
  const filteredHoles = holeRange === 'front9' ? allDbHoles.filter(h => h.hole_number <= 9)
    : holeRange === 'back9' ? allDbHoles.filter(h => h.hole_number >= 10)
    : allDbHoles;
  const rangeLabel = holeRange === 'front9' ? ' · Første 9' : holeRange === 'back9' ? ' · Siste 9' : '';
  document.getElementById('summaryTitle').textContent = `${round.courses?.name} · ${round.date}${rangeLabel}`;
  const allFP = (round.flights || []).flatMap(f => f.flight_players || []);
  const totalHoles = filteredHoles.length || 18;
  const fullCoursePar = allDbHoles.reduce((s,h) => s + (h.par||0), 0) || 72;
  // Scramble: lag-oppsummering i stedet for per-spiller-faner (ingen individuelle scores).
  const scrambleRow = scrambleGame(round);
  const scrambleSummaryEl = document.getElementById('scrambleSummary');
  if (scrambleSummaryEl) {
    const html = scrambleRow ? getGame('scramble').summaryUI({
      round, holes: filteredHoles, teamScores, teams: scrambleRow.game_teams || [], events: [], fullCoursePar,
    }) : '';
    scrambleSummaryEl.style.display = html ? 'block' : 'none';
    scrambleSummaryEl.innerHTML = html || '';
  }
  if (scrambleRow) {
    document.getElementById('summaryTabs').innerHTML = '';
    document.getElementById('summaryContent').innerHTML = '';
  } else {
    const tabs = allFP.map((fp, i) =>
      `<button class="tab ${i === 0 ? 'active' : ''}" onclick="showSummaryPlayer('${fp.player_id}', this)">${fp.profiles?.display_name?.split(' ')[0]}</button>`
    ).join('');
    document.getElementById('summaryTabs').innerHTML = tabs;
    window._summaryData = { round, holes: filteredHoles, sc, allFP, totalHoles, fullCoursePar };
    window._currentSummaryPlayer = null;
    if (allFP[0]) showSummaryPlayer(allFP[0].player_id);
  }
  // G5: sammenlagt tvers-flight-stilling + totalvinner (individuelt hovedspill).
  const standingsEl = document.getElementById('summaryStandings');
  if (standingsEl) {
    const html = scrambleRow ? '' : _renderSummaryStandings(round, sc, filteredHoles, fullCoursePar);
    standingsEl.style.display = html ? 'block' : 'none';
    standingsEl.innerHTML = html || '';
  }
  // Skins summary — delegeres til skins-modulen i motoren.
  const skinsSummaryEl = document.getElementById('skinsSummary');
  if (skinsSummaryEl) {
    const html = getGame('skins').summaryUI({
      round, holes: filteredHoles, scores: sc,
      flights: round.flights || [], fullCoursePar,
    });
    skinsSummaryEl.style.display = html ? 'block' : 'none';
    skinsSummaryEl.innerHTML = html || '';
  }
}
// Sammenlagt netto-stableford på tvers av ALLE flighter → én rangering +
// totalvinner (§2.7 #7, G5). Uavgjort = delt plassering/delt vinner.
function _renderSummaryStandings(round, sc, holes, fullCoursePar) {
  const slope = round.tee_sets?.slope, cr = round.tee_sets?.course_rating;
  const flightName = {};
  (round.flights || []).forEach(f => (f.flight_players || []).forEach(fp => { flightName[fp.player_id] = f.name; }));
  const allFP = (round.flights || []).flatMap(f => f.flight_players || []);
  let rows = allFP.map(fp => {
    const hcp = _playingHcp(fp.handicap, slope, cr, fullCoursePar);
    let pts = 0, thru = 0;
    (holes || []).forEach(h => {
      const s = sc[fp.player_id]?.[h.hole_number];
      if (s > 0 && h.par && h.stroke_index) { pts += calcStableford(s, h.par, hcp, h.stroke_index, 18); thru++; }
    });
    return { name: fp.profiles?.display_name || '?', flight: flightName[fp.player_id] || '', pts, thru };
  }).filter(r => r.thru > 0);
  if (!rows.length) return '';
  rows.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  let place = 0, prev = null;                    // konkurranse-rangering 1,2,2,4
  rows = rows.map((r, i) => { if (r.pts !== prev) { place = i + 1; prev = r.pts; } return { ...r, place }; });
  const topPts = rows[0].pts;
  const winners = rows.filter(r => r.pts === topPts);
  const multiFlight = (round.flights || []).length > 1;
  const head = winners.length === 1
    ? `🏆 ${winners[0].name}${multiFlight ? ` <span style="color:var(--cream-dim);font-size:12px;">(${winners[0].flight})</span>` : ''} — ${topPts}p`
    : `🏆 Delt: ${winners.map(w => w.name).join(', ')} — ${topPts}p`;
  const rowsHtml = rows.map(r => {
    const win = r.pts === topPts;
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);${win ? 'background:rgba(201,168,76,0.08);' : ''}">
      <td style="padding:7px 10px;color:${win ? 'var(--gold)' : 'var(--cream-dim)'};font-size:13px;width:34px;">${r.place}${win ? ' 🏆' : ''}</td>
      <td style="padding:7px 10px;color:var(--cream);font-size:14px;">${r.name}</td>
      ${multiFlight ? `<td style="padding:7px 10px;color:var(--cream-dim);font-size:11px;">${r.flight}</td>` : ''}
      <td style="padding:7px 10px;text-align:right;color:var(--cream-dim);font-size:11px;">${r.thru} hull</td>
      <td style="padding:7px 10px;text-align:right;font-family:'Playfair Display',serif;font-size:16px;color:${win ? 'var(--gold)' : 'var(--cream)'};">${r.pts}p</td>
    </tr>`;
  }).join('');
  return `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:16px;">
    <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">Sammenlagt${multiFlight ? ' · på tvers av flighter' : ''}</div>
    <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--gold-light);margin-bottom:12px;">${head}</div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><tbody>${rowsHtml}</tbody></table></div>
  </div>`;
}
function showSummaryPlayer(playerId, btn) {
  if (btn) {
    document.querySelectorAll('#summaryTabs .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
  const { round, holes, sc, allFP, totalHoles, fullCoursePar } = window._summaryData || {};
  if (!allFP) return;
  const fp = allFP.find(p => p.player_id === playerId);
  if (!fp) return;
  const playerScores = sc[playerId] || {};
  const hcp = _playingHcp(fp.handicap, round.tee_sets?.slope, round.tee_sets?.course_rating, fullCoursePar || 72);
  let totalStabs = 0, totalStrokes = 0, birdies = 0, pars = 0, bogeys = 0, doubles = 0;
  const parSf = { 3: [], 4: [], 5: [] };
  let bestHole = null, worstHole = null;
  const rows = holes.map(h => {
    const s = playerScores[h.hole_number] || 0;
    const stab = s > 0 ? calcStableford(s, h.par, hcp, h.stroke_index, 18) : 0;
    totalStabs += stab;
    totalStrokes += s;
    if (s > 0) {
      if (parSf[h.par]) parSf[h.par].push({ stab, holeNumber: h.hole_number });
      if (bestHole === null || stab > bestHole.stab) bestHole = { stab, holeNumber: h.hole_number, par: h.par };
      if (worstHole === null || stab < worstHole.stab) worstHole = { stab, holeNumber: h.hole_number, par: h.par };
      const d = s - h.par;
      if (d <= -1) birdies++;
      else if (d === 0) pars++;
      else if (d === 1) bogeys++;
      else doubles++;
    }
    const color = s > 0 ? getScoreColor(s, h.par) : 'var(--cream-dim)';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
      <td style="padding:7px 10px; color:var(--cream-dim); font-size:13px;">${h.hole_number}</td>
      <td style="padding:7px 10px; text-align:center; color:var(--cream-dim); font-size:13px;">${h.par}</td>
      <td style="padding:7px 10px; text-align:center; color:var(--cream-dim); font-size:13px;">${h.stroke_index}</td>
      <td style="padding:7px 10px; text-align:center; font-family:'Playfair Display',serif; font-size:16px; color:${color};">${s || '–'}</td>
      <td style="padding:7px 10px; text-align:center; font-family:'Playfair Display',serif; font-size:16px; color:var(--gold);">${stab || '–'}</td>
    </tr>`;
  }).join('');
  // Par-type averages
  const parCard = (p) => {
    const arr = parSf[p];
    if (!arr.length) return `<div style="flex:1;min-width:60px;background:rgba(0,0,0,0.2);border-radius:8px;padding:10px 6px;text-align:center;"><div style="font-size:10px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Par ${p}</div><div style="font-family:'Playfair Display',serif;font-size:22px;color:var(--cream-dim);">–</div></div>`;
    const avg = (arr.reduce((a, b) => a + b.stab, 0) / arr.length).toFixed(1);
    const best = Math.max(...arr.map(x => x.stab));
    return `<div style="flex:1;min-width:60px;background:rgba(0,0,0,0.2);border-radius:8px;padding:10px 6px;text-align:center;">
      <div style="font-size:10px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Par ${p}</div>
      <div style="font-family:'Playfair Display',serif;font-size:22px;color:var(--gold-light);">${avg}</div>
      <div style="font-size:10px;color:var(--cream-dim);">beste ${best}p</div>
    </div>`;
  };
  const extremes = (bestHole && worstHole && bestHole.holeNumber !== worstHole.holeNumber) ? `
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <div style="flex:1;background:rgba(82,183,136,0.1);border:1px solid rgba(82,183,136,0.25);border-radius:8px;padding:8px 10px;text-align:center;">
        <div style="font-size:9px;color:var(--green-light);text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Beste hull</div>
        <div style="font-size:14px;color:var(--cream);">Hull ${bestHole.holeNumber} <span style="color:var(--cream-dim);font-size:12px;">Par ${bestHole.par}</span></div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--green-light);">${bestHole.stab}p</div>
      </div>
      <div style="flex:1;background:rgba(192,57,43,0.08);border:1px solid rgba(192,57,43,0.2);border-radius:8px;padding:8px 10px;text-align:center;">
        <div style="font-size:9px;color:#e88;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Tøffeste hull</div>
        <div style="font-size:14px;color:var(--cream);">Hull ${worstHole.holeNumber} <span style="color:var(--cream-dim);font-size:12px;">Par ${worstHole.par}</span></div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:#e88;">${worstHole.stab}p</div>
      </div>
    </div>` : '';
  document.getElementById('summaryContent').innerHTML = `
    <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
      <div style="flex:1; min-width:80px; background:rgba(0,0,0,0.2); border-radius:8px; padding:12px; text-align:center;">
        <div style="font-size:10px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1px;">Stableford</div>
        <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold);">${totalStabs}</div>
      </div>
      <div style="flex:1; min-width:80px; background:rgba(0,0,0,0.2); border-radius:8px; padding:12px; text-align:center;">
        <div style="font-size:10px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1px;">Slag</div>
        <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--cream);">${totalStrokes || '–'}</div>
      </div>
      <div style="flex:1; min-width:80px; background:rgba(0,0,0,0.2); border-radius:8px; padding:12px; text-align:center;">
        <div style="font-size:10px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1px;">🐦 Birdies</div>
        <div style="font-family:'Playfair Display',serif; font-size:28px; color:var(--gold-light);">${birdies}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;">${parCard(3)}${parCard(4)}${parCard(5)}</div>
    ${extremes}
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <th style="padding:6px 10px; text-align:left; color:var(--cream-dim); font-size:11px; font-weight:400; text-transform:uppercase; letter-spacing:1px;">Hull</th>
        <th style="padding:6px 10px; text-align:center; color:var(--cream-dim); font-size:11px; font-weight:400; text-transform:uppercase; letter-spacing:1px;">Par</th>
        <th style="padding:6px 10px; text-align:center; color:var(--cream-dim); font-size:11px; font-weight:400; text-transform:uppercase; letter-spacing:1px;">SI</th>
        <th style="padding:6px 10px; text-align:center; color:var(--cream-dim); font-size:11px; font-weight:400; text-transform:uppercase; letter-spacing:1px;">Slag</th>
        <th style="padding:6px 10px; text-align:center; color:var(--cream-dim); font-size:11px; font-weight:400; text-transform:uppercase; letter-spacing:1px;">Poeng</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  window._currentSummaryPlayer = { fp, playerScores, holes, round, totalHoles };
  const activeMode = document.getElementById('golfboxTableBtn')?.classList.contains('active') ? 'table' : 'speak';
  showGolfboxMode(activeMode);
}
function showGolfboxMode(mode) {
  const tableBtn = document.getElementById('golfboxTableBtn');
  const speakBtn = document.getElementById('golfboxSpeakBtn');
  if (tableBtn) tableBtn.classList.toggle('active', mode === 'table');
  if (speakBtn) speakBtn.classList.toggle('active', mode === 'speak');
  const el = document.getElementById('golfboxContent');
  if (!el) return;
  if (!window._currentSummaryPlayer) {
    el.innerHTML = '<p style="color:var(--cream-dim);font-size:14px;">Ingen spillerdata. Velg en spiller over.</p>';
    return;
  }
  const { playerScores, holes } = window._currentSummaryPlayer;
  if (!holes || !holes.length) {
    el.innerHTML = '<p style="color:var(--cream-dim);font-size:14px;">Ingen hull-data registrert for denne banen.</p>';
    return;
  }
  if (mode === 'table') {
    const rows = holes.map(h => {
      const s = playerScores[h.hole_number];
      const scoreColor = s ? getScoreColor(s, h.par) : 'var(--cream-dim)';
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:10px 12px; color:var(--cream-dim); font-size:14px;">Hull ${h.hole_number} <span style="font-size:11px;">(Par ${h.par})</span></td>
        <td style="padding:10px 12px; text-align:right; font-family:'Playfair Display',serif; font-size:22px; color:${scoreColor};">${s || '–'}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `
      <p style="font-size:13px; color:var(--cream-dim); margin-bottom:12px;">Les av og tast inn i Golfbox/Gimmie:</p>
      <table style="width:100%; border-collapse:collapse; background:rgba(0,0,0,0.2); border-radius:8px; overflow:hidden;">${rows}</table>`;
  } else {
    el.innerHTML = `
      <p style="font-size:13px; color:var(--cream-dim); margin-bottom:12px;">Trykk på hullet for å lese opp:</p>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        ${holes.map(h => {
          const s = playerScores[h.hole_number];
          return `<button onclick="speakHole(${h.hole_number}, ${s||0}, ${h.par})" style="padding:10px 14px; background:rgba(0,0,0,0.2); border:1px solid ${s ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.1)'}; border-radius:8px; color:${s ? 'var(--gold-light)' : 'var(--cream-dim)'}; cursor:pointer; font-family:'DM Sans',sans-serif; font-size:14px;">
            Hull ${h.hole_number}: <strong>${s || '–'}</strong>
          </button>`;
        }).join('')}
      </div>
      <button id="speakAllBtn" onclick="speakAllHoles()" style="width:100%; padding:12px; background:var(--green-mid); border:1px solid rgba(201,168,76,0.3); color:var(--gold-light); border-radius:8px; cursor:pointer; font-family:'DM Sans',sans-serif; font-size:14px; touch-action:manipulation; -webkit-tap-highlight-color:transparent;">
        🔊 Les opp alle hull
      </button>`;
  }
}
let _isSpeaking = false;

function speakHole(hole, strokes, par) {
  if (!strokes) { alert(`Hull ${hole}: ikke registrert`); return; }
  window.speechSynthesis.cancel();
  const msg = new SpeechSynthesisUtterance(`Hull ${hole}, ${strokes} slag, ${getScoreName(strokes, par).replace(/[🏆🦅🐦]/g, '')}`);
  msg.lang = 'no-NO';
  window.speechSynthesis.speak(msg);
}

function speakAllHoles() {
  const btn = document.getElementById('speakAllBtn');
  if (_isSpeaking) {
    _isSpeaking = false;
    window.speechSynthesis.cancel();
    if (btn) { btn.textContent = '🔊 Les opp alle hull'; btn.style.background = 'var(--green-mid)'; }
    return;
  }
  const { playerScores, holes } = window._currentSummaryPlayer;
  const items = holes.map(h => {
    const s = playerScores[h.hole_number];
    return s ? { text: `Hull ${h.hole_number}, ${s} slag`, hole: h.hole_number } : null;
  }).filter(Boolean);
  if (!items.length) return;
  _isSpeaking = true;
  if (btn) { btn.textContent = '⏹ Stopp'; btn.style.background = 'var(--danger)'; }
  window.speechSynthesis.cancel();
  let i = 0;
  function speakNext() {
    if (!_isSpeaking || i >= items.length) {
      _isSpeaking = false;
      if (btn) { btn.textContent = '🔊 Les opp alle hull'; btn.style.background = 'var(--green-mid)'; }
      return;
    }
    const msg = new SpeechSynthesisUtterance(items[i].text);
    msg.lang = 'no-NO';
    msg.rate = 0.9;
    msg.onend = () => {
      i++;
      setTimeout(speakNext, 300); // liten pause mellom hull
    };
    msg.onerror = () => {
      i++;
      setTimeout(speakNext, 300);
    };
    window.speechSynthesis.speak(msg);
  }
  speakNext();
}
