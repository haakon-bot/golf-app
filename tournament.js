// ── TURNERING ──
// Binder flere RUNDER til én sammenlagt konkurranse (f.eks. en golftur).
// Ren tillegging oppå eksisterende data — ingen endring i spillmotoren:
// - Samlet ledertavle = PLASSERINGSPOENG per spiller, ikke rå Stableford-sum
//   (besluttet sept 2026 — nødvendig når en turnering blander rundetyper,
//   f.eks. Stableford og Texas scramble, som ellers ikke er sammenlignbare):
//   · Stableford-runde: spillerne rangeres etter Stableford-poeng den
//     runden. Poeng = (antall deltakere − plass + 1), og 1. plass får i
//     tillegg STABLEFORD_WINNER_BONUS oppå. Delt plass → alle får poeng for
//     beste delte plass, neste plass hopper forbi.
//   · Scramble/lag-runde: INGEN full plasseringsstige — vinnerlaget
//     (delt 1. plass inkludert) får SCRAMBLE_WIN_POINTS hver, øvrige lag 0.
//     Rangeringen gjenbruker ScrambleGame.compute (samme kilde som
//     live-ledertavlen); "🏌️ Lag-vinner" vises i tillegg som egen kåring.
//   · Best Ball-runde: scorer individuelt, så går gjennom SAMME
//     plasseringsstige som en vanlig Stableford-runde (ingen game_teams-
//     rader å kjenne igjen den på) — MEN i tillegg får hvert medlem av
//     vinner-flighten (beste BestBallGame-lagresultat) BESTBALL_WIN_POINTS
//     oppå sin individuelle plasseringspoengsum, samme mønster som scramble.
// - Sidekonkurranse (nærmest pin / lengst drive + straffevariantene)
//   registreres og bekreftes PER RUNDE av game-junk.js; bekreftede vinnere
//   legger til/trekker fra poeng i summen over (se junkGame-blokken under).
// - Manuelle justeringer er en egen, fri sikkerhetsventil
//   (tournament_adjustments), uavhengig av alt annet.

const STABLEFORD_WINNER_BONUS = 3;   // ekstra poeng oppå vanlig plasseringspoeng for 1. plass
const SCRAMBLE_WIN_POINTS = 3;       // poeng til hvert medlem av vinnerlaget (taperlag: 0)
const BESTBALL_WIN_POINTS = 3;       // poeng OPPÅ individuell plassering, til vinner-flighten i Best Ball

// Poeng for én plass i et felt på n deltakere (1 = best). Sisteplass = 1p,
// +1 poeng per plass oppover, og vinneren får winnerBonus i tillegg.
function _placementPoints(n, place, winnerBonus) {
  const base = n - place + 1;
  return place === 1 ? base + winnerBonus : base;
}

// entries: [{id, value}], høyere value = bedre. → { id: poeng }. Delt plass
// (lik value) gir ALLE i gruppen poengene for beste delte plass —
// neste distinkte gruppe hopper forbi de brukte plassene (1,2,2,4,5…).
function _rankToPoints(entries, winnerBonus) {
  const n = entries.length;
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const out = {};
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j++;
    const pts = _placementPoints(n, i + 1, winnerBonus);
    for (let k = i; k < j; k++) out[sorted[k].id] = pts;
    i = j;
  }
  return out;
}

let _tournamentList = null;       // cache for lista + wizard-velgeren
let _tournamentDetailId = null;   // hvilken turnering som er åpnet (innlogget side)
let _lastTournamentId = null;     // sist regnede turnering (for modaler/refresh)
let _lastTournamentData = null;   // sist regnede data (for juster-poeng-modalens spillerliste)

async function fetchTournaments() {
  const { data } = await db.from('tournaments').select('*').order('created_at', { ascending: false });
  _tournamentList = data || [];
  return _tournamentList;
}

function _fmtRoundLabel(r) {
  return `${r.date || ''} · ${r.courseName}${r.isTeamRound ? ' 🏌️ Lag' : r.isBestBall ? ' ⛳ Best Ball' : ''}`;
}

// Henter alle runder for en turnering og regner sammenlagt + lag-vinnere.
// Gjenbrukes av både innlogget detaljvisning og den offentlige delingssiden.
async function computeTournamentData(tournamentId) {
  const { data: rounds } = await db.from('rounds')
    .select('*, courses(name, holes), tee_sets(slope, course_rating), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name))), games(*, game_teams(*))')
    .eq('tournament_id', tournamentId)
    .order('date', { ascending: true });
  const roundList = rounds || [];
  const totals = {};        // player_id → { name, points, perRound: {roundId: pts} }
  const allPlayers = {};    // player_id → name (for juster-poeng-modalens spillerliste)
  const roundMeta = [];
  for (const round of roundList) {
    const [{ data: scores }, { data: holes }, { data: events }] = await Promise.all([
      db.from('scores').select('*').eq('round_id', round.id),
      db.from('holes').select('*').eq('course_id', round.course_id).order('hole_number'),
      db.from('game_events').select('*').eq('round_id', round.id),
    ]);
    const holeRange = round.hole_range || 'all';
    const activeHoles = holeRange === 'front9' ? (holes || []).filter(h => h.hole_number <= 9)
      : holeRange === 'back9' ? (holes || []).filter(h => h.hole_number >= 10) : (holes || []);
    const holeMap = {}; activeHoles.forEach(h => { holeMap[h.hole_number] = h; });
    const fullPar = (holes || []).reduce((s, h) => s + (h.par || 0), 0) || 72;
    const allFP = (round.flights || []).flatMap(f => f.flight_players || []);
    allFP.forEach(fp => { allPlayers[fp.player_id] = fp.profiles?.display_name || '?'; });

    const scrGame = typeof scrambleGame === 'function' ? scrambleGame(round) : null;
    const isTeamRound = !!(scrGame && (scrGame.game_teams || []).length);
    let teamWinner = null;
    let isBestBall = false;
    if (isTeamRound) {
      const teamScores = {};
      (scores || []).forEach(s => { if (s.team_id && s.strokes) (teamScores[s.team_id] = teamScores[s.team_id] || {})[s.hole_number] = s.strokes; });
      const data = getGame('scramble').compute({ round, holes: activeHoles, teamScores, teams: scrGame.game_teams || [], events: events || [], fullCoursePar: fullPar });
      const teamsRanked = (data && data.teams) || [];
      const top = teamsRanked[0];
      if (top && top.thru > 0) teamWinner = { name: top.team.name, thru: top.thru };
      // Nullstill 0p for ALLE som er med i et lag denne runden, så tapende
      // lag viser eksplisitt "0" i standings-kolonnen (ikke "–", som betyr
      // "ikke med i runden"). Vinnerne bumpes til SCRAMBLE_WIN_POINTS under.
      (scrGame.game_teams || []).forEach(t => {
        (t.member_ids || []).forEach(pid => {
          if (!totals[pid]) totals[pid] = { name: allPlayers[pid] || '?', points: 0, perRound: {} };
          if (totals[pid].perRound[round.id] == null) totals[pid].perRound[round.id] = 0;
        });
      });
      // Scramble gir INGEN full plasseringsstige — kun vinnerlaget (delt 1.
      // plass inkludert) får SCRAMBLE_WIN_POINTS hver, øvrige lag 0.
      if (top && top.thru > 0 && !top.out) {
        const val = r => data.scoring === 'stableford' ? r.totalSf : data.scoring === 'slag' ? r.totalGross : r.totalNet;
        const bestVal = val(top);
        const winners = teamsRanked.filter(r => r.thru > 0 && !r.out && val(r) === bestVal);
        winners.forEach(w => {
          (w.team.member_ids || []).forEach(pid => {
            if (!totals[pid]) totals[pid] = { name: allPlayers[pid] || '?', points: 0, perRound: {} };
            totals[pid].points += SCRAMBLE_WIN_POINTS;
            totals[pid].perRound[round.id] = (totals[pid].perRound[round.id] || 0) + SCRAMBLE_WIN_POINTS;
          });
        });
      }
    } else {
      const scoreMap = {};
      (scores || []).forEach(s => { if (s.player_id) (scoreMap[s.player_id] = scoreMap[s.player_id] || {})[s.hole_number] = s.strokes; });
      // Rangér spillerne som faktisk har scoret noe denne runden etter
      // Stableford-poeng, og legg PLASSERINGSpoeng (ikke rå Stableford-sum)
      // inn i turneringssummen — se _rankToPoints/_placementPoints over.
      const played = [];
      allFP.forEach(fp => {
        const phcp = _playingHcp(fp.handicap, round.tee_sets?.slope, round.tee_sets?.course_rating, fullPar);
        let pts = 0, thru = 0;
        Object.entries(scoreMap[fp.player_id] || {}).forEach(([hn, strokes]) => {
          const h = holeMap[parseInt(hn)];
          if (strokes > 0 && h?.par && h?.stroke_index) { pts += calcStableford(strokes, h.par, phcp, h.stroke_index, 18); thru++; }
        });
        if (thru > 0) played.push({ id: fp.player_id, name: fp.profiles?.display_name || '?', value: pts });
      });
      const placement = _rankToPoints(played, STABLEFORD_WINNER_BONUS);
      played.forEach(p => {
        if (!totals[p.id]) totals[p.id] = { name: p.name, points: 0, perRound: {} };
        totals[p.id].points += placement[p.id];
        totals[p.id].perRound[round.id] = placement[p.id];
      });
      // Best Ball: OPPÅ den individuelle plasseringspoengsummen over, får
      // hvert medlem av vinner-flighten (beste lagresultat, delt 1. plass
      // inkludert) BESTBALL_WIN_POINTS hver — samme mønster som scramble.
      const bbGame = (round.games || []).find(g => g.game_type === 'bestball' && g.is_main);
      if (bbGame && typeof getGame === 'function' && getGame('bestball')) {
        isBestBall = true;
        const bbData = getGame('bestball').compute({ round, holes: activeHoles, scores: scoreMap, flights: round.flights || [], fullCoursePar: fullPar });
        const bbTeams = (bbData && bbData.teams) || [];
        const bbTop = bbTeams[0];
        if (bbTop && bbTop.thru > 0) {
          const bbWinners = bbTeams.filter(t => t.thru > 0 && t.total === bbTop.total);
          teamWinner = { name: bbWinners.map(t => t.name).join(' & '), thru: bbTop.thru };
          bbWinners.forEach(w => {
            w.members.forEach(fp => {
              const pid = fp.player_id;
              if (!totals[pid]) totals[pid] = { name: fp.profiles?.display_name || '?', points: 0, perRound: {} };
              totals[pid].points += BESTBALL_WIN_POINTS;
              totals[pid].perRound[round.id] = (totals[pid].perRound[round.id] || 0) + BESTBALL_WIN_POINTS;
            });
          });
        }
      }
    }
    // Sidekonkurranse (game-junk.js): bekreftede vinnere gir bonuspoeng KUN i
    // turnerings-summen (besluttet sept 2026), uavhengig av om runden er
    // individuell eller lagspill — en scramble-spiller uten egen player_id-
    // score kan fortsatt vinne nærmest pin/lengst drive.
    const junkGame = (round.games || []).find(g => g.game_type === 'junk');
    if (junkGame && typeof getGame === 'function' && getGame('junk')) {
      const junkData = getGame('junk').compute({ round, flights: round.flights || [], events: events || [] });
      (junkData.entries || []).forEach(entry => {
        if (!entry.confirmedId) return;
        if (!totals[entry.confirmedId]) totals[entry.confirmedId] = { name: allPlayers[entry.confirmedId] || '?', points: 0, perRound: {} };
        totals[entry.confirmedId].points += entry.points;
        totals[entry.confirmedId].perRound[round.id] = (totals[entry.confirmedId].perRound[round.id] || 0) + entry.points;
      });
    }
    roundMeta.push({ id: round.id, date: round.date, status: round.status, courseName: round.courses?.name || '', isTeamRound, isBestBall, teamWinner });
  }
  // Sikkerhetsventil: manuell poeng-justering, helt uavhengig av alt over —
  // for å rette opp hvis noe går galt med registrering/poeng på turen.
  // tournament_adjustments har TO fremmednøkler mot profiles (player_id og
  // created_by) — PostgREST kan ikke gjette hvilken uten disambiguering, og
  // feiler embed-et stille (data blir tom, ingen kastet feil) uten
  // !tournament_adjustments_player_id_fkey her. Det var hele bugen: innsatsen
  // lagret fint, men denne lesingen — brukt for BÅDE summen og listen — kom
  // aldri tilbake med noe.
  const { data: adjustments, error: adjErr } = await db.from('tournament_adjustments').select('*, profiles!tournament_adjustments_player_id_fkey(display_name)').eq('tournament_id', tournamentId).order('created_at', { ascending: false });
  if (adjErr) console.error('tournament_adjustments select feilet:', adjErr);
  (adjustments || []).forEach(adj => {
    if (!totals[adj.player_id]) totals[adj.player_id] = { name: allPlayers[adj.player_id] || adj.profiles?.display_name || '?', points: 0, perRound: {} };
    totals[adj.player_id].points += Number(adj.points) || 0;
  });
  const standings = Object.entries(totals).map(([playerId, t]) => ({ playerId, ...t })).sort((a, b) => b.points - a.points);
  return { rounds: roundMeta, standings, adjustments: adjustments || [], allPlayers };
}

// ── Innlogget side (page-tournament) ──

async function loadTournamentPage() {
  const el = document.getElementById('tournamentContent');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Laster...</div>';
  await fetchTournaments();
  if (_tournamentDetailId && _tournamentList.some(t => t.id === _tournamentDetailId)) {
    await renderTournamentDetail(_tournamentDetailId);
  } else {
    renderTournamentList();
  }
}

function renderTournamentList() {
  _tournamentDetailId = null;
  const el = document.getElementById('tournamentContent');
  const list = _tournamentList || [];
  const cards = list.map(t => `
    <div onclick="renderTournamentDetail('${t.id}')" style="padding:16px; background:rgba(0,0,0,0.2); border-radius:12px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.07); cursor:pointer; -webkit-tap-highlight-color:transparent;">
      <div style="font-family:'Playfair Display',serif; font-size:17px; color:var(--gold);">🏆 ${t.name}</div>
      <div style="font-size:12px; color:var(--cream-dim); margin-top:4px;">Opprettet ${new Date(t.created_at).toLocaleDateString('no-NO')}</div>
    </div>`).join('');
  el.innerHTML = `
    <button class="btn btn-auto" style="margin-bottom:14px;" onclick="openCreateTournamentModal()">+ Ny turnering</button>
    ${list.length ? cards : `<div class="empty" style="padding:48px 20px;text-align:center;">
      <div class="empty-icon" style="font-size:48px;opacity:0.5;">🏆</div>
      <h3 style="margin-top:12px;">Ingen turneringer ennå</h3>
      <p style="color:var(--cream-dim);">Lag en turnering, huk av «Del av turnering» når du starter et spill, så bygges sammenlagt-stillingen automatisk.</p>
    </div>`}
  `;
}

async function renderTournamentDetail(tournamentId) {
  _tournamentDetailId = tournamentId;
  _lastTournamentId = tournamentId;
  if (!_tournamentList) await fetchTournaments();
  const t = (_tournamentList || []).find(x => x.id === tournamentId);
  const el = document.getElementById('tournamentContent');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Regner sammenlagt...</div>';
  const data = await computeTournamentData(tournamentId);
  _lastTournamentData = data;
  el.innerHTML = _renderTournamentDetailHTML(t, data, { publicMode: false });
}

let _editingTournamentId = null;   // null = opprett ny, satt = redigerer eksisterende navn

function openCreateTournamentModal() {
  _editingTournamentId = null;
  document.getElementById('tournamentModalTitle').textContent = 'Ny turnering';
  document.getElementById('tournamentModalSaveBtn').textContent = 'Opprett';
  document.getElementById('newTournamentName').value = '';
  document.getElementById('createTournamentAlert').innerHTML = '';
  openModal('modalCreateTournament');
}
function openEditTournamentModal(id, currentName) {
  _editingTournamentId = id;
  document.getElementById('tournamentModalTitle').textContent = 'Endre navn';
  document.getElementById('tournamentModalSaveBtn').textContent = 'Lagre';
  document.getElementById('newTournamentName').value = currentName || '';
  document.getElementById('createTournamentAlert').innerHTML = '';
  openModal('modalCreateTournament');
}
async function saveNewTournament() {
  const name = document.getElementById('newTournamentName').value.trim();
  if (!name) { showAlert('createTournamentAlert', 'Skriv inn et navn.', 'error'); return; }
  if (_editingTournamentId) {
    const { error } = await db.from('tournaments').update({ name }).eq('id', _editingTournamentId);
    if (error) { showAlert('createTournamentAlert', 'Kunne ikke lagre: ' + error.message, 'error'); return; }
    closeModal('modalCreateTournament');
    await fetchTournaments();
    renderTournamentDetail(_editingTournamentId);
    return;
  }
  const { data, error } = await db.from('tournaments').insert({ name, created_by: currentProfile?.id || null }).select().single();
  if (error) { showAlert('createTournamentAlert', 'Kunne ikke opprette: ' + error.message, 'error'); return; }
  closeModal('modalCreateTournament');
  await fetchTournaments();
  renderTournamentDetail(data.id);
}

async function deleteTournamentPrompt(id, name) {
  const ok = await showConfirm(`Slette turneringen «${name}»? Rundene beholdes, men mister koblingen til turneringen. Dette kan ikke angres.`, 'Slett');
  if (!ok) return;
  const { error } = await db.from('tournaments').delete().eq('id', id);
  if (error) { alert('Kunne ikke slette: ' + error.message); return; }
  await fetchTournaments();
  renderTournamentList();
}

function shareTournamentLink(id, name) {
  const url = `${location.origin}${location.pathname}#turnering=${id}`;
  if (navigator.share) navigator.share({ title: 'Turnering · ' + name, url }).catch(() => {});
  else if (navigator.clipboard) { navigator.clipboard.writeText(url); alert('Lenke kopiert:\n' + url); }
  else alert(url);
}

// ── Sikkerhetsventil: manuell poeng-justering ──
function openAdjustPointsModal() {
  if (!_lastTournamentData) return;
  const playerSel = document.getElementById('adjustPlayer');
  const players = Object.entries(_lastTournamentData.allPlayers || {});
  playerSel.innerHTML = players.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')
    || '<option value="">Ingen spillere ennå</option>';
  document.getElementById('adjustPoints').value = '';
  document.getElementById('adjustNote').value = '';
  document.getElementById('adjustPointsAlert').innerHTML = '';
  openModal('modalAdjustPoints');
}
async function saveAdjustment() {
  const playerId = document.getElementById('adjustPlayer').value;
  const points = parseFloat(document.getElementById('adjustPoints').value);
  const note = document.getElementById('adjustNote').value.trim() || null;
  if (!playerId || !points) { showAlert('adjustPointsAlert', 'Velg spiller og et poengtall (ikke 0).', 'error'); return; }
  const { error } = await db.from('tournament_adjustments').insert({ tournament_id: _lastTournamentId, player_id: playerId, points, note, created_by: currentProfile?.id || null });
  if (error) { showAlert('adjustPointsAlert', 'Kunne ikke lagre: ' + error.message, 'error'); return; }
  closeModal('modalAdjustPoints');
  renderTournamentDetail(_lastTournamentId);
}
async function deleteAdjustment(id) {
  const ok = await showConfirm('Fjerne denne justeringen?', 'Fjern');
  if (!ok) return;
  await db.from('tournament_adjustments').delete().eq('id', id);
  renderTournamentDetail(_lastTournamentId);
}

// Delt HTML-renderer for både innlogget side og offentlig delingslenke.
function _renderTournamentDetailHTML(t, data, opts) {
  opts = opts || {};
  const teamRounds = data.rounds.filter(r => r.isTeamRound || r.isBestBall);

  const standingsRows = data.standings.map((s, i) => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
      <td style="padding:9px 10px;color:${i === 0 ? 'var(--gold)' : 'var(--cream-dim)'};font-size:13px;">${i + 1}</td>
      <td style="padding:9px 10px;color:var(--cream);font-size:14px;">${(s.name || '?').split(' ')[0]}</td>
      ${data.rounds.map(r => `<td style="padding:9px 6px;text-align:center;color:var(--cream-dim);font-size:12px;">${s.perRound[r.id] != null ? s.perRound[r.id] : '–'}</td>`).join('')}
      <td style="padding:9px 10px;text-align:right;font-family:'Playfair Display',serif;font-size:17px;color:${i === 0 ? 'var(--gold)' : 'var(--cream)'};">${s.points}p</td>
    </tr>`).join('');

  const teamSection = teamRounds.length ? `
    <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 10px;">🏌️ Lag-vinner</div>
    <div style="background:rgba(0,0,0,0.2);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
      ${teamRounds.map(r => `<div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:13px;color:var(--cream-dim);">${_fmtRoundLabel(r)}</div>
        <div style="font-size:15px;color:var(--gold);margin-top:2px;">${r.teamWinner ? `🏆 ${r.teamWinner.name}` : 'Ingen score ennå'}</div>
      </div>`).join('')}
    </div>` : '';

  // Sikkerhetsventil (§ tournament_adjustments): fri poeng-justering, alltid
  // synlig som en enkel liste — ikke gjettet på verdier, bare hva som er lagret.
  const adjustmentList = (data.adjustments || []).map(a => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;font-size:12px;color:var(--cream-dim);border-bottom:1px solid rgba(255,255,255,0.05);">
      <span><strong style="color:var(--cream);">${(a.profiles?.display_name || '?').split(' ')[0]}</strong> ${a.points > 0 ? '+' : ''}${a.points}p${a.note ? ` · ${a.note}` : ''}</span>
      ${(opts.publicMode || !currentProfile?.is_admin) ? '' : `<button onclick="deleteAdjustment('${a.id}')" style="background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:14px;">✕</button>`}
    </div>`).join('');

  const roundClick = (r) => opts.publicMode ? `showPublicLive('${r.id}')` : (r.status === 'completed' ? `showRoundSummary('${r.id}')` : `openRound('${r.id}')`);
  const roundsSection = `
    <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 10px;">Runder i turneringen</div>
    <div style="background:rgba(0,0,0,0.2);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
      ${data.rounds.length ? data.rounds.map(r => `
      <div onclick="${roundClick(r)}" style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;display:flex;justify-content:space-between;-webkit-tap-highlight-color:transparent;">
        <span style="font-size:13px;color:var(--cream);">${_fmtRoundLabel(r)}</span>
        <span style="font-size:11px;color:var(--cream-dim);">${r.status === 'active' ? '🟢' : '✅'} →</span>
      </div>`).join('') : `<div style="padding:16px;font-size:13px;color:var(--cream-dim);">Ingen runder merket for denne turneringen ennå — huk av «Del av turnering» når du starter et spill.</div>`}
    </div>`;

  return `
    ${opts.publicMode ? '' : `<button onclick="renderTournamentList()" style="background:none;border:none;color:var(--cream-dim);font-size:13px;cursor:pointer;margin-bottom:10px;padding:0;-webkit-tap-highlight-color:transparent;">← Alle turneringer</button>`}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
      <h1 style="font-family:'Playfair Display',serif;font-size:22px;color:var(--gold-light);margin:0;">🏆 ${t?.name || 'Turnering'}</h1>
      ${!opts.publicMode && t ? `<div style="display:flex;gap:8px;flex-shrink:0;">
        ${currentProfile?.is_admin ? `
        <button onclick="openEditTournamentModal('${t.id}','${(t.name || '').replace(/'/g, '')}')" title="Endre navn" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:var(--cream-dim);padding:8px 10px;border-radius:10px;cursor:pointer;font-size:14px;-webkit-tap-highlight-color:transparent;">✏️</button>
        <button onclick="deleteTournamentPrompt('${t.id}','${(t.name || '').replace(/'/g, '')}')" title="Slett turnering" style="background:rgba(226,75,74,0.1);border:1px solid rgba(226,75,74,0.3);color:#e8a0a0;padding:8px 10px;border-radius:10px;cursor:pointer;font-size:14px;-webkit-tap-highlight-color:transparent;">🗑</button>
        ` : ''}
        <button onclick="shareTournamentLink('${t.id}','${(t.name || '').replace(/'/g, '')}')" style="background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.3);color:var(--gold);padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12px;white-space:nowrap;-webkit-tap-highlight-color:transparent;">📤 Del</button>
      </div>` : ''}
    </div>
    <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">Sammenlagt · poeng per runde</div>
    <div style="background:rgba(0,0,0,0.2);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);margin-bottom:10px;">
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="padding:8px 10px;text-align:left;color:var(--cream-dim);font-size:10px;">#</th>
          <th style="padding:8px 10px;text-align:left;color:var(--cream-dim);font-size:10px;">Spiller</th>
          ${data.rounds.map((r, i) => `<th style="padding:8px 6px;text-align:center;color:var(--cream-dim);font-size:9px;" title="${_fmtRoundLabel(r)}">R${i + 1}${r.isTeamRound ? ' 🏌️' : r.isBestBall ? ' ⛳' : ''}</th>`).join('')}
          <th style="padding:8px 10px;text-align:right;color:var(--cream-dim);font-size:10px;">Sum</th>
        </tr></thead>
        <tbody>${standingsRows || `<tr><td colspan="${data.rounds.length + 3}" style="padding:20px;text-align:center;color:var(--cream-dim);font-size:13px;">Ingen runder med poeng ennå.</td></tr>`}</tbody>
      </table></div>
    </div>
    ${teamSection}
    <div style="font-size:10px;color:rgba(255,255,255,0.35);margin:4px 0 24px;">Sidekonkurranse (nærmest pin/lengst drive) registreres og bekreftes i den enkelte runden — se rundeoppsummeringen. Bekreftede poeng er allerede talt med i summen over.</div>
    <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">⚖️ Manuelle justeringer <span style="text-transform:none;letter-spacing:0;font-size:10px;opacity:0.7;">(sikkerhetsventil — telles i summen over)</span></div>
    <div style="background:rgba(0,0,0,0.2);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);margin-bottom:10px;">
      ${adjustmentList || `<div style="padding:12px 16px;font-size:13px;color:var(--cream-dim);">Ingen justeringer.</div>`}
    </div>
    ${(opts.publicMode || !currentProfile?.is_admin) ? '' : `<button class="btn btn-auto" style="margin-bottom:14px;" onclick="openAdjustPointsModal()">+ Juster poeng</button>`}
    ${roundsSection}
  `;
}

// ── Offentlig delingslenke (§ mønster fra showPublicLive) — #turnering=<id> ──
let _publicTournamentInterval = null;
async function showPublicTournament() {
  const id = _tournamentHashId();
  if (typeof _publicLiveInterval !== 'undefined' && _publicLiveInterval) { clearInterval(_publicLiveInterval); _publicLiveInterval = null; }
  const plp = document.getElementById('publicLivePage'); if (plp) plp.style.display = 'none';
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('publicTournamentPage').style.display = 'block';
  await renderPublicTournament(id);
  if (!_publicTournamentInterval) _publicTournamentInterval = setInterval(() => renderPublicTournament(id), 20000);
}
async function renderPublicTournament(id) {
  const el = document.getElementById('publicTournamentContent');
  if (!id) { el.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--cream-dim);">Ugyldig lenke.</div>'; return; }
  const { data: t } = await db.from('tournaments').select('*').eq('id', id).single();
  if (!t) { el.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--cream-dim);">Fant ikke turneringen.</div>'; return; }
  const data = await computeTournamentData(id);
  el.innerHTML = _renderTournamentDetailHTML(t, data, { publicMode: true });
}
