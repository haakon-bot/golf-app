// ── SCORING SCREEN ──
let currentRound = null;
let currentHole = 1;
let roundScores = {};
let roundHoles = [];
let roundFlights = [];
let _fullCoursePar = 72; // full 18-hole par, set when opening a round
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
    .select('*, courses(name, holes), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name, username)))')
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
  roundScores = {};
  (scores || []).forEach(s => {
    if (!roundScores[s.player_id]) roundScores[s.player_id] = {};
    roundScores[s.player_id][s.hole_number] = s.strokes;
  });
  document.getElementById('scCourseName').textContent = round.courses?.name || '';
  document.getElementById('scRoundDate').textContent = round.date;
  const teeBtnEl = document.getElementById('scTeeBtn');
  if (teeBtnEl) teeBtnEl.textContent = round.tee_sets?.name ? `Tee: ${round.tee_sets.name} ✏️` : '';

  const isParticipant = roundFlights.some(f => f.flight_players?.some(fp => fp.player_id === currentProfile?.id));
  const finishBtn = document.getElementById('scFinishBtn');
  const nextBottom = document.getElementById('scNextHoleBottom');
  if (finishBtn) finishBtn.style.display = isParticipant ? 'inline-block' : 'none';
  if (nextBottom) nextBottom.style.display = isParticipant ? 'block' : 'none';

  renderScoringHole();
  document.getElementById('scoringScreen').style.display = 'flex';
  document.getElementById('scoringScreen').style.flexDirection = 'column';
}
function closeScoringScreen() {
  document.getElementById('scoringScreen').style.display = 'none';
  loadRounds();
  loadDashboard();
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
  renderPlayerInputs(holeData);
  renderMiniLeaderboard();
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
    const canEdit = flight.flight_players?.some(fp => fp.player_id === currentProfile?.id);
    html += `<div style="margin-bottom:16px;">
      <div style="font-size:11px; color:var(--cream-dim); letter-spacing:1.5px; text-transform:uppercase; margin-bottom:8px;">${flight.name}</div>`;
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
function _playingHcp(hi, slope, cr, par) { return Math.round((hi || 36) * (slope || 113) / 113 + ((cr || 72) - (par || 72))); }
// Counts extra strokes from fullHCP that land on the given active holes (full 18-hole distribution).
function _activeStrokes(fullHCP, activeHoles) {
  return (activeHoles || []).reduce((sum, hole) => {
    if (!hole.stroke_index) return sum;
    let extra = Math.floor(fullHCP / 18);
    if (hole.stroke_index <= (fullHCP % 18)) extra++;
    return sum + extra;
  }, 0);
}
function calcStableford(strokes, par, hcp, si) {
  if (!strokes || !par || !si) return 0;
  let extra = Math.floor(hcp / 18);
  if (si <= (hcp % 18)) extra++;
  return Math.max(0, par - (strokes - extra) + 2);
}
function calcStablefordWithHoles(strokes, par, hcp, si, totalHoles) {
  if (!strokes || !par || !si) return 0;
  let extra = Math.floor(hcp / totalHoles);
  if (si <= (hcp % totalHoles)) extra++;
  return Math.max(0, par - (strokes - extra) + 2);
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
function toggleSkinsAmount() {
  const wrap = document.getElementById('skinsAmountWrap');
  if (wrap) wrap.style.display = document.getElementById('skinsEnabled').checked ? 'flex' : 'none';
}

function _computeSkins(holes, scores, allFP, round) {
  const slope = round.tee_sets?.slope, cr = round.tee_sets?.course_rating;
  const fcp = _fullCoursePar || 72;
  const hcpMap = {};
  allFP.forEach(fp => { hcpMap[fp.player_id] = _playingHcp(fp.handicap, slope, cr, fcp); });
  let pot = 0;
  const skinsByPlayer = {};
  allFP.forEach(fp => { skinsByPlayer[fp.player_id] = 0; });
  const holeResults = [];
  for (const hole of holes) {
    pot++;
    if (!hole.par || !hole.stroke_index) {
      holeResults.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, pot, noData: true, sfByPlayer: {} });
      continue;
    }
    const sfByPlayer = {};
    let maxSf = -1, anyScore = false;
    for (const fp of allFP) {
      const s = scores[fp.player_id]?.[hole.hole_number];
      if (!s || s <= 0) continue;
      anyScore = true;
      const sf = calcStableford(s, hole.par, hcpMap[fp.player_id], hole.stroke_index);
      sfByPlayer[fp.player_id] = sf;
      if (sf > maxSf) maxSf = sf;
    }
    if (!anyScore) {
      holeResults.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, pot, noScore: true, sfByPlayer: {} });
      continue;
    }
    const winners = allFP.filter(fp => sfByPlayer[fp.player_id] === maxSf && maxSf >= 0);
    if (winners.length === 1) {
      const w = winners[0];
      skinsByPlayer[w.player_id] += pot;
      holeResults.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: w.player_id,
        winnerName: w.profiles?.display_name?.split(' ')[0] || '?', pot, tied: false, sfByPlayer });
      pot = 0;
    } else {
      holeResults.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, pot, tied: true, sfByPlayer });
    }
  }
  return { skinsByPlayer, holeResults, remainingPot: pot };
}

function renderSkinsTracker() {
  const strip = document.getElementById('scSkinsStrip');
  const el = document.getElementById('scSkins');
  if (!strip || !el || !currentRound?.skins_amount) { if (strip) strip.style.display = 'none'; return; }
  strip.style.display = 'block';
  const kr = currentRound.skins_amount;
  const multiFlights = roundFlights.length > 1;
  const parts = [];
  for (const flight of roundFlights) {
    const fp = flight.flight_players || [];
    if (fp.length < 2) continue;
    const { skinsByPlayer, remainingPot } = _computeSkins(roundHoles, roundScores, fp, currentRound);
    const maxSkins = Math.max(...fp.map(f => skinsByPlayer[f.player_id] || 0));
    const cards = fp.map(p => {
      const n = skinsByPlayer[p.player_id] || 0;
      const isLeader = n > 0 && n === maxSkins;
      return `<div style="flex-shrink:0;text-align:center;padding:7px 12px;border-radius:8px;border:1px solid ${isLeader ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.07)'};background:${isLeader ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};">
        <div style="font-size:10px;color:var(--cream-dim);">${p.profiles?.display_name?.split(' ')[0] || '?'}</div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:${isLeader ? 'var(--gold)' : 'var(--cream)'};">${n}</div>
        <div style="font-size:9px;color:var(--cream-dim);">${n * kr} kr</div>
      </div>`;
    });
    if (remainingPot > 1) cards.push(`<div style="flex-shrink:0;text-align:center;padding:7px 12px;border-radius:8px;border:1px solid rgba(82,183,136,0.3);background:rgba(82,183,136,0.1);">
      <div style="font-size:10px;color:var(--green-light);">Pott</div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--green-light);">×${remainingPot}</div>
      <div style="font-size:9px;color:var(--cream-dim);">${remainingPot * kr} kr</div>
    </div>`);
    if (multiFlights) {
      parts.push(`<div style="flex-shrink:0;">
        <div style="font-size:9px;color:var(--cream-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">${flight.name}</div>
        <div style="display:flex;gap:6px;">${cards.join('')}</div>
      </div>`);
    } else {
      parts.push(...cards);
    }
  }
  el.innerHTML = parts.join('');
}

function showLeaderboard() {
  const allFP = roundFlights.flatMap(f => f.flight_players || []);
  const standings = allFP.map(fp => {
    let stableford = 0, strokes = 0, holes = 0, eagles = 0, birdies = 0, pars = 0, bogeys = 0;
    Object.entries(roundScores[fp.player_id] || {}).forEach(([h, s]) => {
      if (s > 0) {
        const hd = roundHoles.find(hh => hh.hole_number === parseInt(h)) || { par: null, stroke_index: null };
        if (hd.par && hd.stroke_index) {
          stableford += calcStableford(s, hd.par, _playingHcp(fp.handicap, currentRound?.tee_sets?.slope, currentRound?.tee_sets?.course_rating, _fullCoursePar), hd.stroke_index);
          const d = s - hd.par;
          if (d <= -2) eagles++;
          else if (d === -1) birdies++;
          else if (d === 0) pars++;
          else if (d === 1) bogeys++;
        }
        strokes += s;
        holes++;
      }
    });
    return { name: fp.profiles?.display_name || '?', stableford, strokes, holes, eagles, birdies, pars, bogeys };
  }).sort((a, b) => b.stableford - a.stableford);
  document.getElementById('leaderboardContent').innerHTML = standings.map((p, i) => `
    <div style="display:flex; align-items:center; gap:14px; padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.07);">
      <div style="font-family:'Playfair Display',serif; font-size:24px; color:${i === 0 ? 'var(--gold)' : 'var(--cream-dim)'}; width:32px; text-align:center;">${i + 1}</div>
      <div style="flex:1;">
        <div style="font-size:15px; color:var(--cream); font-weight:500;">${p.name}</div>
        <div style="font-size:12px; color:var(--cream-dim); margin-top:2px;">${p.holes} hull${p.eagles ? ` · 🦅${p.eagles}` : ''} · 🐦${p.birdies} · par${p.pars} · bog${p.bogeys}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-family:'Playfair Display',serif; font-size:24px; color:var(--gold);">${p.stableford}p</div>
        <div style="font-size:12px; color:var(--cream-dim);">${p.strokes || '–'} slag</div>
      </div>
    </div>
  `).join('');
  openModal('modalLeaderboard');
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
  await db.from('rounds').update({ tee_set_id: newTeeId }).eq('id', currentRound.id);
  const { data: tee } = await db.from('tee_sets').select('id, name, slope, course_rating').eq('id', newTeeId).single();
  if (tee) {
    currentRound.tee_set_id = tee.id;
    currentRound.tee_sets = tee;
    const teeBtnEl = document.getElementById('scTeeBtn');
    if (teeBtnEl) teeBtnEl.textContent = `Tee: ${tee.name} ✏️`;
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
    .select('*, courses(name, holes), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name, username)))')
    .eq('id', roundId).single();
  if (error || !round) { document.getElementById('summaryTitle').textContent = 'Feil ved lasting'; return; }
  const { data: scores } = await db.from('scores').select('*').eq('round_id', roundId);
  const { data: holes } = await db.from('holes').select('*').eq('course_id', round.course_id).order('hole_number');
  const sc = {};
  (scores || []).forEach(s => {
    if (!sc[s.player_id]) sc[s.player_id] = {};
    sc[s.player_id][s.hole_number] = s.strokes;
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
  const tabs = allFP.map((fp, i) =>
    `<button class="tab ${i === 0 ? 'active' : ''}" onclick="showSummaryPlayer('${fp.player_id}', this)">${fp.profiles?.display_name?.split(' ')[0]}</button>`
  ).join('');
  document.getElementById('summaryTabs').innerHTML = tabs;
  window._summaryData = { round, holes: filteredHoles, sc, allFP, totalHoles, fullCoursePar };
  window._currentSummaryPlayer = null;
  if (allFP[0]) showSummaryPlayer(allFP[0].player_id);
  // Skins summary
  const skinsSummaryEl = document.getElementById('skinsSummary');
  if (skinsSummaryEl) {
    if (round.skins_amount && allFP.length > 1) {
      skinsSummaryEl.style.display = 'block';
      _renderSkinsSummary(round, filteredHoles, sc, round.flights || [], fullCoursePar);
    } else {
      skinsSummaryEl.style.display = 'none';
    }
  }
}

function _renderSkinsSummary(round, holes, sc, flights, fullCoursePar) {
  const el = document.getElementById('skinsSummary');
  if (!el) return;
  const savedFcp = _fullCoursePar;
  _fullCoursePar = fullCoursePar;
  const kr = round.skins_amount;
  const multiFlights = flights.length > 1;
  const sections = flights.map(flight => {
    const allFP = flight.flight_players || [];
    if (allFP.length < 2) return '';
    const { skinsByPlayer, holeResults, remainingPot } = _computeSkins(holes, sc, allFP, round);
    const holeRows = holeResults.filter(r => !r.noData).map(r => {
      const sfCells = allFP.map(fp => {
        const sf = r.sfByPlayer?.[fp.player_id];
        const isWinner = r.winnerId === fp.player_id;
        return `<td style="padding:5px 8px;text-align:center;font-family:'Playfair Display',serif;font-size:14px;color:${isWinner ? 'var(--gold)' : sf != null ? 'var(--cream)' : 'var(--cream-dim)'};">${sf != null ? sf + 'p' : '–'}</td>`;
      }).join('');
      const winnerCell = r.noScore ? '<td style="padding:5px 8px;text-align:center;font-size:11px;color:var(--cream-dim);">–</td>'
        : r.tied ? `<td style="padding:5px 8px;text-align:center;font-size:11px;color:var(--green-light);">↩ Rull</td>`
        : `<td style="padding:5px 8px;text-align:center;font-size:12px;color:var(--gold);font-weight:600;">${r.winnerName} ×${r.pot}</td>`;
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:5px 8px;color:var(--cream-dim);font-size:12px;">${r.holeNumber}</td>
        <td style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:12px;">${r.par}</td>
        ${sfCells}${winnerCell}
      </tr>`;
    }).join('');
    const headerCells = allFP.map(fp => `<th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">${fp.profiles?.display_name?.split(' ')[0] || '?'}</th>`).join('');
    const totals = allFP.map(fp => {
      const n = skinsByPlayer[fp.player_id] || 0;
      return { name: fp.profiles?.display_name?.split(' ')[0] || '?', skins: n, kr: n * kr };
    }).sort((a, b) => b.skins - a.skins);
    const flightHeader = multiFlights ? `<div style="font-size:11px;color:var(--cream-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;">${flight.name}</div>` : '';
    return `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:16px;${multiFlights ? 'margin-bottom:12px;' : ''}">
      ${flightHeader}
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">🎰 Skins · ${kr} kr per skin</div>
      <div style="overflow-x:auto;margin-bottom:14px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
            <th style="padding:5px 8px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Hull</th>
            <th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Par</th>
            ${headerCells}
            <th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Vinner</th>
          </tr></thead>
          <tbody>${holeRows}</tbody>
        </table>
      </div>
      ${remainingPot > 0 ? `<div style="font-size:12px;color:var(--green-light);margin-bottom:12px;">⚠️ ${remainingPot} skin(s) uten vinner (siste hull uavgjort)</div>` : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${totals.map((t, i) => `<div style="flex:1;min-width:80px;text-align:center;padding:10px;background:${i === 0 && t.skins > 0 ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};border-radius:8px;border:1px solid ${i === 0 && t.skins > 0 ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.07)'};">
          <div style="font-size:11px;color:var(--cream-dim);">${t.name}</div>
          <div style="font-family:'Playfair Display',serif;font-size:22px;color:${i === 0 && t.skins > 0 ? 'var(--gold)' : 'var(--cream)'};">${t.skins}</div>
          <div style="font-size:12px;color:${t.kr > 0 ? 'var(--green-light)' : 'var(--cream-dim)'};">${t.kr} kr</div>
        </div>`).join('')}
      </div>
    </div>`;
  }).filter(Boolean);
  _fullCoursePar = savedFcp;
  el.innerHTML = sections.join('');
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
    const stab = s > 0 ? calcStablefordStatic(s, h.par, hcp, h.stroke_index, 18) : 0;
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
function calcStablefordStatic(strokes, par, hcp, si, totalHoles) {
  if (!strokes || !par) return 0;
  let extra = Math.floor(hcp / totalHoles);
  if (si <= (hcp % totalHoles)) extra++;
  return Math.max(0, par - (strokes - extra) + 2);
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
