// ── TURNERING ──
// Binder flere RUNDER til én sammenlagt konkurranse (f.eks. en golftur).
// Ren tillegging oppå eksisterende data — ingen endring i spillmotoren:
// - Samlet ledertavle = sum av Stableford-poeng per spiller på tvers av
//   rundene som er merket for turneringen. Regnes fra scores/player_id
//   (samme calcStableford/_playingHcp som Live/Stats). Lagspill (scramble)
//   scorer på team_id og har ingen player_id-rader, så de bidrar automatisk
//   0 til denne summen — ingen spesialhåndtering nødvendig.
// - Lag-vinner per scramble-runde gjenbrukes fra ScrambleGame.compute
//   (samme kilde som live-ledertavlen), vist som EGEN kåring.
// - Sidekonkurranse (nærmest pin / lengst drive) er en helt separat,
//   append-only tally (tournament_awards) — teller ALDRI i poengsummen.

let _tournamentList = null;       // cache for lista + wizard-velgeren
let _tournamentDetailId = null;   // hvilken turnering som er åpnet (innlogget side)
let _lastTournamentId = null;     // sist regnede turnering (for modaler/refresh)
let _lastTournamentData = null;   // sist regnede data (for award-modalens dropdowns)

async function fetchTournaments() {
  const { data } = await db.from('tournaments').select('*').order('created_at', { ascending: false });
  _tournamentList = data || [];
  return _tournamentList;
}

function _fmtRoundLabel(r) {
  return `${r.date || ''} · ${r.courseName}${r.isTeamRound ? ' 🏌️ Lag' : ''}`;
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
  const allPlayers = {};    // player_id → name (for award-registrering)
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
    if (isTeamRound) {
      const teamScores = {};
      (scores || []).forEach(s => { if (s.team_id && s.strokes) (teamScores[s.team_id] = teamScores[s.team_id] || {})[s.hole_number] = s.strokes; });
      const data = getGame('scramble').compute({ round, holes: activeHoles, teamScores, teams: scrGame.game_teams || [], events: events || [], fullCoursePar: fullPar });
      const top = ((data && data.teams) || [])[0];
      if (top && top.thru > 0) teamWinner = { name: top.team.name, thru: top.thru };
    } else {
      const scoreMap = {};
      (scores || []).forEach(s => { if (s.player_id) (scoreMap[s.player_id] = scoreMap[s.player_id] || {})[s.hole_number] = s.strokes; });
      allFP.forEach(fp => {
        const phcp = _playingHcp(fp.handicap, round.tee_sets?.slope, round.tee_sets?.course_rating, fullPar);
        let pts = 0;
        Object.entries(scoreMap[fp.player_id] || {}).forEach(([hn, strokes]) => {
          const h = holeMap[parseInt(hn)];
          if (strokes > 0 && h?.par && h?.stroke_index) pts += calcStableford(strokes, h.par, phcp, h.stroke_index, 18);
        });
        if (!totals[fp.player_id]) totals[fp.player_id] = { name: fp.profiles?.display_name || '?', points: 0, perRound: {} };
        totals[fp.player_id].points += pts;
        totals[fp.player_id].perRound[round.id] = pts;
      });
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
    roundMeta.push({ id: round.id, date: round.date, status: round.status, courseName: round.courses?.name || '', isTeamRound, teamWinner });
  }
  const { data: awards } = await db.from('tournament_awards').select('*, profiles(display_name)').eq('tournament_id', tournamentId).order('created_at', { ascending: false });
  const standings = Object.entries(totals).map(([playerId, t]) => ({ playerId, ...t })).sort((a, b) => b.points - a.points);
  return { rounds: roundMeta, standings, awards: awards || [], allPlayers };
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

function openAddAwardModal() {
  if (!_lastTournamentData) return;
  const roundSel = document.getElementById('awardRound');
  roundSel.innerHTML = (_lastTournamentData.rounds || []).map(r => `<option value="${r.id}">${_fmtRoundLabel(r)}</option>`).join('')
    || '<option value="">Ingen runder ennå</option>';
  const playerSel = document.getElementById('awardPlayer');
  const players = Object.entries(_lastTournamentData.allPlayers || {});
  playerSel.innerHTML = players.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')
    || '<option value="">Ingen spillere ennå</option>';
  document.getElementById('awardHole').value = '';
  document.getElementById('awardAlert').innerHTML = '';
  openModal('modalAddAward');
}
async function saveAward() {
  const roundId = document.getElementById('awardRound').value;
  const hole = parseInt(document.getElementById('awardHole').value) || null;
  const type = document.getElementById('awardType').value;
  const playerId = document.getElementById('awardPlayer').value;
  if (!roundId || !playerId) { showAlert('awardAlert', 'Velg runde og vinner.', 'error'); return; }
  const { error } = await db.from('tournament_awards').insert({ tournament_id: _lastTournamentId, round_id: roundId, hole_number: hole, award_type: type, player_id: playerId });
  if (error) { showAlert('awardAlert', 'Kunne ikke lagre: ' + error.message, 'error'); return; }
  closeModal('modalAddAward');
  renderTournamentDetail(_lastTournamentId);
}
async function deleteAward(awardId) {
  const ok = await showConfirm('Fjerne denne registreringen?', 'Fjern');
  if (!ok) return;
  await db.from('tournament_awards').delete().eq('id', awardId);
  renderTournamentDetail(_lastTournamentId);
}

// Delt HTML-renderer for både innlogget side og offentlig delingslenke.
function _renderTournamentDetailHTML(t, data, opts) {
  opts = opts || {};
  const indivRounds = data.rounds.filter(r => !r.isTeamRound);
  const teamRounds = data.rounds.filter(r => r.isTeamRound);

  const standingsRows = data.standings.map((s, i) => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
      <td style="padding:9px 10px;color:${i === 0 ? 'var(--gold)' : 'var(--cream-dim)'};font-size:13px;">${i + 1}</td>
      <td style="padding:9px 10px;color:var(--cream);font-size:14px;">${(s.name || '?').split(' ')[0]}</td>
      ${indivRounds.map(r => `<td style="padding:9px 6px;text-align:center;color:var(--cream-dim);font-size:12px;">${s.perRound[r.id] != null ? s.perRound[r.id] : '–'}</td>`).join('')}
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

  const awardTally = {};
  (data.awards || []).forEach(a => {
    const name = (a.profiles?.display_name || '?').split(' ')[0];
    awardTally[name] = awardTally[name] || { closest_pin: 0, longest_drive: 0 };
    awardTally[name][a.award_type] = (awardTally[name][a.award_type] || 0) + 1;
  });
  const tallyRows = Object.entries(awardTally).map(([name, c]) => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;color:var(--cream);border-bottom:1px solid rgba(255,255,255,0.05);">
      <span>${name}</span>
      <span style="color:var(--cream-dim);">${c.closest_pin ? `🎯 ${c.closest_pin}` : ''} ${c.longest_drive ? `🚀 ${c.longest_drive}` : ''}</span>
    </div>`).join('');
  const awardList = (data.awards || []).map(a => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:12px;color:var(--cream-dim);">
      <span>Hull ${a.hole_number ?? '?'} · ${a.award_type === 'closest_pin' ? 'Nærmest pin' : 'Lengst drive'} · <strong style="color:var(--cream);">${(a.profiles?.display_name || '?').split(' ')[0]}</strong></span>
      ${opts.publicMode ? '' : `<button onclick="deleteAward('${a.id}')" style="background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:14px;">✕</button>`}
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
        <button onclick="openEditTournamentModal('${t.id}','${(t.name || '').replace(/'/g, '')}')" title="Endre navn" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:var(--cream-dim);padding:8px 10px;border-radius:10px;cursor:pointer;font-size:14px;-webkit-tap-highlight-color:transparent;">✏️</button>
        <button onclick="deleteTournamentPrompt('${t.id}','${(t.name || '').replace(/'/g, '')}')" title="Slett turnering" style="background:rgba(226,75,74,0.1);border:1px solid rgba(226,75,74,0.3);color:#e8a0a0;padding:8px 10px;border-radius:10px;cursor:pointer;font-size:14px;-webkit-tap-highlight-color:transparent;">🗑</button>
        <button onclick="shareTournamentLink('${t.id}','${(t.name || '').replace(/'/g, '')}')" style="background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.3);color:var(--gold);padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12px;white-space:nowrap;-webkit-tap-highlight-color:transparent;">📤 Del</button>
      </div>` : ''}
    </div>
    <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">Sammenlagt · individuelt</div>
    <div style="background:rgba(0,0,0,0.2);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);margin-bottom:10px;">
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="padding:8px 10px;text-align:left;color:var(--cream-dim);font-size:10px;">#</th>
          <th style="padding:8px 10px;text-align:left;color:var(--cream-dim);font-size:10px;">Spiller</th>
          ${indivRounds.map(r => `<th style="padding:8px 6px;text-align:center;color:var(--cream-dim);font-size:9px;">${(r.date || '').slice(5)}</th>`).join('')}
          <th style="padding:8px 10px;text-align:right;color:var(--cream-dim);font-size:10px;">Sum</th>
        </tr></thead>
        <tbody>${standingsRows || `<tr><td colspan="${indivRounds.length + 3}" style="padding:20px;text-align:center;color:var(--cream-dim);font-size:13px;">Ingen individuelle runder med poeng ennå.</td></tr>`}</tbody>
      </table></div>
    </div>
    ${teamSection}
    <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 10px;">🎯 Sidekonkurranse <span style="text-transform:none;letter-spacing:0;font-size:10px;opacity:0.7;">(nærmest pin / lengst drive — teller ikke i summen)</span></div>
    <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:12px 16px;border:1px solid rgba(255,255,255,0.07);margin-bottom:10px;">
      ${tallyRows || `<div style="font-size:13px;color:var(--cream-dim);">Ingen registrert ennå.</div>`}
    </div>
    ${opts.publicMode ? '' : `<button class="btn btn-auto" style="margin-bottom:14px;" onclick="openAddAwardModal()">+ Registrer vinner</button>`}
    ${awardList ? `<div style="background:rgba(0,0,0,0.15);border-radius:10px;padding:2px 14px;margin-bottom:10px;">${awardList}</div>` : ''}
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
