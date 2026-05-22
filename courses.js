// ── ADD COURSE FLOW ──
let _ac = {};
let _acTeeCount = 0;

function openAddCourse() {
  _ac = { step: 1, fileData: null, fileType: null, holeData: [], tees: [], detectedRange: null };
  _acTeeCount = 0;
  document.getElementById('acName').value = '';
  document.getElementById('acLocation').value = '';
  document.getElementById('acTeeRows').innerHTML = '';
  document.getElementById('acSlopeStatus').textContent = '';
  document.getElementById('acScorecardStatus').innerHTML = '';
  document.getElementById('acHoleTable').style.display = 'none';
  document.getElementById('acHoleTable').innerHTML = '';
  document.getElementById('acScorecardPreview').style.display = 'none';
  document.getElementById('acScorecardIcon').textContent = '📸';
  document.getElementById('acScorecardLabel').textContent = 'Last opp scorekort';
  document.getElementById('acAnalyzeBtn').style.display = 'none';
  document.getElementById('acSaveBtn').style.display = 'none';
  document.getElementById('acAlert').innerHTML = '';
  const slopeInput = document.getElementById('acSlopeFile');
  if (slopeInput) slopeInput.value = '';
  const scInput = document.getElementById('acScorecardFile');
  if (scInput) scInput.value = '';
  acAddTee();
  acStep(1);
  openModal('modalAddCourse');
}

function acUpdateStepIndicator(step) {
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById('acStepDot' + i);
    if (!dot) continue;
    const done = i < step;
    const active = i === step;
    dot.style.background = active ? 'var(--gold)' : done ? 'var(--green-light)' : 'rgba(255,255,255,0.1)';
    dot.style.color = (active || done) ? 'var(--green-deep)' : 'var(--cream-dim)';
    dot.textContent = done ? '✓' : String(i);
    if (i < 3) {
      const line = document.getElementById('acLine' + i);
      if (line) line.style.background = done ? 'var(--green-light)' : 'rgba(255,255,255,0.1)';
    }
  }
}

function acStep(n) {
  document.getElementById('acAlert').innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    document.getElementById('acStep' + i).style.display = i === n ? 'block' : 'none';
  }
  acUpdateStepIndicator(n);
}

function acNext(fromStep) {
  document.getElementById('acAlert').innerHTML = '';
  if (fromStep === 1) {
    const name = document.getElementById('acName').value.trim();
    if (!name) { showAlert('acAlert', 'Banenavn er påkrevd', 'error'); return; }
    _ac.name = name;
    _ac.location = document.getElementById('acLocation').value.trim();
    acStep(2);
  } else if (fromStep === 2) {
    _ac.tees = acCollectTees();
    acStep(3);
  }
}

function acSkipAndSave() {
  _ac.holeData = [];
  _ac.detectedRange = null;
  acSave();
}

function acCollectTees() {
  const tees = [];
  document.querySelectorAll('#acTeeRows .ac-tee-row').forEach(row => {
    const id = row.dataset.id;
    const name = document.getElementById('act-name-' + id)?.value?.trim();
    if (!name) return;
    tees.push({
      name,
      cr: parseFloat(document.getElementById('act-cr-' + id)?.value) || null,
      slope: parseInt(document.getElementById('act-slope-' + id)?.value) || null,
      color: document.getElementById('act-color-' + id)?.value || null
    });
  });
  return tees;
}

function acCollectHoles() {
  const isBack = _ac.detectedRange === 'back9';
  const isAll = _ac.detectedRange === 'all18';
  const startHole = isBack ? 10 : 1;
  const endHole = isAll ? 18 : (isBack ? 18 : 9);
  const holes = [];
  for (let i = startHole; i <= endHole; i++) {
    const par = parseInt(document.getElementById('ach-par-' + i)?.value || '0');
    const si = parseInt(document.getElementById('ach-si-' + i)?.value || '0');
    if (par && si) holes.push({ hole: i, par, si });
  }
  return holes;
}

function acAddTee() {
  _acTeeCount++;
  const id = _acTeeCount;
  const defaultColors = ['#FFD700', '#FFFFFF', '#3366CC', '#CC3333', '#52b788', '#222222'];
  const defaultColor = defaultColors[(id - 1) % defaultColors.length];
  const row = document.createElement('div');
  row.className = 'ac-tee-row';
  row.dataset.id = id;
  row.style.cssText = 'display:grid;grid-template-columns:1fr 56px 56px 42px auto;gap:6px;margin-bottom:8px;align-items:center;';
  const isFirst = document.querySelectorAll('#acTeeRows .ac-tee-row').length === 0;
  row.innerHTML = `
    <input type="text" id="act-name-${id}" placeholder="f.eks. Gul" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:14px;font-family:'DM Sans',sans-serif;width:100%;">
    <input type="number" id="act-cr-${id}" placeholder="71.5" step="0.1" min="55" max="85" style="padding:8px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;font-family:'DM Sans',sans-serif;text-align:center;width:100%;">
    <input type="number" id="act-slope-${id}" placeholder="113" min="55" max="155" style="padding:8px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;font-family:'DM Sans',sans-serif;text-align:center;width:100%;">
    <input type="color" id="act-color-${id}" value="${defaultColor}" style="height:38px;width:100%;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:none;cursor:pointer;padding:2px;">
    <button onclick="acRemoveTee(${id})" class="remove-btn" ${isFirst ? 'style="visibility:hidden"' : ''}>×</button>
  `;
  document.getElementById('acTeeRows').appendChild(row);
}

function acRemoveTee(id) {
  const row = document.querySelector(`.ac-tee-row[data-id="${id}"]`);
  if (row) row.remove();
}

async function acLoadSlope(file) {
  if (!file) return;
  const statusEl = document.getElementById('acSlopeStatus');
  statusEl.innerHTML = '⏳ Leser slopetabell...';
  const reader = new FileReader();
  reader.onload = async (e) => {
    const data = e.target.result.split(',')[1];
    try {
      const parsed = await callClaudeProxy(
        data, file.type,
        'Dette er en slopetabell fra en norsk golfbane. Trekk ut alle tee-sett og returner KUN gyldig JSON:\n{"tees":[{"name":"tee-navn","course_rating":72.6,"slope":129,"color":"#hexfarge"}]}\nFarger: gul=#FFD700, hvit=#FFFFFF, blå=#3366CC, rød=#CC3333, svart=#222222. Kun JSON.',
        1200
      );
      const tees = parsed.tees || [];
      document.getElementById('acTeeRows').innerHTML = '';
      _acTeeCount = 0;
      for (const t of tees) {
        _acTeeCount++;
        const id = _acTeeCount;
        const row = document.createElement('div');
        row.className = 'ac-tee-row';
        row.dataset.id = id;
        row.style.cssText = 'display:grid;grid-template-columns:1fr 56px 56px 42px auto;gap:6px;margin-bottom:8px;align-items:center;';
        row.innerHTML = `
          <input type="text" id="act-name-${id}" value="${(t.name||'').replace(/"/g,'&quot;')}" placeholder="f.eks. Gul" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:14px;font-family:'DM Sans',sans-serif;width:100%;">
          <input type="number" id="act-cr-${id}" value="${t.course_rating||''}" placeholder="71.5" step="0.1" min="55" max="85" style="padding:8px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;font-family:'DM Sans',sans-serif;text-align:center;width:100%;">
          <input type="number" id="act-slope-${id}" value="${t.slope||''}" placeholder="113" min="55" max="155" style="padding:8px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;font-family:'DM Sans',sans-serif;text-align:center;width:100%;">
          <input type="color" id="act-color-${id}" value="${t.color||'#e8c97a'}" style="height:38px;width:100%;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:none;cursor:pointer;padding:2px;">
          <button onclick="acRemoveTee(${id})" class="remove-btn">×</button>
        `;
        document.getElementById('acTeeRows').appendChild(row);
      }
      statusEl.innerHTML = `<span style="color:var(--green-light);">✅ ${tees.length} tee-sett lest inn automatisk</span>`;
    } catch(e) {
      statusEl.innerHTML = `<span style="color:var(--danger);">⚠️ Feil: ${e.message}. Fyll inn manuelt.</span>`;
    }
  };
  reader.readAsDataURL(file);
}

function acLoadScorecard(file) {
  if (!file) return;
  _ac.fileData = null;
  _ac.fileType = file.type;
  document.getElementById('acScorecardIcon').textContent = '✓';
  document.getElementById('acScorecardLabel').textContent = file.name;
  document.getElementById('acAnalyzeBtn').style.display = 'inline-flex';
  document.getElementById('acSaveBtn').style.display = 'none';
  const reader = new FileReader();
  reader.onload = (e) => {
    _ac.fileData = e.target.result.split(',')[1];
    if (file.type.startsWith('image/')) {
      document.getElementById('acScorecardPreviewImg').src = e.target.result;
      document.getElementById('acScorecardPreview').style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

async function acAnalyzeScorecard() {
  if (!_ac.fileData) return;
  const btn = document.getElementById('acAnalyzeBtn');
  btn.textContent = '⏳ Analyserer...';
  btn.disabled = true;
  const statusEl = document.getElementById('acScorecardStatus');
  statusEl.innerHTML = '<div style="color:var(--cream-dim);font-size:13px;">⏳ Sender til Claude – vent...</div>';
  try {
    const parsed = await callClaudeProxy(
      _ac.fileData, _ac.fileType,
      'Dette er et scorekort fra en norsk golfbane. Detekter hvilke hull som er med: "front9" (hull 1-9), "back9" (hull 10-18), eller "all18" (hull 1-18). Trekk ut par og SI/Index per hull. Returner KUN JSON: {"hole_range":"front9","holes":[{"hole":1,"par":4,"si":7}]}. Kun JSON.',
      2000
    );
    const holes = parsed.holes || [];
    const detectedRange = parsed.hole_range || (holes.some(h => h.hole >= 10) ? (holes.some(h => h.hole <= 9) ? 'all18' : 'back9') : 'front9');
    if (!holes.length) throw new Error('Fant ingen hull i scorekortet');
    _ac.detectedRange = detectedRange;
    _ac.holeData = holes.map(h => ({ hole: h.hole, par: h.par, si: h.si }));
    acRenderHoleTable(holes, detectedRange);
    const rangeLabel = detectedRange === 'all18' ? 'Hull 1–18' : detectedRange === 'back9' ? 'Hull 10–18 (bak 9)' : 'Hull 1–9 (front 9)';
    statusEl.innerHTML = `<div style="color:var(--green-light);font-size:13px;margin-bottom:8px;">✅ Detektert: ${rangeLabel} · ${holes.length} hull lest inn – sjekk og korriger om nødvendig</div>`;
    document.getElementById('acSaveBtn').style.display = 'inline-flex';
  } catch(e) {
    statusEl.innerHTML = `<div style="color:var(--danger);font-size:13px;">${e.message}</div>`;
  }
  btn.textContent = '📖 Les scorekort';
  btn.disabled = false;
}

function acRenderHoleTable(holes, detectedRange) {
  const isBack = detectedRange === 'back9';
  const isAll = detectedRange === 'all18';
  const startHole = isBack ? 10 : 1;
  const endHole = isAll ? 18 : (isBack ? 18 : 9);
  const siMax = 9;
  const el = document.getElementById('acHoleTable');
  el.style.display = 'block';
  el.innerHTML = '<table class="hole-table"><thead><tr><th>Hull</th><th>Par</th><th>SI</th></tr></thead><tbody>' +
    Array.from({length: endHole - startHole + 1}, (_, i) => {
      const holeNum = startHole + i;
      const h = holes.find(x => x.hole === holeNum) || {};
      return `<tr><td class="hole-num">${holeNum}</td>` +
        `<td><input type="number" id="ach-par-${holeNum}" value="${h.par||''}" min="3" max="5" style="width:60px;"></td>` +
        `<td><input type="number" id="ach-si-${holeNum}" value="${h.si||''}" min="1" max="${siMax}" style="width:60px;"></td></tr>`;
    }).join('') +
    '</tbody></table>';
}

async function acSave() {
  if (_ac.detectedRange) _ac.holeData = acCollectHoles();
  const btn = document.getElementById('acSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Lagrer...'; }
  showAlert('acAlert', '⏳ Lagrer bane...', 'success');
  try {
    const { data: course, error: ce } = await db.from('courses').insert({
      name: _ac.name,
      location: _ac.location || null,
      holes: 18,
      created_by: currentProfile?.id
    }).select().single();
    if (ce) throw new Error('Feil ved lagring av bane: ' + ce.message);
    for (const t of (_ac.tees || [])) {
      if (!t.name) continue;
      await db.from('tee_sets').insert({
        course_id: course.id, name: t.name,
        slope: t.slope || null, course_rating: t.cr || null, color: t.color || null
      });
    }
    const holeData = (_ac.holeData || []).filter(h => h.par && h.si);
    if (holeData.length > 0) {
      const { error: he } = await db.from('holes').insert(
        holeData.map(h => ({ course_id: course.id, hole_number: h.hole, par: h.par, stroke_index: h.si }))
      );
      if (he) throw new Error('Feil ved lagring av hull: ' + he.message);
    }
    showAlert('acAlert', '✅ Bane lagret!', 'success');
    loadCourses();
    setTimeout(() => { closeModal('modalAddCourse'); openCourseDetail(course.id); }, 800);
  } catch(e) {
    showAlert('acAlert', e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Lagre bane'; }
  }
}
async function loadCourses() {
  const { data: courses, error } = await db.from('courses').select('*, tee_sets(*)').order('name');
  const el = document.getElementById('coursesList');
  if (error || !courses?.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🏌️</div><h3>Ingen baner enda</h3><p>Legg til den første banen!</p></div>`;
    return;
  }
  el.innerHTML = courses.map(c => `
    <div class="course-item" onclick="openCourseDetail('${c.id}')">
      <div>
        <div class="course-name">${c.name}</div>
        <div class="course-meta">${c.location || ''} · ${c.tee_sets?.length || 0} tee-sett</div>
      </div>
      <div class="tee-dots">
        ${(c.tee_sets || []).map(t => `<div class="tee-dot" style="background:${t.color || '#888'};" title="${t.name}"></div>`).join('')}
        <span style="font-size:12px; color:var(--cream-dim); margin-left:4px;">›</span>
      </div>
    </div>
  `).join('');
}


// ── COURSE DETAIL ──
let currentCourseId = null;
async function openCourseDetail(courseId) {
  currentCourseId = courseId;
  openModal('modalCourseDetail');
  document.getElementById('detailCourseName').textContent = 'Laster...';
  const { data: course, error } = await db.from('courses').select('id, name, location, holes, created_at').eq('id', courseId).single();
  if (error || !course) { closeModal('modalCourseDetail'); alert('Kunne ikke laste bane.'); return; }
  const { data: tees } = await db.from('tee_sets').select('*').eq('course_id', courseId);
  const { data: holeRows } = await db.from('holes').select('*').eq('course_id', courseId).order('hole_number');
  const teeList = tees || [];
  const holeList = holeRows || [];
  const hasFront = holeList.some(h => h.hole_number <= 9);
  const hasBack = holeList.some(h => h.hole_number >= 10);
  const hullStatus = hasFront && hasBack ? 'Hull 1–18' : hasFront ? 'Hull 1–9' : hasBack ? 'Hull 10–18' : 'Ingen hull registrert';
  document.getElementById('detailCourseName').textContent = course.name;
  document.getElementById('courseTabInfo').innerHTML = `
    <div class="card">
      <h3 style="font-family:'Playfair Display',serif;font-size:20px;color:var(--cream);margin-bottom:12px;">${course.name}</h3>
      <div class="grid-2">
        <div><p style="font-size:12px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;">Sted</p><p style="margin-top:4px;">${course.location || '–'}</p></div>
        <div><p style="font-size:12px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;">Hull</p><p style="margin-top:4px;color:${(hasFront||hasBack)?'var(--green-light)':'var(--cream-dim)'};">${hullStatus}</p></div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 10px;">
      <h3 style="font-family:'Playfair Display',serif; font-size:16px; color:var(--cream-dim);">Tee-sett</h3>
      <button onclick="showAddTeeForm('${courseId}')" class="btn-sm">+ Legg til tee</button>
    </div>
    <div id="addTeeForm-${courseId}" style="display:none; background:rgba(0,0,0,0.2); border-radius:8px; padding:14px; margin-bottom:10px; border:1px solid rgba(201,168,76,0.2);">
      <div style="display:grid; grid-template-columns:1fr 60px 60px 44px; gap:8px; margin-bottom:10px;">
        <input type="text" id="newTee-name-${courseId}" placeholder="Navn (f.eks. 59)" style="padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif;">
        <input type="number" id="newTee-slope-${courseId}" placeholder="Slope" style="padding:8px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif; text-align:center;">
        <input type="number" id="newTee-cr-${courseId}" placeholder="CR" step="0.1" style="padding:8px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif; text-align:center;">
        <input type="color" id="newTee-color-${courseId}" value="#e8c97a" style="height:38px; width:100%; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:none; cursor:pointer; padding:2px;">
      </div>
      <div style="display:flex; gap:8px;">
        <button onclick="saveNewTee('${courseId}')" class="btn btn-auto" style="font-size:13px; padding:8px 16px;">Lagre</button>
        <button onclick="document.getElementById('addTeeForm-${courseId}').style.display='none'" class="btn btn-outline btn-auto" style="font-size:13px; padding:8px 16px;">Avbryt</button>
      </div>
    </div>
    ${teeList.map(t => `
      <div id="teeRow-${t.id}">
        <div class="player-item" style="cursor:default;">
          <div style="width:20px;height:20px;border-radius:50%;background:${t.color||'#888'};border:2px solid rgba(255,255,255,0.2);flex-shrink:0;"></div>
          <div class="player-info">
            <div class="player-name">${t.name}</div>
            <div class="player-meta">Slope: ${t.slope||'–'} · CR: ${t.course_rating||'–'}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button onclick="toggleTeeEdit('${t.id}')" style="background:none;border:1px solid rgba(201,168,76,0.3);color:var(--gold);cursor:pointer;font-size:12px;padding:4px 10px;border-radius:6px;font-family:'DM Sans',sans-serif;">Rediger</button>
            ${currentProfile?.is_admin ? `<button onclick="deleteTeeSet('${t.id}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:18px;padding:4px 8px;">🗑</button>` : ''}
          </div>
        </div>
        <div id="teeEdit-${t.id}" style="display:none; background:rgba(0,0,0,0.2); border-radius:8px; padding:14px; margin:-4px 0 8px; border:1px solid rgba(201,168,76,0.2);">
          <div style="display:grid; grid-template-columns:1fr 60px 60px 44px; gap:8px; margin-bottom:10px;">
            <input type="text" id="editName-${t.id}" value="${t.name}" placeholder="Navn" style="padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif;">
            <input type="number" id="editSlope-${t.id}" value="${t.slope||''}" placeholder="Slope" style="padding:8px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif; text-align:center;">
            <input type="number" id="editCR-${t.id}" value="${t.course_rating||''}" placeholder="CR" step="0.1" style="padding:8px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif; text-align:center;">
            <input type="color" id="editColor-${t.id}" value="${t.color||'#e8c97a'}" style="height:38px; width:100%; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:none; cursor:pointer; padding:2px;">
          </div>
          <div style="display:flex; gap:8px;">
            <button onclick="saveTeeEdit('${t.id}')" class="btn btn-auto" style="font-size:13px; padding:8px 16px;">Lagre</button>
            <button onclick="toggleTeeEdit('${t.id}')" class="btn btn-outline btn-auto" style="font-size:13px; padding:8px 16px;">Avbryt</button>
          </div>
        </div>
      </div>
    `).join('') || '<p style="color:var(--cream-dim);font-size:14px;">Ingen tee-sett registrert.</p>'}
  `;
  renderHolesTab({ id: courseId, holes: holeList });
  showCourseTab('info');
  const deleteBtn = document.getElementById('btnDeleteCourse');
  if (deleteBtn) deleteBtn.style.display = currentProfile?.is_admin ? 'inline-flex' : 'none';
}
function showCourseTab(tab) {
  document.getElementById('courseTabInfo').style.display = tab === 'info' ? 'block' : 'none';
  document.getElementById('courseTabHoles').style.display = tab === 'holes' ? 'block' : 'none';
  document.querySelectorAll('#modalCourseDetail .tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'info') || (i === 1 && tab === 'holes'));
  });
}
function renderHolesTab(course) {
  const courseId = course.id || currentCourseId;
  const existingFront = {}, existingBack = {};
  (course.holes || []).forEach(h => {
    if (h.hole_number <= 9) existingFront[h.hole_number] = h;
    else existingBack[h.hole_number] = h;
  });
  const el = document.getElementById('courseTabHoles');
  el.innerHTML = buildHoleSection('front9', 1, 9, existingFront, courseId) +
                 '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.07);margin:8px 0 20px;">' +
                 buildHoleSection('back9', 10, 18, existingBack, courseId);
}

function buildHoleSection(range, startHole, endHole, existing, courseId) {
  const hasData = Object.keys(existing).length > 0;
  const label = range === 'front9' ? 'Hull 1–9' : 'Hull 10–18';
  const statusBadge = hasData
    ? '<span style="font-size:12px;color:var(--green-light);">✓ Registrert</span>'
    : '<span style="font-size:12px;color:var(--cream-dim);">Ikke registrert</span>';
  let rows = '';
  for (let i = startHole; i <= endHole; i++) {
    const h = existing[i] || {};
    rows += `<tr><td class="hole-num">${i}</td>` +
      `<td><input type="number" id="hpar-${i}" value="${h.par||''}" placeholder="4" min="3" max="5" style="width:60px;"></td>` +
      `<td><input type="number" id="hsi-${i}" value="${h.stroke_index||''}" placeholder="${i-startHole+1}" min="1" max="9" style="width:60px;"></td></tr>`;
  }
  return `<div style="margin-bottom:4px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h4 style="font-family:'Playfair Display',serif;font-size:15px;color:var(--cream);">${label}</h4>
      ${statusBadge}
    </div>
    <div style="margin-bottom:10px;">
      <label style="padding:5px 12px;border-radius:6px;border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-size:12px;cursor:pointer;display:inline-block;">
        📸 Les scorekort
        <input type="file" accept="image/png,image/jpeg,image/jpg,application/pdf" style="display:none;"
          onchange="analyzeHullScorecard(this.files[0],'${courseId}','${range}')">
      </label>
      <div id="hullStatus-${range}" style="margin-top:6px;font-size:12px;"></div>
    </div>
    <table class="hole-table">
      <thead><tr><th>Hull</th><th>Par</th><th>SI</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="btn" onclick="saveHoles('${courseId}','${range}')" style="margin-top:12px;font-size:13px;padding:8px 20px;">Lagre ${label}</button>
    <div id="holesAlert-${range}" style="margin-top:8px;"></div>
  </div>`;
}

async function saveHoles(courseId, range) {
  const isBack = range === 'back9';
  const startHole = isBack ? 10 : 1;
  const endHole = isBack ? 18 : 9;
  const holes = [], usedSI = [], errors = [];
  for (let i = startHole; i <= endHole; i++) {
    const parVal = document.getElementById(`hpar-${i}`)?.value?.trim();
    const siVal = document.getElementById(`hsi-${i}`)?.value?.trim();
    if (!parVal && !siVal) continue;
    if (!parVal) { errors.push(`Hull ${i}: Par mangler`); continue; }
    if (!siVal)  { errors.push(`Hull ${i}: SI mangler`); continue; }
    const par = parseInt(parVal), si = parseInt(siVal);
    if (![3, 4, 5].includes(par)) { errors.push(`Hull ${i}: Par må være 3–5`); continue; }
    if (isNaN(si) || si < 1 || si > 9) { errors.push(`Hull ${i}: SI må være 1–9`); continue; }
    if (usedSI.includes(si)) { errors.push(`Hull ${i}: SI ${si} er allerede brukt`); continue; }
    usedSI.push(si);
    holes.push({ course_id: courseId, hole_number: i, par, stroke_index: si });
  }
  const alertId = `holesAlert-${range}`;
  if (errors.length) { showAlert(alertId, '⚠️ Feil:<br>' + errors.join('<br>'), 'error'); return; }
  if (!holes.length) { showAlert(alertId, 'Ingen hull å lagre', 'error'); return; }
  const { error: de } = await db.from('holes').delete().eq('course_id', courseId).gte('hole_number', startHole).lte('hole_number', endHole);
  if (de) { showAlert(alertId, 'Feil: ' + de.message, 'error'); return; }
  const { error } = await db.from('holes').insert(holes);
  if (error) { showAlert(alertId, 'Feil: ' + error.message, 'error'); return; }
  showAlert(alertId, `✅ ${holes.length} hull lagret!`, 'success');
}

// ── SLOPE UPLOAD (frittstående fra Baner-siden) ──
let _slopeFileData = null;
let _slopeFileType = null;
let _parsedTees = null;
function openSlopeUpload() {
  _slopeFileData = null;
  _parsedTees = null;
  document.getElementById('slopeStep1').style.display = 'block';
  document.getElementById('slopeStep2').style.display = 'none';
  document.getElementById('slopeStep1Actions').style.display = 'flex';
  document.getElementById('slopeUploadAlert').innerHTML = '';
  document.getElementById('slopePreview').style.display = 'none';
  document.getElementById('slopeAnalyzeBtn').style.display = 'none';
  document.getElementById('slopeFileImage').value = '';
  document.getElementById('slopeFilePDF').value = '';
  document.getElementById('slopeFileName').style.display = 'none';
  db.from('courses').select('id, name').order('name').then(({ data }) => {
    const sel = document.getElementById('slopeCourseSelect');
    sel.innerHTML = '<option value="">Velg bane...</option>' +
      (data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });
  openModal('modalSlopeUpload');
}
function _compressImage(file, maxBytes = 1_000_000) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const maxDim = 1600;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      let quality = 0.8;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.split(',')[1].length * 0.75 > maxBytes && quality > 0.05) {
        quality = +(quality - 0.1).toFixed(1);
        if (quality < 0.1) quality = 0.05;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      res({ base64: dataUrl.split(',')[1], dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Kunne ikke lese bildet')); };
    img.src = url;
  });
}
async function handleSlopeFile(file) {
  if (!file) return;
  _slopeFileType = file.type;
  const nameEl = document.getElementById('slopeFileName');
  if (nameEl) { nameEl.textContent = '✓ ' + file.name; nameEl.style.display = 'block'; }
  if (file.type.startsWith('image/')) {
    try {
      const { base64, dataUrl } = await _compressImage(file);
      _slopeFileData = base64;
      _slopeFileType = 'image/jpeg';
      document.getElementById('slopePreviewImg').src = dataUrl;
      document.getElementById('slopePreview').style.display = 'block';
    } catch(e) {
      showAlert('slopeUploadAlert', 'Kunne ikke lese bildet: ' + e.message, 'error');
      return;
    }
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      _slopeFileData = e.target.result.split(',')[1];
      document.getElementById('slopePreview').style.display = 'none';
      checkSlopeReady();
    };
    reader.readAsDataURL(file);
    return;
  }
  checkSlopeReady();
}
function checkSlopeReady() {
  const courseSelected = document.getElementById('slopeCourseSelect').value;
  const hasFile = !!_slopeFileData;
  document.getElementById('slopeAnalyzeBtn').style.display = (courseSelected && hasFile) ? 'block' : 'none';
}
async function analyzeSlopeImage() {
  const btn = document.getElementById('slopeAnalyzeBtn');
  btn.textContent = '⏳ Analyserer...';
  btn.disabled = true;
  showAlert('slopeUploadAlert', '⏳ Sender til Claude – dette tar noen sekunder...', 'success');
  try {
    const parsed = await callClaudeProxy(
      _slopeFileData, _slopeFileType,
      'Dette er en slopetabell fra en norsk golfbane. Trekk ut alle tee-sett og returner KUN gyldig JSON:\n{"course_name":"Banens navn","tees":[{"name":"tee-navn","course_rating":72.6,"slope":129,"color":"#hexfarge"}]}\nFarger: gul=#FFD700, hvit=#FFFFFF, blå=#3366CC, rød=#CC3333, svart=#222222. Kun JSON.',
      1200
    );
    _parsedTees = parsed.tees || [];
    showAlert('slopeUploadAlert', '', 'success');
    showSlopeReview(parsed);
  } catch(e) {
    showAlert('slopeUploadAlert', '⚠️ Analyse feilet: ' + e.message, 'error');
    btn.textContent = '🔍 Analyser med Claude';
    btn.disabled = false;
  }
}
function showSlopeReview(parsed) {
  document.getElementById('slopeStep1').style.display = 'none';
  document.getElementById('slopeStep1Actions').style.display = 'none';
  document.getElementById('slopeStep2').style.display = 'block';
  document.getElementById('slopeReviewContent').innerHTML = `
    ${parsed.course_name ? `<p style="font-size:14px; color:var(--gold-light); margin-bottom:16px;">📍 Bane: <strong>${parsed.course_name}</strong></p>` : ''}
    <div style="font-size:11px; color:var(--cream-dim); margin-bottom:8px; display:grid; grid-template-columns:60px 1fr 80px 80px 60px; gap:8px; padding:0 4px;">
      <span>Farge</span><span>Navn</span><span style="text-align:center;">CR</span><span style="text-align:center;">Slope</span><span></span>
    </div>
    ${(parsed.tees || []).map((t, i) => `
      <div style="display:grid; grid-template-columns:60px 1fr 80px 80px 60px; gap:8px; align-items:center; margin-bottom:8px;">
        <input type="color" id="review-color-${i}" value="${t.color || '#FFD700'}" style="height:38px; width:100%; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:none; cursor:pointer; padding:2px;">
        <input type="text" id="review-name-${i}" value="${t.name || ''}" placeholder="Navn" style="padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif;">
        <input type="number" id="review-cr-${i}" value="${t.course_rating || ''}" placeholder="CR" step="0.1" style="padding:8px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif; text-align:center;">
        <input type="number" id="review-slope-${i}" value="${t.slope || ''}" placeholder="Slope" style="padding:8px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif; text-align:center;">
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:18px;padding:4px;">×</button>
      </div>
    `).join('')}
    <button onclick="addReviewRow()" class="btn-sm" style="margin-top:8px;">+ Legg til rad</button>
  `;
}
let _reviewRowCount = 0;
function addReviewRow() {
  _reviewRowCount++;
  const i = 'new_' + _reviewRowCount;
  const div = document.createElement('div');
  div.style.cssText = 'display:grid; grid-template-columns:60px 1fr 80px 80px 60px; gap:8px; align-items:center; margin-bottom:8px;';
  div.innerHTML = `
    <input type="color" id="review-color-${i}" value="#FFD700" style="height:38px; width:100%; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:none; cursor:pointer; padding:2px;">
    <input type="text" id="review-name-${i}" value="" placeholder="Navn" style="padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif;">
    <input type="number" id="review-cr-${i}" value="" placeholder="CR" step="0.1" style="padding:8px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif; text-align:center;">
    <input type="number" id="review-slope-${i}" value="" placeholder="Slope" style="padding:8px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:var(--cream); font-size:13px; font-family:'DM Sans',sans-serif; text-align:center;">
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:18px;padding:4px;">×</button>
  `;
  document.getElementById('slopeReviewContent').appendChild(div);
}
async function saveSlopeTees() {
  const courseId = document.getElementById('slopeCourseSelect').value;
  if (!courseId) { showAlert('slopeUploadAlert', 'Velg en bane først', 'error'); return; }
  const tees = [];
  const content = document.getElementById('slopeReviewContent');
  if (_parsedTees) {
    for (let i = 0; i < _parsedTees.length; i++) {
      const name = document.getElementById(`review-name-${i}`)?.value?.trim();
      const cr = parseFloat(document.getElementById(`review-cr-${i}`)?.value);
      const slope = parseInt(document.getElementById(`review-slope-${i}`)?.value);
      const color = document.getElementById(`review-color-${i}`)?.value;
      if (name) tees.push({ course_id: courseId, name, course_rating: cr || null, slope: slope || null, color: color || null });
    }
  }
  content.querySelectorAll('div[style*="grid-template-columns"]').forEach(row => {
    const nameEl = row.querySelector('input[type="text"]');
    const inputs = row.querySelectorAll('input[type="number"]');
    const colorEl = row.querySelector('input[type="color"]');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    const cr = parseFloat(inputs[0]?.value);
    const slope = parseInt(inputs[1]?.value);
    const color = colorEl?.value;
    if (name && !tees.find(t => t.name === name)) {
      tees.push({ course_id: courseId, name, course_rating: cr || null, slope: slope || null, color: color || null });
    }
  });
  if (!tees.length) { showAlert('slopeUploadAlert', 'Ingen tee-sett å lagre', 'error'); return; }
  await db.from('tee_sets').delete().eq('course_id', courseId);
  const { error } = await db.from('tee_sets').insert(tees);
  if (error) { showAlert('slopeUploadAlert', 'Feil: ' + error.message, 'error'); return; }
  closeModal('modalSlopeUpload');
  loadCourses();
}
function backToSlopeUpload() {
  document.getElementById('slopeStep1').style.display = 'block';
  document.getElementById('slopeStep1Actions').style.display = 'flex';
  document.getElementById('slopeStep2').style.display = 'none';
  const btn = document.getElementById('slopeAnalyzeBtn');
  btn.textContent = '🔍 Analyser med Claude';
  btn.disabled = false;
}

// ── TEE SET EDIT / ADD ──
function toggleTeeEdit(teeId) {
  const el = document.getElementById('teeEdit-' + teeId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function showAddTeeForm(courseId) {
  const el = document.getElementById('addTeeForm-' + courseId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
async function saveTeeEdit(teeId) {
  const name = document.getElementById('editName-' + teeId)?.value?.trim();
  if (!name) { alert('Navn er påkrevd'); return; }
  const slope = parseInt(document.getElementById('editSlope-' + teeId)?.value) || null;
  const cr = parseFloat(document.getElementById('editCR-' + teeId)?.value) || null;
  const color = document.getElementById('editColor-' + teeId)?.value || null;
  const { error } = await db.from('tee_sets').update({ name, slope, course_rating: cr, color }).eq('id', teeId);
  if (error) { alert('Feil: ' + error.message); return; }
  openCourseDetail(currentCourseId);
}
async function saveNewTee(courseId) {
  const name = document.getElementById('newTee-name-' + courseId)?.value?.trim();
  if (!name) { alert('Navn er påkrevd'); return; }
  const slope = parseInt(document.getElementById('newTee-slope-' + courseId)?.value) || null;
  const cr = parseFloat(document.getElementById('newTee-cr-' + courseId)?.value) || null;
  const color = document.getElementById('newTee-color-' + courseId)?.value || null;
  const { error } = await db.from('tee_sets').insert({ course_id: courseId, name, slope, course_rating: cr, color });
  if (error) { alert('Feil: ' + error.message); return; }
  openCourseDetail(currentCourseId);
}

// ── DELETE FUNCTIONS ──
async function deleteCourse() {
  const courseId = currentCourseId;
  if (!courseId) return;
  const courseName = document.getElementById('detailCourseName').textContent;
  const confirmed = await showConfirm('Slette "' + courseName + '"? Dette sletter banen og alle tee-sett.');
  if (!confirmed) return;
  await db.from('rounds').update({ course_id: null }).eq('course_id', courseId);
  const { data: tees } = await db.from('tee_sets').select('id').eq('course_id', courseId);
  for (const t of (tees || [])) {
    await db.from('rounds').update({ tee_set_id: null }).eq('tee_set_id', t.id);
    await db.from('flight_players').update({ tee_set_id: null }).eq('tee_set_id', t.id);
  }
  await db.from('tee_sets').delete().eq('course_id', courseId);
  await db.from('holes').delete().eq('course_id', courseId);
  await db.from('courses').delete().eq('id', courseId);
  closeModal('modalCourseDetail');
  loadCourses();
}
async function deleteTeeSet(teeId) {
  const confirmed = await showConfirm('Slette dette tee-settet?');
  if (!confirmed) return;
  await db.from('rounds').update({ tee_set_id: null }).eq('tee_set_id', teeId);
  await db.from('flight_players').update({ tee_set_id: null }).eq('tee_set_id', teeId);
  await db.from('tee_sets').delete().eq('id', teeId);
  openCourseDetail(currentCourseId);
}

// ── HULL SCORECARD UPLOAD (fra hull-fanen) ──
async function analyzeHullScorecard(file, courseId, range) {
  if (!file) return;
  const isBack = range === 'back9';
  const startHole = isBack ? 10 : 1;
  const endHole = isBack ? 18 : 9;
  const statusEl = document.getElementById('hullStatus-' + range);
  if (statusEl) statusEl.innerHTML = '⏳ Analyserer...';
  const reader = new FileReader();
  reader.onerror = () => { if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">⚠️ Kunne ikke lese filen</span>'; };
  reader.onload = async (e) => {
    const fileData = e.target.result.split(',')[1];
    try {
      const parsed = await callClaudeProxy(
        fileData, file.type,
        `Dette er et scorekort fra en norsk golfbane med hull ${startHole} til ${endHole}. Trekk ut par og stroke index (SI/Index) per hull. Returner KUN JSON: {"holes":[{"hole":${startHole},"par":4,"si":1}]}. Kun JSON.`,
        2000
      );
      const holes = parsed.holes || [];
      if (!holes.length) throw new Error('Fant ingen hull');
      holes.forEach(h => {
        if (h.hole < startHole || h.hole > endHole) return;
        const parEl = document.getElementById('hpar-' + h.hole);
        const siEl = document.getElementById('hsi-' + h.hole);
        if (parEl) parEl.value = h.par;
        if (siEl) siEl.value = h.si;
      });
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--green-light);">✅ ${holes.length} hull lest inn – sjekk og lagre</span>`;
    } catch(err) {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">⚠️ ${err.message}</span>`;
    }
  };
  reader.readAsDataURL(file);
}
