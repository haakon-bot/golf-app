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
let roundEvents = [];       // game_events (drive_used …) for utslags-logging (E)
// ── LAGRINGSKØ (scores + game_events) ──
// Hvert trykk oppdaterer skjermen med en gang og legges i en kø i localStorage.
// Køen sendes til Supabase i bakgrunnen, og en endring fjernes først når
// serveren har bekreftet den. Køen overlever skjermlås/app-lukking og sendes
// før runden lastes på nytt (_resumeScoring/openRound). Hullnavigasjon og
// «Avslutt runde» venter til køen er tom (flushScoreQueue).
const _SQ_KEY = 'fore_pending_writes';
const _SQ_STALE_MS = 10000;   // eldre endringer sjekkes mot serveren (en annen kan ha rettet)
let _sqFlushing = null;       // pågående flush-promise
let _sqTimer = null;
let _sqRetryMs = 0;
let _sqState = 'idle';        // idle | saving | error
function _sqLoad() {
  try { return JSON.parse(localStorage.getItem(_SQ_KEY) || '[]'); } catch (e) { return []; }
}
function _sqSave(q) {
  try { localStorage.setItem(_SQ_KEY, JSON.stringify(q)); } catch (e) {}
}
function _sqUuid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
// Score-endring: siste verdi per (runde, spiller/lag, hull) vinner — raske trykk slås sammen.
// strokes 0 = slett scoren.
function enqueueScore(roundId, owner, hole, strokes) {
  const key = `s|${roundId}|${owner.player_id ? 'p:' + owner.player_id : 't:' + owner.team_id}|${hole}`;
  const q = _sqLoad().filter(op => op.key !== key);
  q.push({ key, kind: 'score', round_id: roundId, player_id: owner.player_id || null, team_id: owner.team_id || null,
    hole_number: hole, strokes, ts: new Date().toISOString() });
  _sqSave(q);
  _sqSchedule(250);
}
// game_events: klient-generert id gjør innsettingen idempotent ved ny sending.
function enqueueEvent(row) {
  const full = { id: _sqUuid(), ...row };
  const q = _sqLoad();
  q.push({ key: 'e|' + full.id, kind: 'event', round_id: row.round_id, row: full, ts: new Date().toISOString() });
  _sqSave(q);
  _sqSchedule(0);
  return full;
}
function hasPendingWrites(roundId) {
  return _sqLoad().some(op => !roundId || op.round_id === roundId);
}
function _sqSchedule(ms) {
  clearTimeout(_sqTimer);
  _sqTimer = setTimeout(() => { flushScoreQueue(); }, ms);
}
function _sqSetState(state) {
  _sqState = state;
  const el = document.getElementById('scSaveStatus');
  if (!el) return;
  const pending = hasPendingWrites(currentRound?.id);
  if (state === 'error' && pending) { el.textContent = '⚠ ikke lagret · prøver igjen'; el.style.color = '#f09595'; el.style.opacity = '1'; }
  else if (pending) { el.textContent = 'lagrer…'; el.style.color = 'var(--cream-dim)'; el.style.opacity = '1'; }
  else { el.textContent = '✓ lagret'; el.style.color = 'var(--green-light)'; el.style.opacity = '0.7'; }
}
// Feil som aldri går over ved ny sending (integritet/tilgang). Nettverksfeil har ingen slik kode.
function _sqIsPermanent(err) {
  const c = String(err?.code || '');
  return c.startsWith('23') || c.startsWith('42');
}
async function _sqSendOne(op) {
  if (op.kind === 'event') {
    const { error } = await db.from('game_events').insert(op.row);
    if (error && error.code !== '23505') throw error;   // 23505 = allerede lagret (tidligere sending nådde fram)
    return;
  }
  const ownerCol = op.player_id ? 'player_id' : 'team_id';
  const ownerId = op.player_id || op.team_id;
  // Gammel endring (f.eks. telefonen var låst): har noen andre lagret noe nyere, forkastes vår.
  if (Date.now() - new Date(op.ts).getTime() > _SQ_STALE_MS) {
    const { data, error } = await db.from('scores').select('updated_at')
      .eq('round_id', op.round_id).eq(ownerCol, ownerId).eq('hole_number', op.hole_number).maybeSingle();
    if (error) throw error;
    if (data?.updated_at && new Date(data.updated_at) > new Date(op.ts)) return;
  }
  if (!op.strokes) {
    const { error } = await db.from('scores').delete()
      .eq('round_id', op.round_id).eq(ownerCol, ownerId).eq('hole_number', op.hole_number);
    if (error) throw error;
  } else {
    const { error } = await db.from('scores').upsert({
      round_id: op.round_id, [ownerCol]: ownerId, hole_number: op.hole_number,
      strokes: op.strokes, updated_at: op.ts
    }, { onConflict: `round_id,${ownerCol},hole_number` });
    if (error) throw error;
  }
}
// Sender hele køen i rekkefølge. Returnerer true når køen er tom.
function flushScoreQueue() {
  if (_sqFlushing) return _sqFlushing;
  clearTimeout(_sqTimer);
  _sqFlushing = (async () => {
    try {
      let q = _sqLoad();
      if (!q.length) { _sqSetState('idle'); return true; }
      _sqSetState('saving');
      while (q.length) {
        const op = q[0];
        try {
          await _sqSendOne(op);
        } catch (err) {
          if (!_sqIsPermanent(err)) throw err;
          // Blokker ikke resten av køen for alltid — men si ifra, aldri stille tap.
          console.error('Endring avvist av serveren', op, err);
          alert(`En endring (hull ${op.hole_number || op.row?.hole_number}) ble avvist av serveren og kunne ikke lagres: ${err.message || err.code}`);
        }
        // Fjern bare hvis ikke erstattet av et nyere trykk mens vi sendte
        _sqSave(_sqLoad().filter(o => !(o.key === op.key && o.ts === op.ts)));
        q = _sqLoad();
      }
      _sqRetryMs = 0;
      _sqSetState('idle');
      return true;
    } catch (e) {
      console.warn('Lagring feilet, prøver igjen', e);
      _sqRetryMs = Math.min(_sqRetryMs ? _sqRetryMs * 2 : 2000, 10000);
      _sqSetState('error');
      _sqSchedule(_sqRetryMs);
      return false;
    } finally {
      _sqFlushing = null;
      // Trykk som kom mens siste sending avsluttet, skal også sendes
      if (_sqState !== 'error' && hasPendingWrites()) _sqSchedule(0);
    }
  })();
  return _sqFlushing;
}
// Venter til køen er tom (maks timeoutMs). true = alt lagret.
async function waitForSaved(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (hasPendingWrites()) {
    const ok = await Promise.race([flushScoreQueue(), new Promise(r => setTimeout(() => r(false), Math.max(0, deadline - Date.now())))]);
    if (ok && !hasPendingWrites()) return true;
    if (Date.now() >= deadline) return !hasPendingWrites();
    await new Promise(r => setTimeout(r, 500));
  }
  return true;
}
// Legg ventende (ikke-bekreftede) endringer oppå data hentet fra serveren,
// så skjermen viser det brukeren faktisk tastet.
function _applyPendingOverlay(roundId) {
  _sqLoad().filter(op => op.round_id === roundId).forEach(op => {
    if (op.kind === 'score') {
      const map = op.player_id ? roundScores : roundTeamScores;
      const id = op.player_id || op.team_id;
      if (!map[id]) map[id] = {};
      map[id][op.hole_number] = op.strokes || 0;
    } else if (op.kind === 'event' && !roundEvents.some(e => e.id === op.row.id)) {
      roundEvents.push({ ...op.row, created_at: op.ts });
    }
  });
}
window.addEventListener('online', () => _sqSchedule(0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && hasPendingWrites()) flushScoreQueue();
});

// Kun admin: flytter runden til papirkurven (ingenting slettes). Gjenopprett
// eller slett permanent fra papirkurven (rounds.js). Håndheves også i databasen
// (migrations/2026-09-rounds-trash.sql).
async function deleteRound(roundId) {
  if (!currentProfile?.is_admin) return;
  const confirmed = await showConfirm('Flytte runden til papirkurven? Den forsvinner fra lister, statistikk og turnering, men kan gjenopprettes fra papirkurven.', 'Flytt');
  if (!confirmed) return;
  const { error } = await db.rpc('trash_round', { rid: roundId });
  if (error) { alert('Kunne ikke flytte runden til papirkurven:\n\n' + error.message); return; }
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
  const { data: events } = await db.from('game_events').select('*').eq('round_id', roundId);
  roundEvents = events || [];
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
  _applyPendingOverlay(roundId);
  if (hasPendingWrites()) flushScoreQueue();
  document.getElementById('scCourseName').textContent = round.courses?.name || '';
  document.getElementById('scRoundDate').textContent = round.date;
  const teeBtnEl = document.getElementById('scTeeBtn');
  if (teeBtnEl) teeBtnEl.textContent = round.tee_sets?.name ? `· ${round.tee_sets.name} tee` : '';

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
  if (finishBtn) finishBtn.style.display = isParticipant ? 'block' : 'none';
  if (nextBottom) nextBottom.style.display = isParticipant ? 'block' : 'none';
  // ⚙ Oppsett kun for deltakere i en aktiv runde (§2.6 rediger oppsett)
  const editBtn = document.getElementById('scEditBtn');
  if (editBtn) editBtn.style.display = (isParticipant && round.status === 'active') ? 'block' : 'none';

  renderScoringHole();
  document.getElementById('scoringScreen').style.display = 'flex';
  document.getElementById('scoringScreen').style.flexDirection = 'column';
}
async function closeScoringScreen() {
  if (hasPendingWrites() && !(await waitForSaved(5000))) {
    const ok = await showConfirm('Noen scorer er ikke lagret ennå (dårlig dekning?). De ligger på telefonen og sendes automatisk neste gang appen har nett. Forlate likevel?', 'Forlat');
    if (!ok) return;
  } else if (currentRound?.status === 'active') {
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
  if (nextTop) nextTop.textContent = isLastHole ? '🏁' : '›';
  if (nextBottom) {
    nextBottom.textContent = isLastHole ? '🏁 Avslutt runde' : 'Neste hull →';
    nextBottom.style.background = isLastHole ? 'var(--green-mid)' : 'var(--gold)';
    nextBottom.style.color = isLastHole ? 'var(--gold-light)' : 'var(--green-deep)';
  }
  const guideBtn = document.getElementById('scGuideBtn');
  if (guideBtn) {
    guideBtn.style.opacity = holeData.guide_text ? '1' : '0.5';
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
  renderGameTrackers();
  _sqSetState(_sqState);
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
  const _adminOverride = currentProfile?.is_admin && currentRound?.status === 'completed';
  // Kun egen flight på scoringskjermen — de andre sees i stillingen/ledertavla.
  // Ikke-deltaker (tilskuer) og admin på avsluttet runde ser alle flighter.
  const myFlights = roundFlights.filter(f => f.flight_players?.some(fp => fp.player_id === _myRoundPlayerId));
  const flightsToShow = (_adminOverride || !myFlights.length) ? roundFlights : myFlights;
  const showFlightNames = flightsToShow.length > 1;
  let html = '';
  flightsToShow.forEach(flight => {
    const canEdit = flight.flight_players?.some(fp => fp.player_id === _myRoundPlayerId) || _adminOverride;
    if (showFlightNames) html += `<div style="font-size:10px; color:var(--cream-dim); letter-spacing:1.5px; text-transform:uppercase; margin:8px 0 6px;">${flight.name}${canEdit ? '' : ' · kun visning'}</div>`;
    (flight.flight_players || []).forEach(fp => {
      const player = fp.profiles;
      const strokes = roundScores[fp.player_id]?.[currentHole] || 0;
      const _phcp = _playingHcp(fp.handicap, _rSlope, _rCr, _fullCoursePar);
      const stableford = (holeData.par && holeData.stroke_index) ? calcStableford(strokes, holeData.par, _phcp, holeData.stroke_index) : 0;
      const scoreColor = holeData.par ? getScoreColor(strokes, holeData.par) : 'var(--cream)';
      const scoreName = holeData.par ? getScoreName(strokes, holeData.par) : '';
      let extraStrokes = 0;
      if (holeData.stroke_index) {
        extraStrokes = Math.floor(_phcp / 18);
        if (holeData.stroke_index <= (_phcp % 18)) extraStrokes++;
      }
      const dots = extraStrokes > 0 ? `<span style="color:var(--green-light); letter-spacing:1px;" title="${extraStrokes} slag her">${'•'.repeat(extraStrokes)}</span>` : '';
      const sub = strokes > 0
        ? `<span style="color:${scoreColor}">${scoreName}</span> · ${stableford}p`
        : `HCP ${fp.handicap ?? '–'} · ${_activeStrokes(_phcp, roundHoles)} slag`;
      html += `
      <div class="sc-row">
        <div style="flex:1; min-width:0;">
          <div style="font-size:15px; color:var(--cream); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${player?.display_name || '?'} ${dots}</div>
          <div style="font-size:11px; color:var(--cream-dim); white-space:nowrap;">${sub}</div>
        </div>
        ${canEdit ? `
        <button class="sc-step" onclick="adjustScore('${fp.player_id}', -1)">−</button>
        <div id="score-${fp.player_id}" class="sc-score" style="color:${scoreColor};">${strokes || '–'}</div>
        <button class="sc-step plus" onclick="adjustScore('${fp.player_id}', 1)">+</button>` : `
        <div class="sc-score" style="color:${scoreColor}; margin-right:8px;">${strokes || '–'}</div>`}
      </div>`;
    });
  });
  document.getElementById('scPlayerScores').innerHTML = html;
}

// ── Lag-scoring (scramble) ──────────────────────────────────────────────
// ctx til spillmotoren. events = game_events (drive_used) → §11.3-kvote/straff.
function _scrambleCtx() {
  return { round: currentRound, holes: roundHoles, teamScores: roundTeamScores, teams: roundTeams, events: roundEvents, fullCoursePar: _fullCoursePar };
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
  // Registrer kun eget lag — man trenger ikke se andre lags kort her (de vises
  // på ledertavla). Ikke-deltaker (uten lag) ser alle, kun visning.
  const myTeams = roundTeams.filter(t => (t.member_ids || []).includes(_myRoundPlayerId));
  const _adminOverride = currentProfile?.is_admin && currentRound?.status === 'completed';
  const teamsToShow = _adminOverride ? roundTeams : (myTeams.length ? myTeams : roundTeams);
  teamsToShow.forEach(team => {
    const canEdit = (team.member_ids || []).includes(_myRoundPlayerId) || _adminOverride;
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
    <div class="sc-row" style="flex-direction:column; align-items:stretch;">
     <div style="display:flex; align-items:center; gap:10px;">
      <div style="flex:1; min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <div style="font-size:14px;color:var(--cream);font-weight:500;">${team.name}</div>
          <div style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(201,168,76,0.15);color:var(--gold-dim);white-space:nowrap;">HCP ${team.team_handicap ?? '–'}</div>
          <div style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(82,183,136,0.15);color:var(--green-light);white-space:nowrap;">Tildelte slag her: ${extra}</div>
        </div>
        <div style="font-size:11px;color:var(--cream-dim);">${memberNames} ${strokesLabel} ${strokes > 0 ? `· <span style="color:${scoreColor}">${scoreName}</span> · netto ${net} · ${stableford}p` : ''}</div>
      </div>
      ${canEdit ? `
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="sc-step" onclick="adjustTeamScore('${team.id}', -1)">−</button>
        <div id="teamscore-${team.id}" class="sc-score" style="color:${scoreColor};">${strokes || '–'}</div>
        <button class="sc-step plus" onclick="adjustTeamScore('${team.id}', 1)">+</button>
      </div>` : `
      <div class="sc-score" style="color:${scoreColor}; margin-right:8px;">${strokes || '–'}</div>`}
     </div>
     ${_driveBlock(team, canEdit)}
    </div>`;
  });
  document.getElementById('scPlayerScores').innerHTML = html;
}
// Utslags-logging (E, §2.3/§11.3) — vises kun når «tellende utslag» > 0.
// Ett tapp per hull: hvem sitt utslag ble brukt. Kvote per spiller + eskalering.
function _driveBlock(team, canEdit) {
  const cfg = _scrambleGameRow?.config || {};
  if (!cfg.countingDrives) return '';
  const gid = _scrambleGameRow.id;
  const latest = latestDriveByHole(roundEvents, { gameId: gid, teamId: team.id });
  const cur = latest[currentHole];
  // Delt kvotelogikk med motoren (§11.3): min/maks/straffemodus i ett.
  const q = _scrambleQuota(cfg, team, roundEvents, Object.keys(latest).length, roundHoles.length || 18);
  const min = q.min;
  const btns = (team.member_ids || []).map(pid => {
    const nm = _memberFirstName(pid);
    const on = cur === pid;
    const base = `padding:7px 12px;border-radius:8px;font-size:13px;border:1px solid ${on ? 'var(--gold)' : 'rgba(255,255,255,0.15)'};background:${on ? 'rgba(201,168,76,0.2)' : 'transparent'};color:${on ? 'var(--gold)' : 'var(--cream-dim)'};`;
    return canEdit
      ? `<button onclick="logDrive('${team.id}','${pid}')" style="${base}cursor:pointer;-webkit-tap-highlight-color:transparent;">${on ? '✓ ' : ''}${nm}</button>`
      : `<span style="${base}">${on ? '✓ ' : ''}${nm}</span>`;
  }).join('');
  const quota = (team.member_ids || []).map(pid => {
    const bp = q.byPlayer[pid] || { used: 0, remaining: min };
    const okMin = bp.remaining === 0;
    const color = okMin ? 'var(--green-light)' : '#e8a070';
    const mark = okMin ? ' ✓' : ' ⚠';
    return `<span style="color:${color};">${_memberFirstName(pid)} ${bp.used}/${min}${mark}</span>`;
  }).join(' · ');
  const modeLabel = q.mode === 'out' ? 'laget havner ute av premie' : q.mode === 'warn' ? 'kun varsling' : 'straffeslag legges til laget';
  let warn = '';
  if (q.impossible) warn = `<div style="font-size:11px;color:#e8a070;margin-top:4px;">⚠ Minstekvoten kan ikke nås — ${q.violations} manglende utslag, ${modeLabel}.</div>`;
  else if (q.holesLeft > 0 && q.remainingSum === q.holesLeft) warn = `<div style="font-size:11px;color:var(--gold-light);margin-top:4px;">⚠ Alle ${q.holesLeft} gjenværende hull må brukes for å nå minstekvoten.</div>`;
  return `<div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.06);">
    <div style="font-size:10px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Hvem sitt utslag? · hull ${currentHole}</div>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">${btns}</div>
    <div style="font-size:11px; color:var(--cream-dim);">Kvote (${min}/spiller): ${quota}</div>${warn}
  </div>`;
}
async function logDrive(teamId, playerId) {
  if (!_scrambleGameRow) return;
  const row = enqueueEvent({ game_id: _scrambleGameRow.id, round_id: currentRound.id, hole_number: currentHole, team_id: teamId, player_id: playerId, event_type: 'drive_used', payload: {} });
  roundEvents.push({ ...row, created_at: new Date().toISOString() });   // umiddelbar UI-oppdatering
  const holeData = roundHoles.find(h => h.hole_number === currentHole) || { par: null, stroke_index: null };
  renderTeamInputs(holeData);
  renderScrambleTracker();
}
function adjustTeamScore(teamId, delta) {
  if (!roundTeamScores[teamId]) roundTeamScores[teamId] = {};
  const current = roundTeamScores[teamId][currentHole] || 0;
  // − fra 1 (eller tomt) = slett scoren
  const newVal = (delta === -1 && current <= 1) ? 0 : Math.max(1, Math.min(current + delta, 15));
  roundTeamScores[teamId][currentHole] = newVal;
  enqueueScore(currentRound.id, { team_id: teamId }, currentHole, newVal);
  const holeData = roundHoles.find(h => h.hole_number === currentHole) || { par: null, stroke_index: null };
  renderTeamInputs(holeData);
  renderMiniLeaderboard();
  renderScrambleTracker();
  _sqSetState(_sqState);
}
function renderScrambleTracker() {
  const strip = document.getElementById('scScrambleStrip');
  const el = document.getElementById('scScramble');
  if (!strip || !el) return;
  // Lag-stillingen vises nå i stilling-chipsene (renderTeamMiniLeaderboard) og
  // egen kvote i utslagsblokken — den gamle stripa ville vist det samme to ganger.
  strip.style.display = 'none'; el.innerHTML = '';
}
function renderTeamMiniLeaderboard() {
  const el = document.getElementById('scMiniLeader');
  if (!el) return;
  const data = getGame('scramble').compute(_scrambleCtx());
  if (!data || !data.teams.length) { el.innerHTML = ''; return; }
  const scoring = data.scoring;
  const scoreLbl = scoring === 'stableford' ? 'Poeng' : scoring === 'slag' ? 'Slag' : 'Netto';
  const cols = 'grid-template-columns:34px 1fr 40px 56px;';
  const isMe = r => (r.team.member_ids || []).includes(_myRoundPlayerId);
  const rows = _miniRows(data.teams, isMe);
  el.innerHTML = `<div class="sc-mini">
    <div class="lb-head" style="${cols}"><div class="lb-num">Pos</div><div>Lag</div><div class="lb-num">Thru</div><div class="lb-num">${scoreLbl}</div></div>
    ${rows.map(r => {
      const i = data.teams.indexOf(r);
      const vsPar = r.totalGross ? r.totalNet - r.totalPar : null;
      const main = scoring === 'stableford' ? `${r.totalSf}` : scoring === 'slag' ? `${r.totalGross || '–'}` : _fmtVsPar(vsPar);
      const mainColor = scoring === 'netto' ? _vsParColor(vsPar) : (i === 0 ? 'var(--gold)' : 'var(--cream)');
      const flag = r.out ? ' <span style="color:#f09595;">⚠ ute</span>' : r.penalty ? ` <span style="font-size:10px;color:#e8a070;">+${r.penalty} straff</span>` : '';
      const thru = r.thru === 0 ? '–' : r.thru >= roundHoles.length ? 'F' : r.thru;
      return `<div class="lb-row${isMe(r) ? ' me' : ''}" style="${cols}">
        <div class="lb-num" style="color:${i === 0 ? 'var(--gold)' : 'var(--cream-dim)'};">${i + 1}</div>
        <div style="color:var(--cream); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.team.name}${flag}</div>
        <div class="lb-num" style="color:var(--cream-dim);">${thru}</div>
        <div class="lb-num" style="font-weight:700; color:${mainColor};">${main}</div>
      </div>`;
    }).join('')}
    ${_miniFoot(rows.length, data.teams.length)}
  </div>`;
}
// _playingHcp og calcStableford bor nå i games-core.js (spillmotoren, delte helpers).
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
function adjustScore(playerId, delta) {
  if (!roundScores[playerId]) roundScores[playerId] = {};
  const current = roundScores[playerId][currentHole] || 0;
  // − fra 1 (eller tomt) = slett scoren
  const newVal = (delta === -1 && current <= 1) ? 0 : Math.max(1, Math.min(current + delta, 15));
  roundScores[playerId][currentHole] = newVal;
  enqueueScore(currentRound.id, { player_id: playerId }, currentHole, newVal);
  const holeData = roundHoles.find(h => h.hole_number === currentHole) || { par: null, stroke_index: null };
  renderPlayerInputs(holeData);
  renderMiniLeaderboard();
  _sqSetState(_sqState);
}
function toggleScoringMenu() {
  const m = document.getElementById('scMenu');
  if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', e => {
  const m = document.getElementById('scMenu');
  if (m && m.style.display !== 'none' && !m.contains(e.target) && !e.target.closest('[onclick="toggleScoringMenu()"]')) m.style.display = 'none';
});
function openHoleGuide() {
  const holeData = roundHoles.find(h => h.hole_number === currentHole);
  document.getElementById('hgHoleNum').textContent = currentHole;
  document.getElementById('hgText').textContent = holeData?.guide_text || 'Ingen baneguide er generert for dette hullet ennå.';
  openModal('modalHoleGuide');
}
// Sperre: ikke bytt hull / avslutt før alt som vises er bekreftet lagret.
let _sqGateBusy = false;
// allowSkip: brukeren kan velge å gå videre (endringen ligger trygt i køen).
// «Avslutt runde» krever at alt er lagret.
async function _ensureSaved(allowSkip = true) {
  if (!hasPendingWrites()) return true;
  if (_sqGateBusy) return false;
  _sqGateBusy = true;
  const btns = ['scNextHole', 'scNextHoleBottom', 'scPrevHole'].map(id => document.getElementById(id)).filter(Boolean);
  const labels = btns.map(b => b.textContent);
  btns.forEach(b => { if (b.id === 'scNextHoleBottom') b.textContent = 'Lagrer…'; b.style.opacity = '0.6'; });
  try {
    while (true) {
      if (await waitForSaved(8000)) return true;
      if (allowSkip) {
        const skip = await showConfirm('Scoren er ikke lagret ennå, trolig dårlig dekning. Den ligger trygt på telefonen og sendes automatisk når nettet er tilbake. Gå videre likevel?', 'Gå videre');
        return skip;
      }
      const retry = await showConfirm('Kan ikke avslutte runden før alle scorer er lagret (dårlig dekning?). Prøve igjen?', 'Prøv igjen');
      if (!retry) return false;
    }
  } finally {
    btns.forEach((b, i) => { b.textContent = labels[i]; b.style.opacity = ''; });
    _sqGateBusy = false;
    renderScoringHole();
  }
}
async function changeHole(delta) {
  if (!(await _ensureSaved())) return;
  const firstHole = roundHoles.length > 0 ? Math.min(...roundHoles.map(h => h.hole_number)) : 1;
  const lastHole = roundHoles.length > 0 ? Math.max(...roundHoles.map(h => h.hole_number)) : (currentRound?.courses?.holes || 18);
  const newHole = currentHole + delta;
  if (newHole < firstHole) return;
  if (newHole > lastHole) { finishRound(); return; }
  currentHole = newHole;
  renderScoringHole();
  document.getElementById('scoringScreen').scrollTo(0, 0);
}
// Mini-ledertavle: alle ved ≤8 spillere, ellers topp 5 + egen rad.
function _miniRows(list, isMe) {
  if (list.length <= 8) return list;
  const top = list.slice(0, 5);
  const me = list.find(isMe);
  return me && !top.includes(me) ? [...top, me] : top;
}
function _miniFoot(shown, total) {
  return `<div class="sc-mini-foot"><span style="color:var(--cream-dim);">${shown < total ? `Viser ${shown} av ${total}` : ''}</span><span>Hele ledertavla ›</span></div>`;
}
function renderMiniLeaderboard() {
  if (_scrambleGameRow) return renderTeamMiniLeaderboard();
  const el = document.getElementById('scMiniLeader');
  if (!el) return;
  const standings = _individualStandings();
  const isMe = p => p.fp.player_id === _myRoundPlayerId;
  const rows = _miniRows(standings, isMe);
  el.innerHTML = `<div class="sc-mini">
    <div class="lb-head"><div class="lb-num">Pos</div><div>Spiller</div><div class="lb-num">Netto</div><div class="lb-num">Thru</div><div class="lb-num">Poeng</div></div>
    ${rows.map(p => `<div class="lb-row${isMe(p) ? ' me' : ''}">
      <div class="lb-num" style="color:${p.pos === 1 ? 'var(--gold)' : 'var(--cream-dim)'};">${p.tied ? 'T' : ''}${p.pos}</div>
      <div style="color:var(--cream); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.fp.profiles?.display_name || '?'}</div>
      <div class="lb-num" style="font-weight:600; color:${_vsParColor(p.nettoVsPar)};">${_fmtVsPar(p.nettoVsPar)}</div>
      <div class="lb-num" style="color:var(--cream-dim);">${p.thru}</div>
      <div class="lb-num" style="font-weight:700; color:var(--gold);">${p.stab}</div>
    </div>`).join('')}
    ${_miniFoot(rows.length, standings.length)}
  </div>`;
}
// toggleSkinsAmount + skins-beregning/-rendring bor nå i game-skins.js (skins-modulen).
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
// Generisk tracker for øvrige spill (quota o.l.). Skins og scramble har egne
// stripe-mekanismer; alt annet med trackerUI rendres her.
const _HANDLED_TRACKERS = ['skins', 'scramble', 'stableford'];
function renderGameTrackers() {
  const strip = document.getElementById('scGamesStrip');
  const el = document.getElementById('scGames');
  if (!strip || !el) return;
  const ctx = { round: currentRound, holes: roundHoles, scores: roundScores, flights: roundFlights, fullCoursePar: _fullCoursePar, events: roundEvents, currentHole };
  const html = (currentRound?.games || [])
    .filter(g => !_HANDLED_TRACKERS.includes(g.game_type))
    .map(g => { const m = getGame(g.game_type); return (m && m.trackerUI) ? m.trackerUI(ctx) : ''; })
    .filter(Boolean).join('');
  strip.style.display = html ? 'block' : 'none';
  el.innerHTML = html || '';
}

function toggleTeamScorecard(teamId) {
  const target = document.getElementById('lbteam-' + teamId);
  if (!target) return;
  const isOpen = target.style.display !== 'none';
  document.querySelectorAll('[id^="lbteam-"]').forEach(e => { e.style.display = 'none'; });
  if (!isOpen) target.style.display = 'block';
}
// Scramble-ledertavle: alle lag med plassering, score, thru, og tellende utslag
// per spiller (så alle ser hvor andre lag ligger og hvem som mangler utslag).
function _renderScrambleLeaderboard() {
  const data = getGame('scramble').compute(_scrambleCtx());
  const el = document.getElementById('leaderboardContent');
  if (!data || !data.teams.length) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--cream-dim);">Ingen lag ennå.</div>'; return; }
  const cfg = _scrambleGameRow.config || {};
  const showDrives = !!cfg.countingDrives;
  const min = cfg.minDrivesPerPlayer || 1;
  const gid = _scrambleGameRow.id;
  const scoring = data.scoring;
  const scoreLbl = scoring === 'stableford' ? 'Poeng' : scoring === 'slag' ? 'Slag' : 'Netto';
  const allHolesCount = roundHoles.length;
  const myTeamIds = roundTeams.filter(t => (t.member_ids || []).includes(_myRoundPlayerId)).map(t => t.id);
  const rows = data.teams.map((r, i) => {
    const vsPar = r.totalGross ? r.totalNet - r.totalPar : null;
    const main = scoring === 'stableford' ? `${r.totalSf}` : scoring === 'slag' ? `${r.totalGross || '–'}` : _fmtVsPar(vsPar);
    const mainColor = scoring === 'netto' ? _vsParColor(vsPar) : (i === 0 ? 'var(--gold)' : 'var(--cream)');
    const members = (r.team.member_ids || []).map(_memberFirstName).join(', ');
    const thru = r.thru === 0 ? '–' : r.thru >= allHolesCount ? 'F' : r.thru;
    let drives = '';
    if (showDrives) {
      const counts = driveCountsByPlayer(roundEvents, { gameId: gid, teamId: r.team.id });
      const per = (r.team.member_ids || []).map(pid => {
        const u = counts[pid] || 0; const ok = u >= min;
        return `<span style="color:${ok ? 'var(--green-light)' : '#e8a070'};">${_memberFirstName(pid)} ${u}/${min}</span>`;
      }).join(' · ');
      const pen = r.penalty ? ` · <span style="color:#e8a070;">+${r.penalty} straff</span>` : '';
      const out = r.out ? ` · <span style="color:#f09595;">⚠ ute av premie</span>` : '';
      drives = `<div style="font-size:10px;color:var(--cream-dim);margin-top:2px;">🏌️ ${per}${pen}${out}</div>`;
    }
    return `<div class="lb-row${myTeamIds.includes(r.team.id) ? ' me' : ''}" style="grid-template-columns:34px 1fr 40px 56px; padding-top:6px; padding-bottom:6px;" onclick="toggleTeamScorecard('${r.team.id}')">
        <div class="lb-num" style="color:${i === 0 ? 'var(--gold)' : 'var(--cream-dim)'}; font-size:13px;">${i + 1}</div>
        <div style="min-width:0;">
          <div style="font-size:15px; color:var(--cream);">${r.team.name} <span style="font-size:10px;color:var(--cream-dim);">HCP ${r.teamHcp ?? '–'}</span></div>
          <div style="font-size:10px; color:var(--cream-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${members}</div>
          ${drives}
        </div>
        <div class="lb-num" style="font-size:13px; color:var(--cream-dim);">${thru}</div>
        <div class="lb-num" style="font-size:16px; font-weight:700; color:${mainColor};">${main}</div>
      </div>
      <div id="lbteam-${r.team.id}" class="pga-card" style="display:none;">${_teamPgaScorecardHtml(r)}</div>`;
  }).join('');
  el.innerHTML = `<div class="lb-head" style="grid-template-columns:34px 1fr 40px 56px;"><div class="lb-num">Pos</div><div>Lag</div><div class="lb-num">Thru</div><div class="lb-num">${scoreLbl}</div></div>${rows}`;
}
// Scorekort i PGA-stil: hull i blokker à 9, sirkel = birdie, dobbel sirkel =
// eagle+, firkant = bogey, dobbel firkant = dobbel bogey+. Prikker = tildelte slag.
// cells: [{ hole, par, extra, gross, pts }] (gross 0 = ikke spilt, pts null = ingen).
function _pgaGridHtml(cells) {
  const shape = (s, par) => {
    if (!s) return '<span style="color:rgba(255,255,255,0.2);">–</span>';
    const d = s - par;
    const cls = d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : '';
    return `<span class="pga-s ${cls}">${s}</span>`;
  };
  const sorted = [...cells].sort((a, b) => a.hole - b.hole);
  const chunks = [];
  for (let i = 0; i < sorted.length; i += 9) chunks.push(sorted.slice(i, i + 9));
  return chunks.map(ch => {
    const par = ch.reduce((t, c) => t + (c.par || 0), 0);
    const played = ch.filter(c => c.gross);
    const sum = played.reduce((t, c) => t + c.gross, 0);
    const pts = ch.reduce((t, c) => t + (c.pts || 0), 0);
    const pad = '<div></div>'.repeat(9 - ch.length);
    return `<div class="pga-grid">
      <div class="lbl hole">Hull</div>${ch.map(c => `<div class="hole">${c.hole}<span class="pga-dots">${'•'.repeat(Math.max(0, c.extra || 0))}</span></div>`).join('')}${pad}<div class="hole sum">${ch[0].hole}-${ch[ch.length - 1].hole}</div>
      <div class="lbl">Par</div>${ch.map(c => `<div style="color:var(--cream-dim);">${c.par || '–'}</div>`).join('')}${pad}<div class="sum" style="color:var(--cream-dim);">${par}</div>
      <div class="lbl">Score</div>${ch.map(c => `<div>${shape(c.gross, c.par)}</div>`).join('')}${pad}<div class="sum">${played.length ? sum : '–'}</div>
      <div class="lbl">Poeng</div>${ch.map(c => `<div class="pts">${c.gross && c.pts != null ? c.pts : ''}</div>`).join('')}${pad}<div class="sum" style="color:var(--gold);">${pts}</div>
    </div>`;
  }).join('');
}
function _pgaFooterHtml({ gross, net, parPlayed, pts, played, penalty }) {
  const bvp = played ? gross - parPlayed : null, nvp = played ? net - parPlayed : null;
  return `<div style="display:flex; justify-content:space-around; font-size:12px; color:var(--cream-dim); margin:2px 0 10px;">
      <div>Brutto <b style="color:var(--cream);">${played ? gross : '–'}</b> <span style="color:${_vsParColor(bvp)};">${_fmtVsPar(bvp)}</span></div>
      <div>Netto <b style="color:var(--cream);">${played ? net : '–'}</b> <span style="color:${_vsParColor(nvp)};">${_fmtVsPar(nvp)}</span></div>
      <div>Poeng <b style="color:var(--gold);">${pts}</b></div>
    </div>${penalty ? `<div style="text-align:center; font-size:11px; color:#e8a070; margin:-4px 0 8px;">Netto inkl. +${penalty} straffeslag (utslagskvote)</div>` : ''}
    <div class="pga-legend"><span><i class="pga-s eagle"></i>Eagle</span><span><i class="pga-s birdie"></i>Birdie</span><span><i class="pga-s bogey"></i>Bogey</span><span><i class="pga-s double"></i>Dobbel+</span><span><b style="color:var(--green-light);">•</b> slag</span></div>`;
}
function _pgaScorecardHtml(scores, holes, phcp) {
  const extraFor = h => { if (!h.stroke_index) return 0; let e = Math.floor(phcp / 18); if (h.stroke_index <= (phcp % 18)) e++; return e; };
  const t = { gross: 0, net: 0, parPlayed: 0, pts: 0, played: 0 };
  const cells = holes.map(h => {
    const gross = scores[h.hole_number] || 0;
    const extra = extraFor(h);
    const pts = (gross && h.par && h.stroke_index) ? calcStableford(gross, h.par, phcp, h.stroke_index) : null;
    if (gross) { t.gross += gross; t.net += gross - extra; t.parPlayed += h.par || 0; t.played++; }
    if (pts != null) t.pts += pts;
    return { hole: h.hole_number, par: h.par, extra, gross, pts };
  });
  return _pgaGridHtml(cells) + _pgaFooterHtml(t);
}
// Lag (scramble): tallene hentes fra motoren (ScrambleGame.compute) så straff o.l. stemmer.
function _teamPgaScorecardHtml(r) {
  const cells = r.holeResults.map(h => ({ hole: h.holeNumber, par: h.par, extra: h.gross ? h.gross - h.net : _teamExtraStrokes(Number(r.teamHcp) || 0, h.si), gross: h.gross || 0, pts: h.gross ? h.sf : null }));
  return _pgaGridHtml(cells) + _pgaFooterHtml({ gross: r.totalGross, net: r.totalNet, parPlayed: r.totalPar, pts: r.totalSf, played: r.thru, penalty: r.penalty });
}
// Felles stilling for ledertavla og mini-tavla på scoringskjermen.
function _individualStandings() {
  const allFP = roundFlights.flatMap(f => f.flight_players || []);
  const standings = allFP.map(fp => {
    const phcp = _playingHcp(fp.handicap, currentRound?.tee_sets?.slope, currentRound?.tee_sets?.course_rating, _fullCoursePar);
    let netto = 0, parThru = 0, stab = 0, holesPlayed = 0;
    Object.entries(roundScores[fp.player_id] || {}).forEach(([h, s]) => {
      if (s > 0) {
        const hd = roundHoles.find(hh => hh.hole_number === parseInt(h));
        if (hd?.par && hd?.stroke_index) {
          let extra = Math.floor(phcp / 18);
          if (hd.stroke_index <= (phcp % 18)) extra++;
          netto += s - extra; parThru += hd.par;
          stab += calcStableford(s, hd.par, phcp, hd.stroke_index);
          holesPlayed++;
        }
      }
    });
    return { fp, phcp, stab, holesPlayed, nettoVsPar: holesPlayed ? netto - parThru : null };
  }).sort((a, b) => b.stab - a.stab || (a.nettoVsPar ?? 99) - (b.nettoVsPar ?? 99));
  standings.forEach(p => {
    p.pos = standings.findIndex(o => o.stab === p.stab) + 1;
    p.tied = standings.filter(o => o.stab === p.stab).length > 1;
    p.thru = p.holesPlayed === 0 ? '–' : p.holesPlayed >= roundHoles.length ? 'F' : p.holesPlayed;
  });
  return standings;
}
function showLeaderboard() {
  // Snitt per partype bygger på individuelle scorer — gir ikke mening i scramble
  const _psw = document.getElementById('scParStatsWrap');
  if (_psw) _psw.style.display = _scrambleGameRow ? 'none' : '';
  if (_scrambleGameRow) { _renderScrambleLeaderboard(); openModal('modalLeaderboard'); return; }
  const standings = _individualStandings();
  const rows = standings.map(p => {
    const { tied, pos, thru } = p;
    const isMe = p.fp.player_id === _myRoundPlayerId;
    return `<div class="lb-row${isMe ? ' me' : ''}" onclick="toggleLeaderboardScorecard('${p.fp.player_id}')">
        <div class="lb-num" style="color:${pos === 1 ? 'var(--gold)' : 'var(--cream-dim)'}; font-size:13px;">${tied ? 'T' : ''}${pos}</div>
        <div style="min-width:0;">
          <div style="font-size:15px; color:var(--cream); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.fp.profiles?.display_name || '?'}</div>
          <div style="font-size:10px; color:var(--cream-dim);">HCP ${p.fp.handicap ?? '–'} · ${p.phcp} slag</div>
        </div>
        <div class="lb-num" style="font-size:14px; font-weight:600; color:${_vsParColor(p.nettoVsPar)};">${_fmtVsPar(p.nettoVsPar)}</div>
        <div class="lb-num" style="font-size:13px; color:var(--cream-dim);">${thru}</div>
        <div class="lb-num" style="font-size:16px; font-weight:700; color:var(--gold);">${p.stab}</div>
      </div>
      <div id="lbsc-${p.fp.player_id}" class="pga-card" style="display:none;">${_pgaScorecardHtml(roundScores[p.fp.player_id] || {}, roundHoles, p.phcp)}</div>`;
  }).join('');
  document.getElementById('leaderboardContent').innerHTML =
    `<div class="lb-head"><div class="lb-num">Pos</div><div>Spiller</div><div class="lb-num">Netto</div><div class="lb-num">Thru</div><div class="lb-num">Poeng</div></div>${rows}`;
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
  document.getElementById('scorecardModalContent').innerHTML = `<div class="pga-card" style="border-radius:10px;">${_pgaScorecardHtml(scores, holes, phcp)}</div>`;
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
// Hvem mangler score på ett eller flere aktive hull — på tvers av ALLE
// flighter, ikke bare den man selv sitter i (§ finishRound-advarsel, sept
// 2026). Avslutt runde lukker runden for ALLE flighter samtidig (ingen
// «siste flight»-sjekk finnes i dag), så advarselen må dekke alle sammen.
function _incompleteParticipants() {
  const holeNums = roundHoles.map(h => h.hole_number);
  if (!holeNums.length) return [];
  const missing = [];
  if (_scrambleGameRow) {
    (roundTeams || []).forEach(t => {
      const ps = roundTeamScores[t.id] || {};
      const left = holeNums.filter(hn => !(ps[hn] > 0)).length;
      if (left) missing.push({ name: t.name, left });
    });
  } else {
    const allFP = (roundFlights || []).flatMap(f => f.flight_players || []);
    allFP.forEach(fp => {
      const ps = roundScores[fp.player_id] || {};
      const left = holeNums.filter(hn => !(ps[hn] > 0)).length;
      if (left) missing.push({ name: (fp.profiles?.display_name || '?').split(' ')[0], left });
    });
  }
  return missing;
}
async function finishRound() {
  if (!(await _ensureSaved(false))) return;
  const missing = _incompleteParticipants();
  const msg = missing.length
    ? `⚠️ Ikke alle har fullført: ${missing.map(m => `${m.name} (${m.left} hull igjen)`).join(', ')}. Avslutte likevel? Dette lukker runden for ALLE flighter med én gang, uansett om de er ferdige.`
    : 'Avslutt runden og se sammendrag?';
  const confirmed = await showConfirm(msg, 'Avslutt');
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
  // Åpner samme scoringsskjerm som under runden, uansett status — for å rette
  // opp feilregistrerte slag i etterkant. canEdit er flight-medlemskap som
  // ellers, MEN admin får redigere alle flighter/lag når runden er
  // 'completed' (aug/sep 2026-avklaring) — kun for avsluttede runder, ikke
  // under en live/aktiv runde, se renderPlayerInputs/renderTeamInputs.
  const editScoreBtn = document.getElementById('summaryEditScoreBtn');
  if (editScoreBtn) editScoreBtn.onclick = () => { closeModal('modalRoundSummary'); openRound(roundId); };
  const { data: scores } = await db.from('scores').select('*').eq('round_id', roundId);
  const { data: holes } = await db.from('holes').select('*').eq('course_id', round.course_id).order('hole_number');
  const { data: summaryEvents } = await db.from('game_events').select('*').eq('round_id', roundId);
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
      round, holes: filteredHoles, teamScores, teams: scrambleRow.game_teams || [], events: summaryEvents || [], fullCoursePar,
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
  // Øvrige spill (quota, nassau, …): generisk summary-rendering via motoren.
  const sideEl = document.getElementById('sideGamesSummary');
  if (sideEl) {
    const sideCtx = { round, holes: filteredHoles, scores: sc, teamScores, teams: (scrambleRow?.game_teams) || [], events: summaryEvents || [], flights: round.flights || [], fullCoursePar };
    const handled = ['skins', 'scramble', 'stableford'];
    const html = (round.games || [])
      .filter(g => !handled.includes(g.game_type))
      .map(g => { const m = getGame(g.game_type); return (m && m.summaryUI) ? m.summaryUI(sideCtx) : ''; })
      .filter(Boolean).join('<div style="height:12px;"></div>');
    sideEl.style.display = html ? 'block' : 'none';
    sideEl.innerHTML = html || '';
  }
  // Oppgjøret (§8): nett ut penger på tvers av alle spill med settle().
  const settlementEl = document.getElementById('settlementSummary');
  if (settlementEl) {
    const html = _renderSettlement(round, sc, filteredHoles, fullCoursePar, allFP);
    settlementEl.style.display = html ? 'block' : 'none';
    settlementEl.innerHTML = html || '';
  }
}

// ── Oppgjøret (§8) ──
// Samler bidrag fra alle spill med settle(), netter ut til færrest betalinger,
// og bygger en delbar tekst. Viser modellen per spill («Skins · lik pott»).
let _settlementShareText = '';
function _renderSettlement(round, sc, holes, fullCoursePar, allFP) {
  const nameById = {};
  allFP.forEach(fp => { nameById[fp.player_id] = fp.profiles?.display_name?.split(' ')[0] || '?'; });
  const perGame = [];
  const total = {};
  for (const g of (round.games || [])) {
    const mod = getGame(g.game_type);
    if (!mod || typeof mod.settle !== 'function') continue;
    const ctx = { round, holes, scores: sc, flights: round.flights || [], fullCoursePar };
    const res = mod.settle(ctx);
    if (!res || !res.perPlayer) continue;
    perGame.push(res);
    for (const [pid, amt] of Object.entries(res.perPlayer)) total[pid] = (total[pid] || 0) + amt;
  }
  if (!perGame.length) return '';
  const tx = netSettlements(total);
  const fmt = a => `${a > 0 ? '+' : ''}${a}`;
  const gameRows = perGame.map(res => {
    const cells = Object.entries(res.perPlayer)
      .map(([pid, amt]) => ({ name: nameById[pid] || '?', amt: Math.round(amt) }))
      .sort((a, b) => b.amt - a.amt)
      .map(e => `<span style="color:${e.amt > 0 ? 'var(--green-light)' : e.amt < 0 ? '#e8a070' : 'var(--cream-dim)'};">${e.name} ${fmt(e.amt)}</span>`).join(' · ');
    return `<div style="font-size:12px;color:var(--cream-dim);margin-bottom:6px;"><span style="color:var(--gold-dim);">${res.label}:</span> ${cells}</div>`;
  }).join('');
  const payRows = tx.length
    ? tx.map(t => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:10px;margin-bottom:6px;">
        <div style="font-size:14px;color:var(--cream);">${nameById[t.from] || '?'} <span style="color:var(--cream-dim);">→</span> ${nameById[t.to] || '?'}</div>
        <div style="font-family:'Playfair Display',serif;font-size:17px;color:var(--gold-light);">${t.amount} kr</div>
      </div>`).join('')
    : `<div style="font-size:13px;color:var(--cream-dim);">Ingen penger å gjøre opp — alt går i null.</div>`;
  const lines = [`💰 Oppgjøret · ${(round.courses?.name || '').trim()} ${round.date || ''}`.trim()];
  perGame.forEach(res => {
    const parts = Object.entries(res.perPlayer).map(([pid, amt]) => `${nameById[pid] || '?'} ${fmt(Math.round(amt))}`);
    lines.push(`${res.label}: ${parts.join(', ')}`);
  });
  if (tx.length) { lines.push('Betalinger:'); tx.forEach(t => lines.push(`  ${nameById[t.from]} → ${nameById[t.to]}: ${t.amount} kr`)); }
  else lines.push('Alt går i null.');
  _settlementShareText = lines.join('\n');
  return `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:16px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;">💰 Oppgjøret</div>
      <button onclick="shareSettlement()" style="background:none;border:1px solid rgba(201,168,76,0.35);color:var(--gold);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;-webkit-tap-highlight-color:transparent;">Del ↗</button>
    </div>
    ${gameRows}
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);">${payRows}</div>
  </div>`;
}
async function shareSettlement() {
  const text = _settlementShareText || '';
  if (!text) return;
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); alert('Oppgjøret er kopiert — lim inn i gruppechatten.'); }
  catch (e) { alert(text); }
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
  holes.forEach(h => {
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
  });
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
    <div class="pga-card" style="border-radius:10px; margin:0 -4px;">${_pgaScorecardHtml(playerScores, holes, hcp)}</div>
  `;
}
