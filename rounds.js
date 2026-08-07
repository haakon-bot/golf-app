// ── ROUNDS ──
async function loadRounds() {
  const { data: rounds } = await db.from('rounds')
    .select('*, courses(name), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, handicap, profiles(display_name, username)))')
    .order('created_at', { ascending: false })
    .limit(20);
  const el = document.getElementById('roundsList');
  if (!rounds?.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">⛳</div><h3>Ingen spill ennå</h3><p>Trykk "🧪 Start et spill" for å starte!</p></div>';
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
// §2 «Start et spill»-wizard (SPILLAPP-SPEC.md §2.2) — steg 1–4 + Start.
// Egen fullskjerm-side (#newGameScreen), bundet steg-nav 1→2→3→4→Start med
// ett state-objekt som bæres gjennom stegene. Den gamle ny-runde-modalen er
// pensjonert (increment D) — dette er nå eneste vei inn til å starte et spill.
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
// Edit-modus (§2.6): spilltype + bane/hull er låst mid-runde → kun steg 3+4.
const EDIT_STEPS = [
  { key: 'players', label: 'Spillere & HCP' },
  { key: 'spice',   label: 'Tilleggsspill' },
];
function _wizSteps() { return _wizEditRoundId ? EDIT_STEPS : WIZARD_STEPS; }
let _wizStep = 0;
let _wizState = null;
let _wizWarning = '';
let _wizEditRoundId = null;       // null = opprett, satt = rediger aktiv runde
let _wizPlayerScoreCount = {};    // player_id → antall hull med score (gate fjerning)
let _wizFlightId = null;          // flight for roster-mutasjoner i edit-modus
// Steg 2-cacher (lette read-only henting; bane-adm. hører hjemme bak hamburger).
let _wizCourses = null;      // [{id, name}]
let _wizLastCourseId = null; // sist spilte bane (forhåndsvalgt)
let _wizCourseTees = [];     // tee-sett for valgt bane
let _wizCourseHoles = [];    // hull for valgt bane
let _wizAllPlayers = null;   // profiles-cache for spiller-chips (steg 3)
// Gjeste-oppretting: FK profiles_id_fkey er droppet (2026-08-guest-fk-drop.sql)
// + is_guest-kolonne/RLS insert-policy på plass, så gjester kan opprettes.
const WIZ_GUEST_CREATE = true;

function openNewGame() {
  _wizStep = 0;
  _wizWarning = '';
  _wizEditRoundId = null; _wizPlayerScoreCount = {}; _wizFlightId = null;
  _wizState = { mainGame: null, config: {}, courseId: null, teeId: null, holeRange: 'all', course: null, players: [], teams: [], teamAssign: {}, numTeams: 2, flights: [], flightAssign: {}, numFlights: 1, addons: [] };
  _wizCourseTees = []; _wizCourseHoles = [];
  const scr = document.getElementById('newGameScreen');
  scr.style.display = 'flex';
  scr.style.flexDirection = 'column';
  scr.scrollTo?.(0, 0);
  renderWizard();
  _wizLoadCourses();   // async; re-rendrer steg 2 når klart
  _wizLoadPlayers();   // async; re-rendrer steg 3 når klart
}
function closeNewGame() {
  document.getElementById('newGameScreen').style.display = 'none';
  _wizEditRoundId = null;
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
  if (_wizStep >= _wizSteps().length - 1) { _wizEditRoundId ? wizardSave() : wizardStart(); return; }
  _wizStep++;
  renderWizard();
}
function _wizValidateStep(i) {
  const key = _wizSteps()[i].key;
  if (key === 'game' && !_wizState.mainGame) return { ok: false, warning: 'Velg et spill for å gå videre.' };
  if (key === 'course') {
    if (!_wizState.courseId) return { ok: false, warning: 'Velg en bane.' };
    if (!_wizState.teeId) return { ok: false, warning: 'Velg en tee.' };
    if (!(_wizState.course?.holes || []).length) return { ok: false, warning: 'Denne banen mangler hull-data (par/SI). Velg en annen bane, eller legg inn data bak hamburger → Baner.' };
  }
  if (key === 'players') {
    const g = _wizState.mainGame ? getGame(_wizState.mainGame) : null;
    const need = g?.meta.minSpillere || 1;
    if (_wizState.players.length < need) return { ok: false, warning: `Velg minst ${need} spiller${need > 1 ? 'e' : ''}.` };
    if (_wizIsTeamGame()) {
      if (_wizState.players.length > _wizMaxPlayers()) return { ok: false, warning: `Maks ${_wizMaxPlayers()} spillere i et lagspill (én flight).` };
      const teams = (_wizState.teams || []).filter(t => t.member_ids.length);
      const vt = g.validate ? g.validate({ teams }) : { ok: true };
      if (!vt.ok) return vt;
    } else if (!_wizEditRoundId) {
      // Individuelt multi-flight: maks 4 per flight (FlightBuilder skal hindre
      // dette, men valider defensivt).
      const over = (_wizState.flights || []).filter(f => f.member_ids.length > _wizMaxPlayers());
      if (over.length) return { ok: false, warning: `Maks ${_wizMaxPlayers()} spillere per flight — fordel på flere flighter.` };
    }
  }
  // spice: valideres i increment D
  return { ok: true };
}
function renderWizard() {
  const steps = _wizSteps();
  const editing = !!_wizEditRoundId;
  const step = steps[_wizStep];
  const isLast = _wizStep >= steps.length - 1;
  document.getElementById('ngStepLabel').textContent = `${editing ? 'Rediger' : 'Steg ' + (_wizStep + 1) + ' av ' + steps.length} · ${step.label}`;
  document.getElementById('ngBackBtn').textContent = _wizStep === 0 ? '✕' : '←';
  document.getElementById('ngNextBtn').textContent = isLast ? (editing ? 'Lagre endringer' : 'Start spillet →') : 'Neste →';
  document.getElementById('ngStepDots').innerHTML = steps.map((s, i) =>
    `<div title="${s.label}" style="width:${i === _wizStep ? '24px' : '8px'}; height:8px; border-radius:4px; background:${i < _wizStep ? 'var(--gold-dim)' : i === _wizStep ? 'var(--gold)' : 'rgba(255,255,255,0.15)'}; transition:all 0.2s;"></div>`
  ).join('');
  // Låst-kontekst-banner i edit-modus (spilltype + bane/hull kan ikke endres).
  const g = _wizState.mainGame ? getGame(_wizState.mainGame) : null;
  const lockBanner = editing ? `<div style="background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:var(--cream-dim);">🔒 ${g?.meta.navn || 'Spill'} · ${_wizState.courseName || ''} · ${_wizState.course?.holeCount || ''} hull <span style="color:rgba(255,255,255,0.35);">— spilltype og bane er låst i en aktiv runde</span></div>` : '';
  const warn = _wizWarning ? `<div style="background:rgba(201,168,76,0.12); border:1px solid rgba(201,168,76,0.4); color:var(--gold-light); font-size:13px; padding:10px 14px; border-radius:8px; margin-bottom:14px;">⚠️ ${_wizWarning}</div>` : '';
  const renderer = WIZARD_RENDERERS[step.key];
  const el = document.getElementById('ngStepContent');
  el.innerHTML = lockBanner + warn + (renderer ? renderer() : '');
  el.parentElement.scrollTo?.(0, 0);
  if (step.key === 'players') _wizAfterPlayers();   // mount chips/teams etter DOM finnes
}

// ── Steg 1: Velg spill ────────────────────────────────────────────────────
const WIZARD_RENDERERS = {
  game:    () => _wizStepGame(),
  course:  () => _wizStepCourse(),
  players: () => _wizStepPlayers(),
  spice:   () => _wizStepSpice(),
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
  const selStyle = 'padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.35);color:var(--cream);font-size:13px;';
  const opt = (v, l) => `<option value="${v}" ${c.scoring === v ? 'selected' : ''}>${l}</option>`;
  // Kun scoring her. «Tellende utslag» settes i steg 3 — det avhenger av lag/
  // flighter som ikke er satt opp ennå.
  return `<div onclick="event.stopPropagation();" style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08);">
    <label style="display:flex; justify-content:space-between; align-items:center; font-size:13px; color:var(--cream);">Scoring
      <select onchange="wizSetConfig('scoring', this.value)" style="${selStyle}">${opt('netto', 'Netto (mot par)')}${opt('slag', 'Brutto slag')}${opt('stableford', 'Stableford')}</select>
    </label>
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
  // Ingen re-render: kontrollen bor i steg 3 (ville re-mountet TeamBuilder).
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
  if (_wizSteps()[_wizStep].key === 'course') renderWizard();
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
// ── Steg 3: Spillere & lag ────────────────────────────────────────────────
// Inline-oppretting av spillere er UTSATT (auth-koblet i dag; gjesteprofil-
// modell + migrering kommer som egen jobb). Her: eksisterende spillere som
// chips, inline HCP, og lagbygging via TeamBuilder (løftet uendret) med
// «bland på nytt» som minimerer spredning i tildelte slag.
async function _wizLoadPlayers() {
  const { data } = await db.from('profiles').select('id, display_name, handicap, username, is_guest').order('display_name');
  _wizAllPlayers = data || [];
  if (_wizSteps()[_wizStep].key === 'players') renderWizard();
}
function _wizIsTeamGame() {
  const g = _wizState.mainGame ? getGame(_wizState.mainGame) : null;
  return !!(g && g.meta.kreverLag);
}
function _wizStepPlayers() {
  const team = _wizIsTeamGame();
  // Edit-modus + scramble: roster/lag låst → read-only lag med redigerbar lag-HCP.
  if (_wizEditRoundId && team) {
    return `<div>
      <label style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--cream-dim); display:block; margin-bottom:8px;">Lag <span style="text-transform:none; letter-spacing:0; color:rgba(255,255,255,0.35);">· sammensetning låst</span></label>
      <div id="wizEditTeams"></div>
      <div style="margin-top:14px; font-size:11px; color:var(--cream-dim); line-height:1.5;">Lag-sammensetning er låst når spillet er i gang (lag-score ville blitt meningsløs ved bytte). Du kan justere lag-HCP og tilleggsspill.</div>
    </div>`;
  }
  const teamSection = team ? `
    <div style="margin-top:24px; display:flex; align-items:center; justify-content:space-between;">
      <label style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--cream-dim);">Lag</label>
      <button onclick="wizReshuffleTeams()" style="background:none; border:1px solid rgba(201,168,76,0.35); color:var(--gold); border-radius:8px; padding:7px 12px; cursor:pointer; font-size:13px; -webkit-tap-highlight-color:transparent;">🔀 Bland på nytt</button>
    </div>
    <div id="wizTeamFairness" style="margin-top:10px;"></div>
    <div id="wizTeamBuilder" style="margin-top:12px;"></div>
    <div style="margin-top:18px; padding-top:14px; border-top:1px solid rgba(255,255,255,0.08);">
      <label style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:13px; color:var(--cream);">
        <span>Tellende utslag / spiller <span style="color:var(--cream-dim); font-size:11px;">(0 = av)</span></span>
        <input type="number" min="0" max="6" value="${_wizState.config?.countingDrives ? (_wizState.config.minDrivesPerPlayer || 1) : 0}" onchange="wizSetDrives(this.value)" style="width:56px; padding:6px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.35); color:var(--cream); font-size:13px; text-align:center;">
      </label>
      <div style="font-size:11px; color:var(--cream-dim); margin-top:6px;">Minste antall ganger hver spillers utslag må brukes. Utslags-tracker kommer.</div>
    </div>` : '';
  // Individuelt (opprett): fordel spillere på flighter (maks 4/flight). §2.5/§2.7.
  const flightSection = (!team && !_wizEditRoundId) ? `
    <div style="margin-top:24px;">
      <label style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--cream-dim);">Flighter <span style="text-transform:none; letter-spacing:0; color:rgba(255,255,255,0.35);">· maks 4 per flight</span></label>
      <div id="wizFlightBuilder" style="margin-top:12px;"></div>
    </div>` : '';
  const inpStyle = 'padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.35); color:var(--cream); font-size:14px; font-family:\'DM Sans\',sans-serif;';
  const newPlayer = `<div style="margin-top:20px;">
    <button onclick="wizToggleNewPlayer()" id="wizNewPlayerBtn" style="background:none; border:1px dashed rgba(201,168,76,0.4); color:var(--gold); border-radius:8px; padding:10px 14px; cursor:pointer; font-size:13px; width:100%; -webkit-tap-highlight-color:transparent;">➕ Ny spiller (gjest)</button>
    <div id="wizNewPlayerForm" style="display:none; margin-top:10px; padding:12px; border-radius:10px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.08);">
      <div id="wizNewPlayerAlert"></div>
      <div style="display:flex; gap:8px;">
        <input id="wizGuestName" placeholder="Navn" style="flex:2; min-width:0; ${inpStyle}">
        <input id="wizGuestHcp" type="number" step="0.1" min="-10" max="54" placeholder="HCP" style="flex:1; min-width:0; ${inpStyle} text-align:center;">
        <button onclick="wizAddGuest()" style="flex-shrink:0; background:var(--gold); border:none; color:var(--green-deep); border-radius:8px; padding:9px 14px; cursor:pointer; font-weight:600; font-size:13px;">Legg til</button>
      </div>
      <div style="font-size:11px; color:var(--cream-dim); margin-top:8px;">Gjest uten innlogging — kan kobles til en konto senere.</div>
    </div>
  </div>`;
  return `<div>
    <label style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--cream-dim); display:block; margin-bottom:8px;">Spillere</label>
    <div id="wizChips"></div>
    ${WIZ_GUEST_CREATE ? newPlayer : ''}
    ${teamSection}${flightSection}
  </div>`;
}
function wizToggleNewPlayer() {
  const f = document.getElementById('wizNewPlayerForm');
  if (!f) return;
  const open = f.style.display !== 'none';
  f.style.display = open ? 'none' : 'block';
  if (!open) document.getElementById('wizGuestName')?.focus();
}
function _wizGuestAlert(msg) {
  const el = document.getElementById('wizNewPlayerAlert');
  if (el) el.innerHTML = msg ? `<div style="color:#e8a070; font-size:12px; margin-bottom:8px;">${msg}</div>` : '';
}
// Oppretter en gjesteprofil (is_guest) med en gang, så den ikke forsvinner om
// wizarden lukkes. Krever guest-migreringen (RLS insert-policy + is_guest).
async function wizAddGuest() {
  const name = (document.getElementById('wizGuestName')?.value || '').trim();
  const hcpRaw = document.getElementById('wizGuestHcp')?.value;
  if (!name) { _wizGuestAlert('Skriv inn et navn.'); return; }
  if (_wizIsTeamGame() && _wizState.players.length >= _wizMaxPlayers()) { _wizGuestAlert(`Lagspillet er fullt (maks ${_wizMaxPlayers()} spillere i én flight).`); return; }
  const hcp = parseFloat(hcpRaw);
  const handicap = isNaN(hcp) ? 54 : hcp;
  const id = crypto.randomUUID();
  const username = 'guest_' + id.replace(/-/g, '').slice(0, 8);
  const { error } = await db.from('profiles').insert({ id, username, display_name: name, handicap, is_guest: true, is_approved: true });
  if (error) { _wizGuestAlert('Kunne ikke opprette: ' + error.message); return; }
  _wizAllPlayers.push({ id, display_name: name, handicap, username, is_guest: true });
  _wizState.players.push({ id, name: name.split(' ')[0], handicap });
  document.getElementById('wizGuestName').value = '';
  document.getElementById('wizGuestHcp').value = '';
  _wizGuestAlert('');
  _wizRenderChips();
  if (_wizIsTeamGame()) _wizMountTeams();
  else if (!_wizEditRoundId) _wizMountFlights();
}
function _wizAfterPlayers() {
  if (_wizEditRoundId && _wizIsTeamGame()) { _wizRenderEditTeams(); return; }
  _wizRenderChips();
  if (_wizIsTeamGame()) _wizMountTeams();               // scramble opprett (én flight + lag)
  else if (!_wizEditRoundId) _wizMountFlights();        // individuelt opprett: multi-flight
}
// Individuelt opprett: fordel valgte spillere på flighter (maks 4/flight).
function _wizMountFlights() {
  FlightBuilder.mount({
    container: 'wizFlightBuilder',
    players: _wizState.players,
    numFlights: _wizState.numFlights || 1,
    assign: _wizState.flightAssign || {},
    max: _wizMaxPlayers(),
    onChange: _wizFlightsChanged,
  });
}
function _wizFlightsChanged(flights, assign) {
  _wizState.flights = flights;
  _wizState.flightAssign = { ...assign };
  _wizState.numFlights = FlightBuilder._numFlights;
}
// §2.6-prinsipp: vis RÅ inndata (spiller-HCP) redigerbart, aldri de BEREGNEDE
// (lag-HCP, tildelte slag). Roster er låst — kun tallene endres.
function _wizRenderEditTeams() {
  const el = document.getElementById('wizEditTeams');
  if (!el) return;
  el.innerHTML = (_wizState.teams || []).map((t, idx) => {
    const memberRows = (t.member_ids || []).map(id => {
      const p = _wizState.players.find(x => x.id === id);
      return `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 0;">
        <span style="font-size:13px; color:var(--cream);">${p?.name || '?'}</span>
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--cream-dim);">HCP
          <input type="number" step="0.1" min="-10" max="54" value="${p?.handicap ?? ''}" onchange="wizSetScrambleHcp('${id}', ${idx}, this.value)" style="width:56px; padding:4px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.35); color:var(--cream); font-size:13px; text-align:center;"></label>
      </div>`;
    }).join('');
    const allotted = _wizAllottedForTeam(t);
    return `<div style="padding:12px 14px; margin-bottom:10px; border-radius:10px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.07);">
      <div style="font-size:14px; color:var(--cream); margin-bottom:6px;">${t.name}</div>
      ${memberRows}
      <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06); font-size:11px; color:var(--cream-dim);">Lag-HCP <span style="color:var(--gold-light);">${t.team_handicap ?? '–'}</span> · Tildelte slag <span style="color:var(--gold-light);">${allotted}</span> <span style="color:rgba(255,255,255,0.3);">— regnes ut</span></div>
    </div>`;
  }).join('');
}
// Endret spiller-HCP → utled lagets lag-HCP på nytt (WHS) + tildelte slag, live.
function wizSetScrambleHcp(playerId, teamIdx, val) {
  const p = _wizState.players.find(x => x.id === playerId);
  if (p) { const n = parseFloat(val); p.handicap = isNaN(n) ? null : n; }
  const t = _wizState.teams[teamIdx];
  const c = _wizState.course || {};
  if (t) {
    const members = (t.member_ids || []).map(id => _wizState.players.find(x => x.id === id)).filter(Boolean);
    t.team_handicap = scrambleTeamHandicap(members, c.slope, c.cr, c.par);
  }
  _wizRenderEditTeams();
}
// §2.6: fjerning blokkert til score er nullstilt. Én knapp tømmer alle hull.
async function wizNullPlayerScore(playerId) {
  const p = _wizState.players.find(x => x.id === playerId);
  const name = p?.name || 'spilleren';
  const count = _wizPlayerScoreCount[playerId] || 0;
  const ok = await showConfirm(`Nullstille alle ${name}s scorer (${count} hull)? Kan ikke angres.`, 'Nullstill');
  if (!ok) return;
  await db.from('scores').delete().eq('round_id', _wizEditRoundId).eq('player_id', playerId);
  delete _wizPlayerScoreCount[playerId];
  _wizRenderChips();
}
function _wizRenderChips() {
  const el = document.getElementById('wizChips');
  if (!el) return;
  if (!_wizAllPlayers) { el.innerHTML = _wizLoadingBox('Laster spillere…'); return; }
  const editing = !!_wizEditRoundId;
  const selById = {}; _wizState.players.forEach(p => { selById[p.id] = p; });
  const chips = _wizAllPlayers.map(p => {
    const sel = selById[p.id];
    const guestTag = p.is_guest ? `<span style="font-size:9px; color:var(--gold-dim); text-transform:uppercase; letter-spacing:0.5px;">gjest</span>` : '';
    const scored = editing && (_wizPlayerScoreCount[p.id] || 0) > 0;
    // Navnet kan klikkes for å legge til (uvalgt) eller fjerne (valgt + ingen score).
    const clickable = !sel || !scored;
    const nameSpan = `<span ${clickable ? `onclick="wizTogglePlayer('${p.id}')"` : ''} style="cursor:${clickable ? 'pointer' : 'default'}; font-size:13px; color:${sel ? 'var(--gold)' : 'var(--cream)'}; -webkit-tap-highlight-color:transparent;">${sel ? '✓ ' : ''}${(p.display_name || '?').split(' ')[0]}</span>`;
    let right;
    if (sel) {
      const hcp = `<input type="number" step="0.1" min="-10" max="54" value="${sel.handicap ?? ''}" onchange="wizSetPlayerHcp('${p.id}', this.value)" title="HCP for dette spillet" style="width:52px; padding:3px 5px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.35); color:var(--cream); font-size:12px; text-align:center;">`;
      const nullBtn = scored ? `<button onclick="wizNullPlayerScore('${p.id}')" title="Tøm alle hull for å kunne fjerne spilleren" style="background:none; border:1px solid rgba(192,57,43,0.35); color:#e8a070; border-radius:6px; padding:3px 7px; cursor:pointer; font-size:10px; -webkit-tap-highlight-color:transparent;">Nullstill</button>` : '';
      right = hcp + nullBtn;
    } else {
      right = `<span style="font-size:11px; color:var(--cream-dim);">${p.handicap ?? '–'}</span>`;
    }
    return `<div style="display:inline-flex; align-items:center; gap:8px; margin:0 8px 8px 0; padding:8px 12px; border-radius:20px; border:1px solid ${sel ? 'var(--gold)' : 'rgba(255,255,255,0.12)'}; background:${sel ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};">
      ${nameSpan}${guestTag}${right}
    </div>`;
  }).join('');
  el.innerHTML = chips + `<div style="font-size:11px; color:var(--cream-dim); margin-top:4px;">${_wizState.players.length} valgt</div>`;
}
// Effektivt spillertak: min(4, spillets maxSpillere) — ett spill = én flight (§2.5).
function _wizMaxPlayers() {
  const g = _wizState.mainGame ? getGame(_wizState.mainGame) : null;
  return Math.min(4, g?.meta.maxSpillere ?? 4);
}
function wizTogglePlayer(id) {
  const i = _wizState.players.findIndex(p => p.id === id);
  if (i >= 0) {
    // §2.6: kan ikke fjerne en spiller med score før den er nullstilt.
    if (_wizEditRoundId && (_wizPlayerScoreCount[id] || 0) > 0) {
      _wizWarning = `${_wizState.players[i].name} har score — nullstill den før du fjerner spilleren.`;
      renderWizard();
      return;
    }
    _wizState.players.splice(i, 1);
    delete _wizState.teamAssign[id];
  } else {
    // Lagspill (scramble) = én flight → tak på totalen. Individuelt = multi-
    // flight → ingen tak på totalen (FlightBuilder håndhever maks 4 per flight).
    if (_wizIsTeamGame() && _wizState.players.length >= _wizMaxPlayers()) {
      _wizWarning = `Maks ${_wizMaxPlayers()} spillere i et lagspill (én flight).`;
      renderWizard();
      return;
    }
    const p = (_wizAllPlayers || []).find(x => x.id === id);
    if (!p) return;
    _wizState.players.push({ id: p.id, name: (p.display_name || '?').split(' ')[0], handicap: p.handicap ?? 36 });
  }
  _wizWarning = '';
  _wizRenderChips();
  if (_wizIsTeamGame()) _wizMountTeams();
  else if (!_wizEditRoundId) _wizMountFlights();
}
function wizSetPlayerHcp(id, val) {
  const p = _wizState.players.find(x => x.id === id);
  if (!p) return;
  const n = parseFloat(val);
  p.handicap = isNaN(n) ? null : n;
  if (_wizIsTeamGame()) _wizMountTeams();   // lag-HCP + tildelte slag endres
}
function _wizMountTeams() {
  const c = _wizState.course || {};
  TeamBuilder.mount({
    container: 'wizTeamBuilder',
    players: _wizState.players,
    numTeams: _wizState.numTeams || 2,
    assign: _wizState.teamAssign || {},
    slope: c.slope, cr: c.cr, par: c.par,
    onChange: _wizTeamsChanged,
  });
}
function _wizTeamsChanged(teams, assign) {
  _wizState.teams = teams;
  _wizState.teamAssign = { ...assign };
  _wizState.numTeams = TeamBuilder._numTeams;
  _wizRenderFairness(teams);
}
// Tildelte slag for et lag = lag-HCP fordelt over 18 hull etter SI, filtrert
// på aktive hull (kanonisk per CLAUDE.md). _activeStrokes bor i scoring.js.
function _wizAllottedForTeam(team) {
  if (team.team_handicap == null) return 0;
  return _activeStrokes(team.team_handicap, _wizState.course?.activeHoles || []);
}
function _wizRenderFairness(teams) {
  const el = document.getElementById('wizTeamFairness');
  if (!el) return;
  const nonEmpty = (teams || []).filter(t => t.member_ids.length);
  if (nonEmpty.length < 2) { el.innerHTML = ''; return; }
  const strokes = nonEmpty.map(t => ({ name: t.name, s: _wizAllottedForTeam(t) }));
  const spread = Math.max(...strokes.map(x => x.s)) - Math.min(...strokes.map(x => x.s));
  const label = spread === 0 ? 'Helt jevnt' : spread <= 1 ? 'Svært jevnt' : spread <= 3 ? 'Ganske jevnt' : 'Skjevt';
  const color = spread <= 1 ? 'var(--green-light)' : spread <= 3 ? 'var(--gold-light)' : '#e8a070';
  const most = strokes.reduce((a, b) => b.s > a.s ? b : a);
  const least = strokes.reduce((a, b) => b.s < a.s ? b : a);
  const detail = spread === 0 ? 'Alle lag får like mange slag.' : `${most.name} får ${spread} slag mer enn ${least.name}.`;
  el.innerHTML = `<div style="padding:10px 12px; border-radius:8px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.07);">
    <div style="font-size:13px; color:${color}; font-weight:500;">⚖️ ${label} · spredning ${spread} slag</div>
    <div style="font-size:11px; color:var(--cream-dim); margin-top:2px;">${detail}</div>
    <div style="font-size:11px; color:var(--cream-dim); margin-top:6px;">${strokes.map(x => `${x.name}: ${x.s} slag`).join(' · ')}</div>
  </div>`;
}
// «Bland på nytt»: prøv mange balanserte snake-fordelinger, velg den med minst
// spredning i tildelte slag (litt slump blant like-gode → variasjon per trykk).
function wizReshuffleTeams() {
  const players = _wizState.players;
  const numTeams = _wizState.numTeams || 2;
  if (players.length < numTeams) { _wizWarning = 'For få spillere til å fylle lagene.'; renderWizard(); return; }
  const c = _wizState.course || {};
  const active = c.activeHoles || [];
  const spreadFor = (assignArr) => {
    const alloc = Array.from({ length: numTeams }, () => []);
    players.forEach((p, i) => alloc[assignArr[i]].push(p));
    const strokes = alloc.map(m => m.length ? _activeStrokes(scrambleTeamHandicap(m, c.slope, c.cr, c.par), active) : 0);
    return Math.max(...strokes) - Math.min(...strokes);
  };
  const snake = (order) => {
    const a = new Array(players.length);
    let team = 0, dir = 1;
    order.forEach(pi => { a[pi] = team; team += dir; if (team >= numTeams) { team = numTeams - 1; dir = -1; } else if (team < 0) { team = 0; dir = 1; } });
    return a;
  };
  const idxs = players.map((_, i) => i);
  const byHcp = [...idxs].sort((x, y) => (players[x].handicap ?? 36) - (players[y].handicap ?? 36));
  let best = { a: snake(byHcp) };
  best.s = spreadFor(best.a);
  for (let t = 0; t < 300; t++) {
    const order = [...idxs];
    for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    const a = snake(order);
    const s = spreadFor(a);
    if (s < best.s || (s === best.s && Math.random() < 0.35)) best = { a, s };
  }
  const map = {};
  players.forEach((p, i) => { map[p.id] = best.a[i]; });
  _wizState.teamAssign = map;
  TeamBuilder.setAssignment(map);   // → onChange → fairness oppdateres
}

// ── Steg 4: Krydder (foreslåtte tilleggsspill) ────────────────────────────
// Foreslår kompatible tillegg (addonCompatibility), inline-innstilling per
// valgt tillegg, og skjuler inkompatible med kort begrunnelse (§2.2 steg 4).
// Valgte tillegg lagres i _wizState.addons = [{type, config}] (games-rader).
function _wizStepSpice() {
  const { compatible, hidden } = addonCompatibility(_wizState.mainGame);
  const chosen = {}; (_wizState.addons || []).forEach(a => { chosen[a.type] = a; });
  const cards = compatible.length ? compatible.map(g => {
    const on = chosen[g.type];
    return `<div style="padding:14px 16px; margin-bottom:10px; border-radius:12px; border:1px solid ${on ? 'var(--gold)' : 'rgba(255,255,255,0.08)'}; background:${on ? 'rgba(201,168,76,0.1)' : 'rgba(0,0,0,0.2)'};">
      <div onclick="wizToggleAddon('${g.type}')" style="display:flex; justify-content:space-between; align-items:center; gap:10px; cursor:pointer; -webkit-tap-highlight-color:transparent;">
        <div>
          <div style="font-family:'Playfair Display',serif; font-size:16px; color:${on ? 'var(--gold)' : 'var(--cream)'};">${g.meta.navn}</div>
          <div style="font-size:12px; color:var(--cream-dim); margin-top:3px; line-height:1.4;">${g.meta.beskrivelse}</div>
        </div>
        <div style="flex-shrink:0; width:26px; height:26px; border-radius:50%; border:1px solid ${on ? 'var(--gold)' : 'rgba(255,255,255,0.2)'}; color:${on ? 'var(--gold)' : 'var(--cream-dim)'}; display:flex; align-items:center; justify-content:center; font-size:16px;">${on ? '✓' : '+'}</div>
      </div>
      ${on ? `<div onclick="event.stopPropagation();" style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08);">${_wizAddonSettingUI(g.type, on.config)}</div>` : ''}
    </div>`;
  }).join('') : `<div style="padding:20px; text-align:center; color:var(--cream-dim); font-size:13px;">Ingen tilleggsspill passer dette oppsettet ennå.</div>`;
  const hiddenNote = hidden.length ? `<div style="margin-top:14px; font-size:11px; color:var(--cream-dim); line-height:1.5;">Skjult: ${hidden.map(h => `${h.game.meta.navn} (${h.reason})`).join(' · ')}</div>` : '';
  return `<div>
    <label style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--cream-dim); display:block; margin-bottom:8px;">Tilleggsspill <span style="text-transform:none; letter-spacing:0; color:rgba(255,255,255,0.35);">· valgfritt</span></label>
    ${cards}
    ${hiddenNote}
    <div style="margin-top:24px; padding:14px 16px; border-radius:12px; background:rgba(82,183,136,0.08); border:1px solid rgba(82,183,136,0.2);">
      <div style="font-size:10px; color:var(--green-light); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:6px;">Klar til start</div>
      <div style="font-size:14px; color:var(--cream); line-height:1.5;">${_wizSummaryLine()}</div>
    </div>
  </div>`;
}
function _wizAddonSettingUI(type, config) {
  const inp = 'width:70px; padding:5px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.35); color:var(--cream); font-size:13px; text-align:center;';
  if (type === 'skins') {
    return `<label style="display:flex; align-items:center; justify-content:space-between; font-size:13px; color:var(--cream);">Kr per skin
      <input type="number" min="1" max="500" value="${config.amount ?? 50}" onchange="wizSetAddonConfig('skins','amount', parseInt(this.value)||0)" style="${inp}"></label>`;
  }
  return '';
}
function wizToggleAddon(type) {
  const i = (_wizState.addons || []).findIndex(a => a.type === type);
  if (i >= 0) _wizState.addons.splice(i, 1);
  else {
    const g = getGame(type);
    _wizState.addons.push({ type, config: g && g.defaultConfig ? g.defaultConfig() : {} });
  }
  renderWizard();
}
function wizSetAddonConfig(type, key, val) {
  const a = (_wizState.addons || []).find(a => a.type === type);
  if (a) { a.config[key] = val; renderWizard(); }
}
// Én-linjes oppsummering (§2.2): «Scramble · Grini GK · 18 hull · 2 lag · skins».
function _wizSummaryLine() {
  const parts = [];
  const g = _wizState.mainGame ? getGame(_wizState.mainGame) : null;
  if (g) parts.push(g.meta.navn);
  const cn = (_wizCourses || []).find(c => c.id === _wizState.courseId)?.name;
  if (cn) parts.push(cn);
  if (_wizState.course) parts.push(`${_wizState.course.holeCount} hull`);
  if (_wizIsTeamGame()) {
    const nt = (_wizState.teams || []).filter(t => t.member_ids.length).length;
    parts.push(`${nt} lag`);
  } else if (_wizState.players.length) {
    parts.push(`${_wizState.players.length} spillere`);
    const nf = (_wizState.flights || []).filter(f => f.member_ids.length).length;
    if (nf > 1) parts.push(`${nf} flighter`);
  }
  (_wizState.addons || []).forEach(a => { const ag = getGame(a.type); if (ag) parts.push(ag.meta.navn.toLowerCase()); });
  return parts.join(' · ');
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
// Oppretter spillet fra _wizState: round + games (hoved + evt. tillegg) +
// game_teams (scramble) + én flight med alle spillere som roster. Speiler
// speiler den tidligere saveRound (nå fjernet med den gamle modalen).
async function wizardStart() {
  const g = getGame(_wizState.mainGame);
  // Sikre at spiller/lag-kravene er oppfylt selv om vi «startet» fra steg 4.
  const pIdx = _wizSteps().findIndex(s => s.key === 'players');
  const vp = _wizValidateStep(pIdx);
  if (!vp.ok) { _wizStep = pIdx; _wizWarning = vp.warning; renderWizard(); return; }
  const btn = document.getElementById('ngNextBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starter…'; }
  const fail = (msg) => { if (btn) { btn.disabled = false; btn.textContent = 'Start spillet →'; } _wizWarning = msg; renderWizard(); };
  const date = new Date().toISOString().split('T')[0];
  const { data: round, error } = await db.from('rounds').insert({
    course_id: _wizState.courseId, tee_set_id: _wizState.teeId, date,
    created_by: currentProfile.id, status: 'active', hole_range: _wizState.holeRange,
  }).select().single();
  if (error || !round) { fail('Kunne ikke opprette spillet: ' + (error?.message || 'ukjent feil')); return; }
  // Hovedspill
  const { data: mainRow } = await db.from('games').insert({
    round_id: round.id, game_type: _wizState.mainGame, is_main: true, config: _wizState.config || {},
  }).select().single();
  // Lag (scramble): frosset lag-HCP fra oppsettet
  if (g.meta.kreverLag && mainRow) {
    for (const t of (_wizState.teams || []).filter(t => t.member_ids.length)) {
      await db.from('game_teams').insert({ game_id: mainRow.id, name: t.name, member_ids: t.member_ids, team_handicap: t.team_handicap });
    }
  }
  // Tilleggsspill (steg 4 fyller _wizState.addons; tomt i C)
  for (const a of (_wizState.addons || [])) {
    await db.from('games').insert({ round_id: round.id, game_type: a.type, is_main: false, config: a.config || {} });
  }
  // Roster: individuelt = flighter fra FlightBuilder; scramble = én flight m/ alle.
  const courseName = (_wizCourses || []).find(c => c.id === _wizState.courseId)?.name || 'en bane';
  const flights = (!g.meta.kreverLag && (_wizState.flights || []).some(f => f.member_ids.length))
    ? _wizState.flights.filter(f => f.member_ids.length)
    : [{ name: 'Flight 1', member_ids: _wizState.players.map(p => p.id) }];
  for (let i = 0; i < flights.length; i++) {
    const fl = flights[i];
    const { data: flight } = await db.from('flights').insert({ round_id: round.id, name: fl.name || `Flight ${i + 1}` }).select().single();
    if (!flight) continue;
    for (const pid of fl.member_ids) {
      const p = _wizState.players.find(x => x.id === pid);
      await db.from('flight_players').insert({ flight_id: flight.id, player_id: pid, handicap: p?.handicap ?? 36, tee_set_id: _wizState.teeId });
      if (pid !== currentProfile.id) {
        await db.from('notifications').insert({ player_id: pid, message: `Du er lagt til i et spill på ${courseName} (${date})` });
      }
    }
  }
  closeNewGame();
  await openRound(round.id);
}

// ── Edit-modus: rediger oppsett på en aktiv runde (§2.6) ──────────────────
// Åpner wizarden forhåndsutfylt, kun steg spillere/HCP + tillegg. Spilltype +
// bane/hull låst. Score-kollisjoner flagges/nektes, aldri stille ødelagt.
async function openEditGame(roundId) {
  if (!roundId) return;
  const { data: round } = await db.from('rounds')
    .select('*, courses(name), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name, username, is_guest))), games(*, game_teams(*))')
    .eq('id', roundId).single();
  if (!round) return;
  const [{ data: holes }, { data: scores }] = await Promise.all([
    db.from('holes').select('hole_number, par, stroke_index').eq('course_id', round.course_id).order('hole_number'),
    db.from('scores').select('player_id, hole_number').eq('round_id', roundId),
  ]);
  _wizPlayerScoreCount = {};
  (scores || []).forEach(s => { if (s.player_id) _wizPlayerScoreCount[s.player_id] = (_wizPlayerScoreCount[s.player_id] || 0) + 1; });
  const main = (round.games || []).find(g => g.is_main) || null;
  const addons = (round.games || []).filter(g => !g.is_main).map(g => ({ type: g.game_type, config: g.config || {} }));
  const flight = (round.flights || [])[0] || null;
  _wizFlightId = flight?.id || null;
  const allFP = (round.flights || []).flatMap(f => f.flight_players || []);
  const players = allFP.map(fp => ({ id: fp.player_id, name: (fp.profiles?.display_name || '?').split(' ')[0], handicap: fp.handicap, is_guest: fp.profiles?.is_guest, _fpId: fp.id }));
  const holeRange = round.hole_range || 'all';
  const hs = holes || [];
  const activeHoles = holeRange === 'front9' ? hs.filter(h => h.hole_number <= 9) : holeRange === 'back9' ? hs.filter(h => h.hole_number >= 10) : hs;
  const course = { holes: hs, activeHoles, par: hs.reduce((s, h) => s + (h.par || 0), 0) || 72, holeCount: activeHoles.length, slope: round.tee_sets?.slope ?? null, cr: round.tee_sets?.course_rating ?? null, hasFront9: hs.some(h => h.hole_number <= 9), hasBack9: hs.some(h => h.hole_number >= 10) };
  const teams = (main?.game_teams || []).map(t => ({ name: t.name, member_ids: t.member_ids || [], members: (t.member_ids || []).map(id => players.find(p => p.id === id)).filter(Boolean), team_handicap: t.team_handicap, _teamId: t.id }));
  _wizEditRoundId = roundId;
  _wizStep = 0;
  _wizWarning = '';
  _wizState = {
    mainGame: main?.game_type || 'stableford',
    config: main?.config || {},
    courseId: round.course_id, teeId: round.tee_set_id, holeRange, course,
    courseName: round.courses?.name || '',
    players, teams, teamAssign: {}, numTeams: teams.length || 2, addons,
    _orig: {
      players: players.map(p => ({ id: p.id, handicap: p.handicap, _fpId: p._fpId })),
      addons: addons.map(a => ({ type: a.type, config: { ...a.config } })),
      teams: teams.map(t => ({ _teamId: t._teamId, team_handicap: t.team_handicap })),
    },
  };
  const scr = document.getElementById('newGameScreen');
  scr.style.display = 'flex'; scr.style.flexDirection = 'column'; scr.scrollTo?.(0, 0);
  renderWizard();
  if (!_wizAllPlayers) _wizLoadPlayers();   // async; re-rendrer chips når klart
}

// Muterer den eksisterende runden fra _wizState (diff mot _orig). Roster-
// fjerning er allerede gated bak nullstilling, så fjernede spillere har
// ingen score å kollidere med.
async function wizardSave() {
  const pIdx = _wizSteps().findIndex(s => s.key === 'players');
  const vp = _wizValidateStep(pIdx);
  if (!vp.ok) { _wizStep = pIdx; _wizWarning = vp.warning; renderWizard(); return; }
  const btn = document.getElementById('ngNextBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Lagrer…'; }
  const rid = _wizEditRoundId;
  const g = getGame(_wizState.mainGame);
  const orig = _wizState._orig || { players: [], addons: [], teams: [] };
  try {
    if (!g.meta.kreverLag) {
      const nowById = {}; _wizState.players.forEach(p => { nowById[p.id] = p; });
      const origById = {}; orig.players.forEach(p => { origById[p.id] = p; });
      for (const op of orig.players) {
        if (!nowById[op.id] && op._fpId) await db.from('flight_players').delete().eq('id', op._fpId);
      }
      for (const np of _wizState.players) {
        const op = origById[np.id];
        if (!op) {
          if (_wizFlightId) await db.from('flight_players').insert({ flight_id: _wizFlightId, player_id: np.id, handicap: np.handicap ?? 36, tee_set_id: _wizState.teeId });
        } else if ((op.handicap ?? null) !== (np.handicap ?? null)) {
          await db.from('flight_players').update({ handicap: np.handicap ?? 36 }).eq('id', op._fpId);
        }
      }
    } else {
      // Scramble: roster låst. Skriv endrede spiller-HCP (rå inndata), utled så
      // lag-HCP på nytt via WHS-hjelperen (én kilde til sannhet).
      const origById = {}; orig.players.forEach(p => { origById[p.id] = p; });
      for (const np of _wizState.players) {
        const op = origById[np.id];
        if (op && (op.handicap ?? null) !== (np.handicap ?? null)) {
          await db.from('flight_players').update({ handicap: np.handicap ?? 36 }).eq('id', op._fpId);
        }
      }
      const hcpByPlayer = {}; _wizState.players.forEach(p => { hcpByPlayer[p.id] = p.handicap ?? 36; });
      const c = _wizState.course || {};
      await persistScrambleTeamHandicaps(
        _wizState.teams.map(t => ({ id: t._teamId, member_ids: t.member_ids, team_handicap: (orig.teams || []).find(x => x._teamId === t._teamId)?.team_handicap })),
        hcpByPlayer, c.slope, c.cr, c.par);
    }
    const nowAddon = {}; (_wizState.addons || []).forEach(a => { nowAddon[a.type] = a; });
    const origAddon = {}; (orig.addons || []).forEach(a => { origAddon[a.type] = a; });
    for (const oa of (orig.addons || [])) {
      if (!nowAddon[oa.type]) await db.from('games').delete().eq('round_id', rid).eq('game_type', oa.type).eq('is_main', false);
    }
    for (const na of (_wizState.addons || [])) {
      const oa = origAddon[na.type];
      if (!oa) await db.from('games').insert({ round_id: rid, game_type: na.type, is_main: false, config: na.config || {} });
      else if (JSON.stringify(oa.config) !== JSON.stringify(na.config)) await db.from('games').update({ config: na.config || {} }).eq('round_id', rid).eq('game_type', na.type).eq('is_main', false);
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Lagre endringer'; }
    _wizWarning = 'Kunne ikke lagre: ' + (e.message || 'ukjent feil');
    renderWizard();
    return;
  }
  closeNewGame();
  await openRound(rid);
}
