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

async function saveRound() {
  const courseId = document.getElementById('roundCourse').value;
  const teeId = document.getElementById('roundTee').value;
  const date = document.getElementById('roundDate').value;
  if (!courseId || !teeId || !date) { showAlert('newRoundAlert', 'Fyll inn bane, tee og dato', 'error'); return; }
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
  const skinsAmount = document.getElementById('skinsEnabled')?.checked
    ? (parseInt(document.getElementById('skinsAmount').value) || null) : null;
  const { data: round, error } = await db.from('rounds').insert({
    course_id: courseId, tee_set_id: teeId, date, created_by: currentProfile.id, status: 'active',
    hole_range: holeRange, skins_amount: skinsAmount
  }).select().single();
  if (error) { showAlert('newRoundAlert', 'Feil: ' + error.message, 'error'); return; }
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
