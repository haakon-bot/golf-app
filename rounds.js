// ── ROUNDS ──
let allPlayers = [];
let flightCount = 0;
let _roundCourseHoles = [];
let _roundCoursePar = 72;
async function loadRounds() {
  const { data: rounds } = await db.from('rounds')
    .select('*, courses(name), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, handicap, profiles(display_name, username)))')
    .order('created_at', { ascending: false })
    .limit(20);
  const el = document.getElementById('roundsList');
  if (!rounds?.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">⛳</div><h3>Ingen runder ennå</h3><p>Trykk "+ Ny runde" for å starte!</p></div>';
    return;
  }
  el.innerHTML = rounds.map(r => {
    const playerCount = (r.flights || []).reduce((sum, f) => sum + (f.flight_players?.length || 0), 0);
    const statusColor = r.status === 'active' ? 'var(--green-light)' : 'var(--cream-dim)';
    const statusText = r.status === 'active' ? '🟢 Aktiv' : '✅ Avsluttet';
    const teeName = r.tee_sets?.name ? ` · ${r.tee_sets.name}` : '';
    const courseName = r.courses?.name || '(slettet bane)';
    const playerNames = (r.flights || [])
      .flatMap(f => f.flight_players || [])
      .map(fp => fp.profiles?.display_name?.split(' ')[0] || '?')
      .join(', ');
    const clickFn = r.status === 'completed' ? `showRoundSummary('${r.id}')` : `openRound('${r.id}')`;
    return `
    <div style="padding:16px 20px; background:rgba(0,0,0,0.2); border-radius:10px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.06); transition:all 0.2s; display:flex; align-items:center; gap:12px;" onmouseover="this.style.borderColor='rgba(201,168,76,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
      <div onclick="${clickFn}" style="flex:1; cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div style="font-size:16px; color:var(--cream); font-weight:500;">${courseName}</div>
            <div style="font-size:12px; color:var(--cream-dim); margin-top:3px;">${r.date}${teeName ? ' · Tee ' + r.tee_sets.name : ''}</div>
            <div style="font-size:12px; color:var(--gold-dim); margin-top:2px;">👤 ${playerNames || '–'}</div>
          </div>
          <div style="font-size:12px; color:${statusColor};">${statusText}</div>
        </div>
      </div>
      <button onclick="deleteRound('${r.id}')" style="background:none; border:1px solid rgba(192,57,43,0.4); color:var(--danger); border-radius:6px; padding:6px 10px; cursor:pointer; font-size:14px; flex-shrink:0;" title="Slett runde">🗑</button>
    </div>`;
  }).join('');
}
let _roundAvailableRanges = { hasFront9: false, hasBack9: false };
async function openNewRound() {
  flightCount = 0;
  _roundAvailableRanges = { hasFront9: false, hasBack9: false };
  selectMainGame('stableford');
  document.getElementById('newRoundAlert').innerHTML = '';
  document.getElementById('flightList').innerHTML = '';
  document.getElementById('roundDate').value = new Date().toISOString().split('T')[0];
  const rangeDiv = document.getElementById('roundHoleRangeDiv');
  if (rangeDiv) { rangeDiv.style.display = 'none'; rangeDiv.innerHTML = ''; }
  // Open modal immediately so the button always feels responsive
  const sel = document.getElementById('roundCourse');
  sel.innerHTML = '<option value="">Laster baner...</option>';
  openModal('modalNewRound');
  const { data: courses } = await db.from('courses').select('id, name').order('name');
  sel.innerHTML = '<option value="">Velg bane...</option>' +
    (courses || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const { data: players } = await db.from('profiles').select('id, display_name, username, handicap').order('display_name');
  allPlayers = players || [];
  addFlight();
}
async function loadTeeSets(courseId) {
  if (!courseId) return;
  const { data: tees } = await db.from('tee_sets').select('*').eq('course_id', courseId);
  const sel = document.getElementById('roundTee');
  sel.innerHTML = '<option value="">Velg tee...</option>' +
    (tees || []).map(t => `<option value="${t.id}" data-slope="${t.slope}" data-cr="${t.course_rating}" data-tee-name="${t.name}">${t.name} — Slope ${t.slope}, CR ${t.course_rating}</option>`).join('');
  sel.removeEventListener('change', _updateFlightPlayerGoals);
  sel.addEventListener('change', _updateFlightPlayerGoals);
  const { data: holes } = await db.from('holes').select('hole_number, par, stroke_index').eq('course_id', courseId);
  _roundCourseHoles = holes || [];
  _roundCoursePar = _roundCourseHoles.reduce((s, h) => s + (h.par || 0), 0) || 72;
  const holeNums = (holes || []).map(h => h.hole_number);
  const hasFront9 = holeNums.some(n => n <= 9);
  const hasBack9 = holeNums.some(n => n >= 10);
  _roundAvailableRanges = { hasFront9, hasBack9 };
  const warningEl = document.getElementById('roundHoleWarning');
  if (warningEl) warningEl.style.display = holeNums.length === 0 ? 'block' : 'none';
  const rangeDiv = document.getElementById('roundHoleRangeDiv');
  if (!rangeDiv) return;
  if (hasFront9 && hasBack9) {
    rangeDiv.style.display = 'block';
    rangeDiv.innerHTML = `<label style="font-size:13px;font-weight:500;color:var(--cream);display:block;margin-bottom:6px;">Hull</label>
      <select id="roundHoleRange" style="width:100%;padding:12px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:var(--cream);font-size:14px;font-family:'DM Sans',sans-serif;">
        <option value="all">Hull 1–18</option>
        <option value="front9">Hull 1–9</option>
        <option value="back9">Hull 10–18</option>
      </select>`;
    document.getElementById('roundHoleRange').addEventListener('change', _updateFlightPlayerGoals);

  } else {
    rangeDiv.style.display = 'none';
    rangeDiv.innerHTML = '';
  }
}
function addFlight() {
  flightCount++;
  const div = document.createElement('div');
  div.id = `flight-${flightCount}`;
  div.style.cssText = 'background:rgba(0,0,0,0.2); border-radius:8px; padding:14px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.07);';
  div.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <div style="font-size:13px; font-weight:600; color:var(--gold-light);">Flight ${flightCount}</div>
      ${flightCount > 1 ? `<button onclick="document.getElementById('flight-${flightCount}').remove()" class="remove-btn">×</button>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;" id="flight-players-${flightCount}">
      ${allPlayers.map(p => `
        <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.1);">
          <input type="checkbox" value="${p.id}" data-name="${p.display_name}" data-hcp="${p.handicap || 36}" style="accent-color:var(--gold);flex-shrink:0;margin-top:2px;">
          <div>
            <span style="font-size:13px;color:var(--cream-dim);">${p.display_name}</span>
            <span style="font-size:11px;color:var(--cream-dim);margin-left:4px;">(${p.handicap ?? '–'})</span>
            <div data-player-goal="${p.id}"></div>
          </div>
        </label>
      `).join('')}
    </div>
  `;
  document.getElementById('flightList').appendChild(div);
  _updateFlightPlayerGoals();
}
async function _updateFlightPlayerGoals() {
  const sel = document.getElementById('roundTee');
  const opt = sel?.options[sel.selectedIndex];
  const slope = parseFloat(opt?.dataset.slope);
  const cr = parseFloat(opt?.dataset.cr);

  if (!slope || !cr || !allPlayers.length) {
    document.querySelectorAll('[data-player-goal]').forEach(el => { el.innerHTML = ''; });
    return;
  }

  const holeRange = document.getElementById('roundHoleRange')?.value || 'all';
  const activeHoles = holeRange === 'front9' ? _roundCourseHoles.filter(h => h.hole_number <= 9)
    : holeRange === 'back9' ? _roundCourseHoles.filter(h => h.hole_number >= 10)
    : _roundCourseHoles;

  for (const p of allPlayers) {
    const goals = document.querySelectorAll(`[data-player-goal="${p.id}"]`);
    if (!goals.length) continue;
    const hi = parseFloat(p.handicap);
    if (isNaN(hi)) { goals.forEach(el => { el.innerHTML = ''; }); continue; }
    const tildelte = _activeStrokes(_playingHcp(hi, slope, cr, _roundCoursePar), activeHoles);
    goals.forEach(el => {
      el.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:3px;">Tildelte slag: ${tildelte}</div>`;
    });
  }
}

// ── Hovedspill-valg (bolt-on-lim i dagens modal; erstattes av §2-flyten). ──
let _selectedMainGame = 'stableford';
function selectMainGame(type) {
  _selectedMainGame = type;
  const isScr = type === 'scramble';
  const style = (btn, on) => { if (!btn) return;
    btn.style.border = `1px solid ${on ? 'var(--gold)' : 'rgba(255,255,255,0.12)'}`;
    btn.style.background = on ? 'rgba(201,168,76,0.18)' : 'transparent';
    btn.style.color = on ? 'var(--gold)' : 'var(--cream-dim)';
  };
  style(document.getElementById('mainGameStableford'), !isScr);
  style(document.getElementById('mainGameScramble'), isScr);
  const setup = document.getElementById('scrambleSetup');
  if (setup) setup.style.display = isScr ? 'block' : 'none';
  if (isScr) {
    const cfg = document.getElementById('scrambleConfig');
    if (cfg && !cfg.innerHTML.trim()) cfg.innerHTML = getGame('scramble').setupUI({});
    refreshTeamBuilder();
  }
}

// Leser avkryssede spillere fra flightene og (gjen)bygger TeamBuilder.
function refreshTeamBuilder() {
  const sel = document.getElementById('roundTee');
  const opt = sel?.options[sel.selectedIndex];
  const slope = parseFloat(opt?.dataset.slope) || null;
  const cr = parseFloat(opt?.dataset.cr) || null;
  const seen = {}, players = [];
  document.querySelectorAll('#flightList input[type=checkbox]:checked').forEach(cb => {
    if (seen[cb.value]) return;
    seen[cb.value] = true;
    players.push({ id: cb.value, name: (cb.dataset.name || '?').split(' ')[0], handicap: parseFloat(cb.dataset.hcp) });
  });
  TeamBuilder.mount({ container: 'teamBuilder', players, numTeams: 2, slope, cr, par: _roundCoursePar });
}

async function saveRound() {
  const courseId = document.getElementById('roundCourse').value;
  const teeId = document.getElementById('roundTee').value;
  const date = document.getElementById('roundDate').value;
  if (!courseId || !teeId || !date) { showAlert('newRoundAlert', 'Fyll inn bane, tee og dato', 'error'); return; }
  // Scramble: valider lag FØR runden opprettes (unngå foreldreløs runde).
  const isScramble = _selectedMainGame === 'scramble';
  let scrambleTeams = [];
  if (isScramble) {
    scrambleTeams = TeamBuilder.getTeams().filter(t => t.member_ids.length);
    const v = getGame('scramble').validate({ teams: scrambleTeams });
    if (!v.ok) { showAlert('newRoundAlert', v.warning, 'error'); return; }
  }
  const { hasFront9, hasBack9 } = _roundAvailableRanges;
  let holeRange;
  if (hasFront9 && hasBack9) {
    holeRange = document.getElementById('roundHoleRange')?.value || 'all';
  } else if (hasFront9) {
    holeRange = 'front9';
  } else if (hasBack9) {
    holeRange = 'back9';
  } else {
    holeRange = 'all';
  }
  const skinsAmt = document.getElementById('skinsEnabled')?.checked
    ? (parseInt(document.getElementById('skinsAmount').value) || null) : null;
  const { data: round, error } = await db.from('rounds').insert({
    course_id: courseId, tee_set_id: teeId, date, created_by: currentProfile.id, status: 'active',
    hole_range: holeRange
  }).select().single();
  if (error) { showAlert('newRoundAlert', 'Feil: ' + error.message, 'error'); return; }
  // Skins ligger nå som en games-rad i spillmotoren (rounds.skins_amount er utfaset).
  if (skinsAmt) {
    await db.from('games').insert({ round_id: round.id, game_type: 'skins', is_main: false, config: { amount: skinsAmt } });
  }
  for (let i = 1; i <= flightCount; i++) {
    const flightDiv = document.getElementById(`flight-${i}`);
    if (!flightDiv) continue;
    const checked = flightDiv.querySelectorAll('input[type=checkbox]:checked');
    if (!checked.length) continue;
    const { data: flight } = await db.from('flights').insert({ round_id: round.id, name: `Flight ${i}` }).select().single();
    for (const cb of checked) {
      await db.from('flight_players').insert({
        flight_id: flight.id, player_id: cb.value,
        handicap: parseFloat(cb.dataset.hcp) || 36, tee_set_id: teeId
      });
      if (cb.value !== currentProfile.id) {
        await db.from('notifications').insert({
          player_id: cb.value,
          message: `Du er lagt til i en runde på ${document.getElementById('roundCourse').options[document.getElementById('roundCourse').selectedIndex].text} (${date})`
        });
      }
    }
  }
  // Scramble-hovedspill: games-rad (is_main) + game_teams med frosset lag-HCP.
  if (isScramble) {
    const config = {
      scoring: document.getElementById('scrambleScoring')?.value || 'netto',
      countingDrives: document.getElementById('scrambleCountDrives')?.checked || false,
      minDrivesPerPlayer: parseInt(document.getElementById('scrambleMinDrives')?.value) || 1,
      fractionMode: 'whs',
    };
    const { data: g } = await db.from('games').insert({ round_id: round.id, game_type: 'scramble', is_main: true, config }).select().single();
    if (g) {
      for (const t of scrambleTeams) {
        await db.from('game_teams').insert({ game_id: g.id, name: t.name, member_ids: t.member_ids, team_handicap: t.team_handicap });
      }
    }
  }
  closeModal('modalNewRound');
  // Vis del-modal før scoring starter
  showShareRoundModal(round.id, document.getElementById('roundCourse').options[document.getElementById('roundCourse').selectedIndex].text, date);
  await openRound(round.id);
}

let _dashboardLoading = false;
async function loadDashboard() {
  if (_dashboardLoading) return;
  _dashboardLoading = true;
  try {
    // Fire all queries in parallel
    const [
      { data: active },
      { data: recent },
      { data: pending },
      { data: notifs },
    ] = await Promise.all([
      db.from('rounds')
        .select('*, courses(name), flights(id, flight_players(player_id))')
        .eq('status', 'active').order('created_at', { ascending: false }),
      db.from('rounds')
        .select('*, courses(name), flights(id, flight_players(player_id, handicap, profiles(display_name)))')
        .eq('status', 'completed').order('date', { ascending: false }).limit(8),
      currentProfile?.is_admin
        ? db.from('profiles').select('id').eq('is_approved', false)
        : Promise.resolve({ data: [] }),
      db.from('notifications')
        .select('id').eq('player_id', currentProfile?.id).eq('read', false),
    ]);

    // Aktiv runde
    const myActive = (active || []).filter(r =>
      r.flights?.some(f => f.flight_players?.some(fp => fp.player_id === currentProfile?.id))
    );
    const dashActive = document.getElementById('dashActiveRound');
    if (myActive.length) {
      dashActive.style.display = 'block';
      dashActive.innerHTML = `<div onclick="openRound('${myActive[0].id}')" style="padding:18px 20px; background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.3); border-radius:12px; margin-bottom:20px; cursor:pointer;">
        <div style="font-size:11px; color:var(--gold); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:6px;">🟢 Aktiv runde</div>
        <div style="font-size:18px; color:var(--cream); font-weight:500;">${myActive[0].courses?.name}</div>
        <div style="font-size:13px; color:var(--cream-dim); margin-top:4px;">${myActive[0].date} · Trykk for å fortsette</div>
      </div>`;
    } else {
      dashActive.style.display = 'none';
    }

    // Sist spilte runder
    const recentEl = document.getElementById('dashRecentRounds');
    if (!recent?.length) {
      recentEl.innerHTML = '<div style="text-align:center; padding:40px 20px; color:var(--cream-dim); font-size:14px;">Ingen runder spilt ennå</div>';
    } else {
      recentEl.innerHTML = recent.map(r => {
        const rPlayers = (r.flights || []).flatMap(f => f.flight_players || []);
        const playerNames = rPlayers.map(fp => fp.profiles?.display_name?.split(' ')[0] || '?').join(' · ');
        return `<div style="padding:14px 18px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.06); border-radius:12px; margin-bottom:8px; cursor:pointer; transition:border-color 0.2s;" onclick="showPage('rounds');" onmouseover="this.style.borderColor='rgba(201,168,76,0.25)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
            <div style="font-size:15px; color:var(--cream); font-weight:500;">${r.courses?.name || '–'}</div>
            <div style="font-size:12px; color:var(--cream-dim);">${r.date}</div>
          </div>
          <div style="font-size:12px; color:var(--cream-dim);">${playerNames || 'Ingen spillere registrert'}</div>
        </div>`;
      }).join('');
    }

    // Admin: ventende brukere
    const pendingBanner = document.getElementById('dashPendingBanner');
    if (currentProfile?.is_admin) {
      const count = pending?.length || 0;
      pendingBanner.innerHTML = count > 0 ? `
        <div style="padding:14px 18px; background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.4); border-radius:12px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <div>
            <div style="font-size:11px; color:var(--gold); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">⏳ Ventende godkjenning</div>
            <div style="font-size:15px; color:var(--cream);">${count} bruker${count === 1 ? '' : 'e'} venter</div>
          </div>
          <button onclick="openPendingUsers()" class="btn btn-auto" style="font-size:13px; padding:8px 18px; flex-shrink:0;">Godkjenn nå</button>
        </div>` : '';
    } else {
      pendingBanner.innerHTML = '';
    }

    // Notifikasjonsbadge
    const badge = document.getElementById('notifBadge');
    if (notifs?.length) {
      badge.style.display = 'inline-flex'; badge.style.alignItems = 'center'; badge.style.justifyContent = 'center';
      badge.textContent = notifs.length;
    } else {
      badge.style.display = 'none';
    }

    // HCP-motivasjon
    const motivEl = document.getElementById('dashMotivation');
    if (motivEl && currentProfile) {
      const { data: myDiffs } = await db.from('score_differentials')
        .select('date, differential, source').eq('player_id', currentProfile.id)
        .order('date', { ascending: false });
      const motiv = _calcHcpMotivation(myDiffs || [], 113, 72, 72, currentProfile?.handicap ?? null);
      motivEl.innerHTML = _renderMotivBanner(motiv);
    }

  } finally {
    _dashboardLoading = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// §2 «Start et spill»-wizard (SPILLAPP-SPEC.md §2.2) — increment B: steg 1+2.
// Egen fullskjerm-side (#newGameScreen), bundet steg-nav 1→2→3→4→Start med
// ett state-objekt som bæres gjennom stegene. Bygges PARALLELT med dagens
// modal (openNewRound), som pensjoneres i increment D.
//
// _wizState-format (bevisst): .config = hovedspillets games.config jsonb
// VERBATIM (compute + steg 4 leser uendret); .addons = [{type, config}] der
// hver = en side-games-rad. «Tellende utslag: antall, 0 = av» mapper på
// {countingDrives, minDrivesPerPlayer} slik at compute ikke må endres.
// ══════════════════════════════════════════════════════════════════════════
const WIZARD_STEPS = [
  { key: 'game',    label: 'Velg spill' },
  { key: 'course',  label: 'Bane & hull' },
  { key: 'players', label: 'Spillere & lag' },
  { key: 'spice',   label: 'Krydder' },
];
let _wizStep = 0;
let _wizState = null;
let _wizWarning = '';
// Steg 2-cacher (lette read-only henting; bane-adm. hører hjemme bak hamburger).
let _wizCourses = null;      // [{id, name}]
let _wizLastCourseId = null; // sist spilte bane (forhåndsvalgt)
let _wizCourseTees = [];     // tee-sett for valgt bane
let _wizCourseHoles = [];    // hull for valgt bane

function openNewGame() {
  _wizStep = 0;
  _wizWarning = '';
  _wizState = { mainGame: null, config: {}, courseId: null, teeId: null, holeRange: 'all', course: null, players: [], teams: [], addons: [] };
  _wizCourseTees = []; _wizCourseHoles = [];
  const scr = document.getElementById('newGameScreen');
  scr.style.display = 'flex';
  scr.style.flexDirection = 'column';
  scr.scrollTo?.(0, 0);
  renderWizard();
  _wizLoadCourses();   // async; re-rendrer steg 2 når klart
}
function closeNewGame() {
  document.getElementById('newGameScreen').style.display = 'none';
}
function wizardBack() {
  _wizWarning = '';
  if (_wizStep === 0) { closeNewGame(); return; }
  _wizStep--;
  renderWizard();
}
function wizardNext() {
  const v = _wizValidateStep(_wizStep);
  if (!v.ok) { _wizWarning = v.warning; renderWizard(); return; }
  _wizWarning = '';
  if (_wizStep >= WIZARD_STEPS.length - 1) { wizardStart(); return; }
  _wizStep++;
  renderWizard();
}
function _wizValidateStep(i) {
  const key = WIZARD_STEPS[i].key;
  if (key === 'game' && !_wizState.mainGame) return { ok: false, warning: 'Velg et spill for å gå videre.' };
  if (key === 'course') {
    if (!_wizState.courseId) return { ok: false, warning: 'Velg en bane.' };
    if (!_wizState.teeId) return { ok: false, warning: 'Velg en tee.' };
    if (!(_wizState.course?.holes || []).length) return { ok: false, warning: 'Denne banen mangler hull-data (par/SI). Velg en annen bane, eller legg inn data bak hamburger → Baner.' };
  }
  // players/spice: valideres i increment C/D
  return { ok: true };
}
function renderWizard() {
  const step = WIZARD_STEPS[_wizStep];
  const isLast = _wizStep >= WIZARD_STEPS.length - 1;
  document.getElementById('ngStepLabel').textContent = `Steg ${_wizStep + 1} av ${WIZARD_STEPS.length} · ${step.label}`;
  document.getElementById('ngBackBtn').textContent = _wizStep === 0 ? '✕' : '←';
  document.getElementById('ngNextBtn').textContent = isLast ? 'Start spillet →' : 'Neste →';
  document.getElementById('ngStepDots').innerHTML = WIZARD_STEPS.map((s, i) =>
    `<div title="${s.label}" style="width:${i === _wizStep ? '24px' : '8px'}; height:8px; border-radius:4px; background:${i < _wizStep ? 'var(--gold-dim)' : i === _wizStep ? 'var(--gold)' : 'rgba(255,255,255,0.15)'}; transition:all 0.2s;"></div>`
  ).join('');
  const warn = _wizWarning ? `<div style="background:rgba(201,168,76,0.12); border:1px solid rgba(201,168,76,0.4); color:var(--gold-light); font-size:13px; padding:10px 14px; border-radius:8px; margin-bottom:14px;">⚠️ ${_wizWarning}</div>` : '';
  const renderer = WIZARD_RENDERERS[step.key];
  const el = document.getElementById('ngStepContent');
  el.innerHTML = warn + (renderer ? renderer() : '');
  el.parentElement.scrollTo?.(0, 0);
}

// ── Steg 1: Velg spill ────────────────────────────────────────────────────
const WIZARD_RENDERERS = {
  game:    () => _wizStepGame(),
  course:  () => _wizStepCourse(),
  players: () => _wizPlaceholder('👥', 'Spillere & lag', 'Spiller-chips, inline HCP, lagbygging med «bland på nytt». (increment C)'),
  spice:   () => _wizPlaceholder('🌶️', 'Krydder', 'Foreslåtte kompatible tilleggsspill. (increment D)'),
};
function _wizStepGame() {
  return mainGames().map(g => {
    const soon = g.meta.status === 'coming_soon';
    const selected = _wizState.mainGame === g.type;
    const krav = g.meta.kreverLag ? 'Lagspill' : 'Individuelt';
    const spillere = `${g.meta.minSpillere}${g.meta.maxSpillere >= 99 ? '+' : '–' + g.meta.maxSpillere} spillere`;
    const badge = soon ? `<span style="font-size:9px;font-weight:600;color:var(--gold);border:1px solid rgba(201,168,76,0.4);border-radius:4px;padding:2px 6px;letter-spacing:0.5px;text-transform:uppercase;">Snart</span>`
      : selected ? `<span style="color:var(--gold);font-size:18px;">✓</span>` : '';
    return `<div ${soon ? '' : `onclick="wizSelectGame('${g.type}')"`} style="padding:14px 16px; margin-bottom:10px; border-radius:12px; border:1px solid ${selected ? 'var(--gold)' : 'rgba(255,255,255,0.08)'}; background:${selected ? 'rgba(201,168,76,0.1)' : 'rgba(0,0,0,0.2)'}; opacity:${soon ? '0.5' : '1'}; cursor:${soon ? 'default' : 'pointer'}; -webkit-tap-highlight-color:transparent;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="font-family:'Playfair Display',serif; font-size:17px; color:${selected ? 'var(--gold)' : 'var(--cream)'};">${g.meta.navn}</div>
        ${badge}
      </div>
      <div style="font-size:12px; color:var(--cream-dim); margin-top:4px; line-height:1.4;">${g.meta.beskrivelse}</div>
      <div style="font-size:11px; color:var(--gold-dim); margin-top:6px; letter-spacing:0.3px;">${krav} · ${spillere}</div>
      ${selected && !soon ? _wizVariantUI(g.type) : ''}
    </div>`;
  }).join('');
}
// Variantvalg per hovedspill (kun scramble har noen nå). Skriver rett i
// _wizState.config uten re-render (bevarer fokus i input).
function _wizVariantUI(type) {
  if (type !== 'scramble') return '';
  const c = _wizState.config || {};
  const drives = c.countingDrives ? (c.minDrivesPerPlayer || 1) : 0;
  const selStyle = 'padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.35);color:var(--cream);font-size:13px;';
  const opt = (v, l) => `<option value="${v}" ${c.scoring === v ? 'selected' : ''}>${l}</option>`;
  return `<div onclick="event.stopPropagation();" style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08); display:flex; flex-direction:column; gap:12px;">
    <label style="display:flex; justify-content:space-between; align-items:center; font-size:13px; color:var(--cream);">Scoring
      <select onchange="wizSetConfig('scoring', this.value)" style="${selStyle}">${opt('netto', 'Netto (mot par)')}${opt('slag', 'Brutto slag')}${opt('stableford', 'Stableford')}</select>
    </label>
    <label style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:13px; color:var(--cream);">
      <span>Tellende utslag / spiller <span style="color:var(--cream-dim); font-size:11px;">(0 = av)</span></span>
      <input type="number" min="0" max="6" value="${drives}" onchange="wizSetDrives(this.value)" style="width:56px; ${selStyle} text-align:center;">
    </label>
    ${drives > 0 ? `<div style="font-size:11px; color:var(--cream-dim);">Kvoten sjekkes mot antall hull og lagstørrelse i steg 2–3.</div>` : ''}
  </div>`;
}
function wizSelectGame(type) {
  _wizState.mainGame = type;
  const g = getGame(type);
  _wizState.config = g.defaultConfig ? g.defaultConfig() : {};
  _wizWarning = '';
  renderWizard();
}
function wizSetConfig(key, val) { _wizState.config[key] = val; }
function wizSetDrives(val) {
  const n = Math.max(0, Math.min(6, parseInt(val) || 0));
  _wizState.config.countingDrives = n > 0;
  _wizState.config.minDrivesPerPlayer = n > 0 ? n : 1;
  renderWizard();   // for å vise/skjule kvote-hintet
}

// ── Steg 2: Bane & hull (lett read-only plukker) ──────────────────────────
async function _wizLoadCourses() {
  const { data: courses } = await db.from('courses').select('id, name').order('name');
  _wizCourses = courses || [];
  const { data: last } = await db.from('rounds').select('course_id').eq('created_by', currentProfile.id).order('created_at', { ascending: false }).limit(1);
  _wizLastCourseId = last?.[0]?.course_id || null;
  if (!_wizState.courseId && _wizLastCourseId && _wizCourses.find(c => c.id === _wizLastCourseId)) {
    await wizSelectCourse(_wizLastCourseId, true);
  }
  if (WIZARD_STEPS[_wizStep].key === 'course') renderWizard();
}
async function wizSelectCourse(courseId, silent) {
  if (!courseId) {
    _wizState.courseId = null; _wizState.teeId = null; _wizState.course = null;
    _wizCourseTees = []; _wizCourseHoles = [];
    renderWizard();
    return;
  }
  _wizState.courseId = courseId;
  _wizState.teeId = null;
  const [{ data: tees }, { data: holes }] = await Promise.all([
    db.from('tee_sets').select('*').eq('course_id', courseId),
    db.from('holes').select('hole_number, par, stroke_index').eq('course_id', courseId).order('hole_number'),
  ]);
  _wizCourseTees = tees || [];
  _wizCourseHoles = holes || [];
  if (_wizCourseTees.length) _wizState.teeId = _wizCourseTees[0].id;
  _wizState.holeRange = 'all';
  _wizRecomputeCourse();
  if (!silent) renderWizard();
}
function wizSelectTee(id) { _wizState.teeId = id; _wizRecomputeCourse(); renderWizard(); }
function wizSetRange(v) { _wizState.holeRange = v; _wizRecomputeCourse(); renderWizard(); }
// Samler valgt bane/tee/range til regnegrunnlag (par=full 18 for spillende HCP,
// activeHoles=filtrert for 9-hulls). Brukes av steg 3 og wizardStart.
function _wizRecomputeCourse() {
  const holes = _wizCourseHoles || [];
  const nums = holes.map(h => h.hole_number);
  const tee = (_wizCourseTees || []).find(t => t.id === _wizState.teeId);
  const active = _wizState.holeRange === 'front9' ? holes.filter(h => h.hole_number <= 9)
    : _wizState.holeRange === 'back9' ? holes.filter(h => h.hole_number >= 10) : holes;
  _wizState.course = {
    holes, activeHoles: active,
    par: holes.reduce((s, h) => s + (h.par || 0), 0) || 72,
    holeCount: active.length,
    slope: tee?.slope ?? null, cr: tee?.course_rating ?? null,
    hasFront9: nums.some(n => n <= 9), hasBack9: nums.some(n => n >= 10),
  };
}
function _wizStepCourse() {
  if (!_wizCourses) return _wizLoadingBox('Laster baner…');
  if (!_wizCourses.length) return _wizPlaceholder('⛳', 'Ingen baner ennå', 'Legg inn en bane bak hamburger → Baner, så dukker den opp her.');
  const lblStyle = 'font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--cream-dim); display:block; margin-bottom:6px;';
  const ctrlStyle = 'width:100%; padding:12px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.3); color:var(--cream); font-size:14px; font-family:\'DM Sans\',sans-serif;';
  const courseOpts = _wizCourses.map(c => `<option value="${c.id}" ${c.id === _wizState.courseId ? 'selected' : ''}>${c.name}${c.id === _wizLastCourseId ? ' · sist spilt' : ''}</option>`).join('');
  const c = _wizState.course;
  let teeBlock = '';
  if (_wizState.courseId) {
    if (!_wizCourseTees.length) {
      teeBlock = `<div style="color:var(--cream-dim); font-size:13px; margin-top:14px;">Denne banen mangler tee-sett. Legg inn bak hamburger → Baner.</div>`;
    } else {
      const teeOpts = _wizCourseTees.map(t => `<option value="${t.id}" ${t.id === _wizState.teeId ? 'selected' : ''}>${t.name} — Slope ${t.slope}, CR ${t.course_rating}</option>`).join('');
      teeBlock = `<div style="margin-top:16px;"><label style="${lblStyle}">Tee</label>
        <select onchange="wizSelectTee(this.value)" style="${ctrlStyle}">${teeOpts}</select></div>`;
    }
  }
  let rangeBlock = '';
  if (c && c.hasFront9 && c.hasBack9) {
    const rb = (v, l) => `<button onclick="wizSetRange('${v}')" style="flex:1; padding:10px; border-radius:8px; cursor:pointer; font-size:13px; border:1px solid ${_wizState.holeRange === v ? 'var(--gold)' : 'rgba(255,255,255,0.12)'}; background:${_wizState.holeRange === v ? 'rgba(201,168,76,0.18)' : 'transparent'}; color:${_wizState.holeRange === v ? 'var(--gold)' : 'var(--cream-dim)'};">${l}</button>`;
    rangeBlock = `<div style="margin-top:16px;"><label style="${lblStyle}">Hull</label>
      <div style="display:flex; gap:6px;">${rb('all', 'Hull 1–18')}${rb('front9', 'Hull 1–9')}${rb('back9', 'Hull 10–18')}</div></div>`;
  }
  const info = (c && c.holes.length) ? `<div style="margin-top:18px; padding:12px 14px; border-radius:10px; background:rgba(82,183,136,0.08); border:1px solid rgba(82,183,136,0.2); font-size:13px; color:var(--cream);">
      Par ${c.par} · ${c.holeCount} hull${c.slope ? ` · Slope ${c.slope}, CR ${c.cr}` : ''}
    </div>` : '';
  return `<div>
    <label style="${lblStyle}">Bane</label>
    <select onchange="wizSelectCourse(this.value)" style="${ctrlStyle}">
      <option value="">Velg bane…</option>${courseOpts}
    </select>
    ${teeBlock}${rangeBlock}${info}
    <div style="margin-top:20px; font-size:11px; color:var(--cream-dim); line-height:1.5;">Baner opprettes og redigeres bak hamburger-menyen (Admin → Baner) — ikke i denne flyten.</div>
  </div>`;
}
function _wizLoadingBox(txt) {
  return `<div style="text-align:center; padding:48px 24px; color:var(--cream-dim); font-size:14px;">${txt}</div>`;
}
function _wizPlaceholder(emoji, title, desc) {
  return `<div style="text-align:center; padding:48px 24px; color:var(--cream-dim);">
    <div style="font-size:44px; margin-bottom:12px;">${emoji}</div>
    <div style="font-family:'Playfair Display',serif; font-size:20px; color:var(--cream); margin-bottom:8px;">${title}</div>
    <div style="font-size:13px; line-height:1.5; max-width:320px; margin:0 auto;">${desc}</div>
  </div>`;
}
function wizardStart() {
  // Porteres i increment C: opprett round + games (+ game_teams) fra _wizState,
  // deretter closeNewGame() + openRound(). Nå bare et hint i skallet.
  alert('Steg 1–2 står. Spillere/lag (C) + krydder & start (D) bygges videre.');
}
