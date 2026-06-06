// ── PROFILE ──
let _profileLoading = false;
let _profileScoreCache = null;
let _profileDiffsCache = null;
let _estimatedHCP = null;
let _profileStatTabLoaded = false;

function _makeCollapsibleHTML(id, title, contentHTML) {
  return `<div style="border-radius:12px;overflow:hidden;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);margin-bottom:2px;">
    <button onclick="_toggleSection('${id}')" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:16px 18px;background:none;border:none;color:var(--cream);cursor:pointer;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:500;text-align:left;-webkit-tap-highlight-color:transparent;">
      <span>${title}</span>
      <span id="${id}-arrow" style="font-size:10px;color:var(--cream-dim);transition:transform 0.3s ease;display:inline-block;flex-shrink:0;margin-left:12px;">▼</span>
    </button>
    <div id="${id}" style="max-height:0;overflow:hidden;transition:max-height 0.4s ease;" data-open="0" data-loaded="0">
      <div style="padding:0 18px 20px;">${contentHTML}</div>
    </div>
  </div>`;
}

function _toggleSection(id) {
  const section = document.getElementById(id);
  const arrow = document.getElementById(id + '-arrow');
  if (!section) return;
  const isOpen = section.getAttribute('data-open') === '1';
  if (isOpen) {
    section.style.maxHeight = section.scrollHeight + 'px';
    requestAnimationFrame(() => requestAnimationFrame(() => { section.style.maxHeight = '0'; }));
    section.setAttribute('data-open', '0');
    if (arrow) arrow.style.transform = '';
  } else {
    section.style.maxHeight = '4000px';
    section.setAttribute('data-open', '1');
    if (arrow) arrow.style.transform = 'rotate(180deg)';
    if (section.getAttribute('data-loaded') === '0') {
      section.setAttribute('data-loaded', '1');
      if (id === 'secRunder') _lazyLoadAlleRunder();
    }
  }
}

async function loadProfilePage() {
  if (_profileLoading) return;
  _profileLoading = true;
  _profileScoreCache = null;
  _profileDiffsCache = null;
  _profileStatTabLoaded = false;
  const p = currentProfile;
  if (!p) { _profileLoading = false; return; }
  document.getElementById('profileContent').innerHTML = `
    <div class="page-header"><div><h1>Meg</h1></div></div>
    <div class="profile-header">
      <div class="profile-avatar">${p.display_name?.[0] || '?'}</div>
      <div>
        <h2 style="font-family:'Playfair Display',serif;font-size:22px;">${p.display_name}</h2>
        <p style="color:var(--cream-dim);">@${p.username}${p.is_admin ? ' · <span class="badge badge-gold">Admin</span>' : ''}</p>
      </div>
    </div>
    <div class="tabs" style="margin-bottom:20px;">
      <button class="tab active" id="profileTabProfil" onclick="switchProfileTab('profil')"><i class="ti ti-user-circle" style="font-size:15px;vertical-align:-2px;margin-right:5px;"></i>Profil</button>
      <button class="tab" id="profileTabStats" onclick="switchProfileTab('stats')"><i class="ti ti-chart-bar" style="font-size:15px;vertical-align:-2px;margin-right:5px;"></i>Min statistikk</button>
    </div>
    <div id="profileTabContentProfil">
      <div id="statsKpis" style="margin-bottom:20px;"><div class="loading"><div class="spinner"></div></div></div>
      <div style="display:flex;flex-direction:column;gap:2px;">
        ${_makeCollapsibleHTML('secGolfbox', '<i class="ti ti-camera" style="font-size:15px;vertical-align:-2px;margin-right:6px;"></i>Importer fra Golfbox', `
          <p style="font-size:13px;color:var(--cream-dim);margin-bottom:16px;">Importer dine tidligere runder fra Golfbox ved å ta bilde av score-tabellen. Ta gjerne flere bilder til du har minst 20 runder dekket.</p>
          <button class="btn btn-outline btn-auto" onclick="openGolfboxImport()">📷 Importer fra Golfbox</button>
          <div id="golfboxImportList" style="margin-top:16px;"></div>
        `)}
        ${_makeCollapsibleHTML('secRunder', '<i class="ti ti-clipboard-list" style="font-size:15px;vertical-align:-2px;margin-right:6px;"></i>Alle runder', `
          <div id="alleRunderList"><div class="loading"><div class="spinner"></div></div></div>
        `)}
        ${_makeCollapsibleHTML('secEditProfile', '<i class="ti ti-pencil" style="font-size:15px;vertical-align:-2px;margin-right:6px;"></i>Rediger profil', `
          <div id="profileAlert"></div>
          <div class="form-group"><label>Visningsnavn</label><input type="text" id="editDisplayName" value="${p.display_name || ''}"></div>
          <div class="form-group"><label>Handicap (følg Golfbox)</label><input type="number" id="editHcp" value="${p.handicap ?? ''}" step="0.1" min="-10" max="54"></div>
          <button class="btn btn-auto" onclick="saveProfile()">Lagre endringer</button>
        `)}
        ${_makeCollapsibleHTML('secPassword', '<i class="ti ti-lock" style="font-size:15px;vertical-align:-2px;margin-right:6px;"></i>Bytt passord', `
          <p style="font-size:13px;color:var(--cream-dim);margin-bottom:16px;">Logg inn med nytt passord neste gang.</p>
          <div id="passwordAlert"></div>
          <div class="form-group"><label>Nytt passord</label><input type="password" id="newPassword1" placeholder="Minst 6 tegn"></div>
          <div class="form-group"><label>Bekreft nytt passord</label><input type="password" id="newPassword2" placeholder="Gjenta passord"></div>
          <button class="btn btn-auto" onclick="changePassword()">Endre passord</button>
        `)}
        ${p.is_admin ? _makeCollapsibleHTML('secAdmin', '<i class="ti ti-settings" style="font-size:15px;vertical-align:-2px;margin-right:6px;"></i>Admin', `
          <button class="btn btn-outline btn-auto" onclick="showPage('players')" style="width:100%;margin-bottom:8px;">Administrer spillere</button>
        `) : ''}
      </div>
    </div>
    <div id="profileTabContentStats" style="display:none;">
      <div class="loading"><div class="spinner"></div></div>
    </div>
  `;
  _profileLoading = false;
  loadAndRenderDifferentials();
}

function switchProfileTab(tab) {
  document.getElementById('profileTabProfil').classList.toggle('active', tab === 'profil');
  document.getElementById('profileTabStats').classList.toggle('active', tab === 'stats');
  document.getElementById('profileTabContentProfil').style.display = tab === 'profil' ? 'block' : 'none';
  document.getElementById('profileTabContentStats').style.display = tab === 'stats' ? 'block' : 'none';
  if (tab === 'stats' && !_profileStatTabLoaded) {
    _profileStatTabLoaded = true;
    _loadAndRenderPersonalStats();
  }
}

async function _loadAndRenderPersonalStats() {
  const el = document.getElementById('profileTabContentStats');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    if (!_profileDiffsCache) {
      const { data } = await db.from('score_differentials')
        .select('*').eq('player_id', currentProfile.id).order('date', { ascending: true });
      _profileDiffsCache = data || [];
    }
    const diffs = _profileDiffsCache;
    const cache = await _ensureProfileScoreCache(currentProfile.id, diffs, currentProfile?.handicap ?? null);
    const { holeScores, roundSummaries } = cache;
    const motiv = _calcHcpMotivation(diffs, 113, 72, 72, currentProfile?.handicap ?? null);
    el.innerHTML = `
      <div style="margin-bottom:24px;">
        <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">HCP-utvikling</div>
        ${motiv ? _renderMotivBanner(motiv) + '<div style="height:12px;"></div>' : ''}
        <div id="hcpGraph"></div>
      </div>
      <div id="personalStatsSection"></div>
    `;
    _renderHcpGraph(diffs);
    _renderPersonalStats(document.getElementById('personalStatsSection'), holeScores, roundSummaries);
  } catch (e) {
    el.innerHTML = `<div class="empty"><p style="color:var(--cream-dim);">Feil: ${e.message}</p></div>`;
  }
}

function _renderPersonalStats(el, holeScores, roundSummaries) {
  if (!el) return;
  if (!holeScores.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon" style="font-size:40px;opacity:0.4;">⛳</div><h3>Ingen app-runder</h3><p>Spill runder i appen for å se statistikk.</p></div>';
    return;
  }

  // KPI calculations
  const totalStrokes = holeScores.reduce((s, h) => s + h.strokes, 0);
  const totalHoles = holeScores.length;
  const avgStrokes18 = Math.round(totalStrokes / totalHoles * 18);

  // Normalize SF: 9-hole rounds get netto par (2p) for each unplayed hole
  const normalizedSFs = roundSummaries.map(r => r.sf + Math.max(0, 18 - r.played) * 2);
  const avgSF18 = normalizedSFs.length ? (normalizedSFs.reduce((s, v) => s + v, 0) / normalizedSFs.length).toFixed(1) : null;
  const bestRound = normalizedSFs.length ? Math.max(...normalizedSFs) : null;
  const totalRounds = roundSummaries.length;

  // Per-par averages
  const byPar = { 3: [], 4: [], 5: [] };
  for (const s of holeScores) { if (byPar[s.par]) byPar[s.par].push(s.sf); }

  // Scoring distribution
  const scoreDist = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
  for (const s of holeScores) {
    const v = s.strokes - s.par;
    if (v <= -2) scoreDist.eagle++;
    else if (v === -1) scoreDist.birdie++;
    else if (v === 0) scoreDist.par++;
    else if (v === 1) scoreDist.bogey++;
    else scoreDist.double++;
  }

  // Top 3 best holes
  const byKey = {};
  for (const s of holeScores) {
    const k = s.courseId + ':' + s.holeNumber;
    if (!byKey[k]) byKey[k] = { hole: s.holeNumber, par: s.par, course: s.courseName, total: 0, count: 0 };
    byKey[k].total += s.sf;
    byKey[k].count++;
  }
  const topHoles = Object.values(byKey)
    .filter(h => h.count >= 2)
    .map(h => ({ ...h, avg: h.total / h.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3);

  const distItems = [
    { key: 'eagle', label: 'Eagle', color: '#c9a84c' },
    { key: 'birdie', label: 'Birdie', color: '#85b7eb' },
    { key: 'par', label: 'Par', color: '#52b788' },
    { key: 'bogey', label: 'Bogey', color: '#f09595' },
    { key: 'double', label: 'Double+', color: '#e24b4a' },
  ];
  const maxDist = Math.max(...distItems.map(d => scoreDist[d.key]), 1);
  const totalDist = distItems.reduce((s, d) => s + scoreDist[d.key], 0);
  const medals = ['🥇', '🥈', '🥉'];
  const card = (label, value, sub) => `<div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:14px 8px;text-align:center;border:1px solid rgba(255,255,255,0.07);">
    <div style="font-size:9px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${label}</div>
    <div style="font-family:'Playfair Display',serif;font-size:26px;color:var(--gold);line-height:1;">${value}</div>
    <div style="font-size:10px;color:var(--cream-dim);margin-top:4px;">${sub}</div>
  </div>`;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:24px;">
      ${card('Snitt Stableford 18h', avgSF18 ?? '–', totalRounds + ' runde' + (totalRounds !== 1 ? 'r' : ''))}
      ${card('Snitt slag 18h', avgStrokes18, totalHoles + ' hull spilt')}
      ${card('Beste runde', bestRound ?? '–', 'Stableford')}
      ${card('Antall runder', totalRounds, 'i appen')}
    </div>
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Snitt Stableford per partype</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        ${[3, 4, 5].map(par => {
          const arr = byPar[par];
          const avg = arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '–';
          return `<div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 10px;text-align:center;">
            <div style="font-size:11px;color:var(--cream-dim);margin-bottom:6px;">Par ${par}</div>
            <div style="font-size:26px;font-weight:700;color:var(--gold);">${avg}</div>
            <div style="font-size:10px;color:var(--cream-dim);margin-top:3px;">${arr.length} hull</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Scorefordeling</div>
      <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px;">
        ${distItems.map(d => {
          const count = scoreDist[d.key];
          const pct = totalDist > 0 ? (count / totalDist * 100).toFixed(1) : '0.0';
          const barW = (count / maxDist * 100).toFixed(1);
          return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="width:64px;font-size:13px;color:var(--cream-dim);flex-shrink:0;">${d.label}</div>
            <div style="flex:1;background:rgba(255,255,255,0.06);border-radius:4px;height:18px;overflow:hidden;">
              <div style="height:100%;width:${barW}%;background:${d.color};border-radius:4px;"></div>
            </div>
            <div style="min-width:36px;text-align:right;font-size:13px;color:var(--cream);">${count}</div>
            <div style="min-width:40px;text-align:right;font-size:11px;color:var(--cream-dim);">${pct}%</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${topHoles.length ? `
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Beste hull (snitt Stableford)</div>
      ${topHoles.map((h, i) => `
        <div style="display:flex;align-items:center;gap:14px;padding:13px 16px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:10px;margin-bottom:8px;">
          <div style="font-size:20px;flex-shrink:0;">${medals[i]}</div>
          <div style="flex:1;">
            <div style="font-size:15px;color:var(--cream);font-weight:500;">Hull ${h.hole}</div>
            <div style="font-size:12px;color:var(--cream-dim);margin-top:2px;">Par ${h.par} · ${h.course}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:20px;font-weight:700;color:var(--gold);">${h.avg.toFixed(2)}</div>
            <div style="font-size:10px;color:var(--cream-dim);">${h.count} runder</div>
          </div>
        </div>`).join('')}
    </div>` : ''}
  `;
}

async function _ensureProfileScoreCache(profileId, diffs, currentHI) {
  if (_profileScoreCache) return _profileScoreCache;
  const hiNum = currentHI != null ? parseFloat(currentHI) : null;
  const { data: scoreRows } = await db.from('scores').select('round_id,hole_number,strokes')
    .eq('player_id', profileId).gt('strokes', 0);
  if (!scoreRows?.length) { _profileScoreCache = { holeScores: [], roundSummaries: [] }; return _profileScoreCache; }
  const roundIds = [...new Set(scoreRows.map(s => s.round_id))];
  const { data: roundRows } = await db.from('rounds')
    .select('id,date,hole_range,course_id,tee_set_id,courses(name),tee_sets(slope,course_rating)')
    .in('id', roundIds).order('date', { ascending: false });
  const roundMap = {};
  for (const r of (roundRows || [])) roundMap[r.id] = { ...r, scoreMap: {} };
  for (const s of scoreRows) { if (roundMap[s.round_id]) roundMap[s.round_id].scoreMap[s.hole_number] = s.strokes; }
  const courseIds = [...new Set((roundRows || []).map(r => r.course_id).filter(Boolean))];
  const holesByCourse = {};
  if (courseIds.length) {
    const { data: allHoles } = await db.from('holes').select('course_id,hole_number,par,stroke_index').in('course_id', courseIds);
    (allHoles || []).forEach(h => { (holesByCourse[h.course_id] = holesByCourse[h.course_id] || {})[h.hole_number] = h; });
  }
  const holeScores = [], roundSummaries = [];
  for (const round of Object.values(roundMap)) {
    const courseHoles = Object.values(holesByCourse[round.course_id] || {});
    if (!courseHoles.length) continue;
    const holeRange = round.hole_range || 'all';
    const relevant = holeRange === 'front9' ? courseHoles.filter(h => h.hole_number <= 9)
      : holeRange === 'back9' ? courseHoles.filter(h => h.hole_number >= 10) : courseHoles;
    if (!relevant.length) continue;
    const coursePar = courseHoles.reduce((s, h) => s + (h.par || 0), 0) || 72;
    const slope = round.tee_sets?.slope || 113, cr = round.tee_sets?.course_rating || 72;
    const matchDiff = (diffs || []).find(d => d.date === round.date && d.source === 'fore');
    const hi = matchDiff?.hcp_before ?? hiNum ?? 36;
    const hcp = _playingHcp(hi, slope, cr, coursePar);
    let roundTotal = 0, played = 0;
    for (const hole of relevant) {
      const strokes = round.scoreMap[hole.hole_number];
      if (!strokes || strokes <= 0) continue;
      played++;
      const sf = calcStableford(strokes, hole.par, hcp, hole.stroke_index);
      roundTotal += sf;
      holeScores.push({ date: round.date, roundId: round.id, courseId: round.course_id,
        courseName: round.courses?.name || '–', holeNumber: hole.hole_number, par: hole.par, sf, strokes });
    }
    if (played >= Math.ceil(relevant.length * 0.5)) {
      roundSummaries.push({ id: round.id, date: round.date, courseName: round.courses?.name || '–',
        holeRange, sf: roundTotal, played, totalH: relevant.length,
        is18: holeRange === 'all' && relevant.length > 9 && played >= Math.ceil(relevant.length * 0.7) });
    }
  }
  roundSummaries.sort((a, b) => new Date(b.date) - new Date(a.date));
  _profileScoreCache = { holeScores, roundSummaries };
  return _profileScoreCache;
}

async function _lazyLoadHullStats() {
  const el = document.getElementById('hullStats');
  if (!el) return;
  const diffs = _profileDiffsCache || [];
  const cache = await _ensureProfileScoreCache(currentProfile.id, diffs, currentProfile?.handicap ?? null);
  const { holeScores } = cache;
  if (!holeScores.length) { el.innerHTML = '<p style="font-size:13px;color:var(--cream-dim);">Ingen app-runder ennå.</p>'; return; }

  // Par-type aggregates
  const byPar = { 3: [], 4: [], 5: [] };
  for (const s of holeScores) { if (byPar[s.par]) byPar[s.par].push(s.sf); }
  const parCard = (p) => {
    const arr = byPar[p];
    if (!arr.length) return `<div style="flex:1;background:rgba(0,0,0,0.25);border-radius:10px;padding:12px 8px;text-align:center;border:1px solid rgba(255,255,255,0.07);">
      <div style="font-size:9px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Par ${p}</div>
      <div style="font-family:'Playfair Display',serif;font-size:24px;color:var(--cream-dim);">–</div></div>`;
    const avg = (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
    const best = Math.max(...arr);
    const col = parseFloat(avg) >= 2 ? 'var(--green-light)' : parseFloat(avg) >= 1.5 ? 'var(--gold-light)' : 'var(--cream)';
    return `<div style="flex:1;background:rgba(0,0,0,0.25);border-radius:10px;padding:12px 8px;text-align:center;border:1px solid rgba(255,255,255,0.07);">
      <div style="font-size:9px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Par ${p}</div>
      <div style="font-family:'Playfair Display',serif;font-size:24px;color:${col};line-height:1;">${avg}</div>
      <div style="font-size:10px;color:var(--cream-dim);margin-top:4px;">${arr.length} hull · beste ${best}p</div>
    </div>`;
  };

  // Per-hole aggregates
  const byKey = {};
  for (const s of holeScores) {
    const key = s.courseId + ':' + s.holeNumber;
    if (!byKey[key]) byKey[key] = { holeNumber: s.holeNumber, courseName: s.courseName, par: s.par, scores: [] };
    byKey[key].scores.push(s.sf);
  }
  const avgs = Object.values(byKey).filter(h => h.scores.length >= 2).map(h => ({
    ...h, avg: h.scores.reduce((a, b) => a + b, 0) / h.scores.length, count: h.scores.length
  }));
  const row = (h, i, good) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:22px;height:22px;border-radius:50%;background:${good ? 'rgba(82,183,136,0.2)' : 'rgba(192,57,43,0.15)'};display:flex;align-items:center;justify-content:center;font-size:10px;color:${good ? 'var(--green-light)' : '#e88'};flex-shrink:0;">${i + 1}</div>
      <div>
        <div style="font-size:13px;color:var(--cream);">Hull ${h.holeNumber} <span style="color:var(--cream-dim);font-size:11px;">Par ${h.par}</span></div>
        <div style="font-size:11px;color:var(--cream-dim);">${h.courseName} · ${h.count} runder</div>
      </div>
    </div>
    <div style="font-family:'Playfair Display',serif;font-size:18px;color:${good ? 'var(--green-light)' : '#e88'};">${h.avg.toFixed(1)}p</div>
  </div>`;

  const parSection = `<div style="margin-bottom:20px;">
    <div style="font-size:10px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">Snitt per par-type</div>
    <div style="display:flex;gap:10px;">${parCard(3)}${parCard(4)}${parCard(5)}</div>
  </div>`;

  if (avgs.length < 3) {
    el.innerHTML = parSection + '<p style="font-size:13px;color:var(--cream-dim);">Trenger flere runder for hull-for-hull-statistikk (minst 2 runder per hull).</p>';
    return;
  }
  const best = [...avgs].sort((a, b) => b.avg - a.avg).slice(0, 5);
  const worst = [...avgs].sort((a, b) => a.avg - b.avg).slice(0, 5);
  el.innerHTML = parSection + `<div style="margin-bottom:20px;">
    <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">Beste hull historisk</div>
    ${best.map((h, i) => row(h, i, true)).join('')}
  </div>
  <div>
    <div style="font-size:10px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">Tøffeste hull historisk</div>
    ${worst.map((h, i) => row(h, i, false)).join('')}
  </div>`;
}

async function _lazyLoadAlleRunder() {
  const el = document.getElementById('alleRunderList');
  if (!el) return;
  const diffs = _profileDiffsCache || [];
  const cache = await _ensureProfileScoreCache(currentProfile.id, diffs, currentProfile?.handicap ?? null);
  const appRounds = cache.roundSummaries.map(r => ({
    date: r.date, label: r.courseName,
    sub: r.holeRange === 'front9' ? 'Hull 1–9' : r.holeRange === 'back9' ? 'Hull 10–18' : 'Full runde',
    right: r.sf + 'p', source: 'fore'
  }));
  const imported = diffs.filter(d => d.source !== 'fore').map(d => ({
    date: d.date, label: d.course_name || 'Importert runde',
    sub: 'Diff: ' + (d.differential ?? '–') + (d.hcp_after != null ? ' · HCP ' + d.hcp_after : ''),
    right: d.source || 'golfbox', source: d.source
  }));
  const all = [...appRounds, ...imported].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!all.length) { el.innerHTML = '<p style="font-size:13px;color:var(--cream-dim);">Ingen runder registrert ennå.</p>'; return; }
  el.innerHTML = all.map(r => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
    <div style="min-width:0;">
      <div style="font-size:13px;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.date} · ${r.label}</div>
      <div style="font-size:11px;color:var(--cream-dim);margin-top:2px;">${r.sub}</div>
    </div>
    <div style="font-family:${r.source === 'fore' ? "'Playfair Display',serif" : "'DM Sans',sans-serif"};font-size:${r.source === 'fore' ? '16' : '11'}px;color:${r.source === 'fore' ? 'var(--gold)' : 'var(--cream-dim)'};flex-shrink:0;${r.source !== 'fore' ? 'background:rgba(201,168,76,0.12);padding:2px 7px;border-radius:4px;' : ''}">${r.right}</div>
  </div>`).join('');
}

async function changePassword() {
  const p1 = document.getElementById('newPassword1').value;
  const p2 = document.getElementById('newPassword2').value;
  if (!p1 || p1.length < 6) { showAlert('passwordAlert', 'Passord må være minst 6 tegn', 'error'); return; }
  if (p1 !== p2) { showAlert('passwordAlert', 'Passordene er ikke like', 'error'); return; }
  const { error } = await db.auth.updateUser({ password: p1 });
  if (error) { showAlert('passwordAlert', 'Feil: ' + error.message, 'error'); return; }
  showAlert('passwordAlert', '✅ Passord endret!', 'success');
  document.getElementById('newPassword1').value = '';
  document.getElementById('newPassword2').value = '';
}
async function saveProfile() {
  const displayName = document.getElementById('editDisplayName').value.trim();
  const hcp = parseFloat(document.getElementById('editHcp').value);
  const hasImported = (_profileDiffsCache || []).some(d => d.source === 'gimmie' || d.source === 'golfbox');
  if (hasImported && hcp !== currentProfile.handicap) {
    const ok = confirm('Du har Golfbox-historikk lastet inn. Er du sikker på at du vil overskrive HCP manuelt?');
    if (!ok) return;
  }
  const { error } = await db.from('profiles').update({ display_name: displayName, handicap: hcp }).eq('id', currentProfile.id);
  if (error) { showAlert('profileAlert', 'Feil: ' + error.message, 'error'); return; }
  currentProfile.display_name = displayName;
  currentProfile.handicap = hcp;
  showAlert('profileAlert', 'Profil oppdatert!', 'success');
  const _tu = document.getElementById('topbarUsername'); if (_tu) _tu.textContent = currentProfile.username;
}

// ── HCP MOTIVATION ENGINE ──
// WHS lookup: index = number of differentials available (0-20) → number to use
const _WHS_TABLE = [0,0,0,1,1,1,2,2,2,3,3,3,4,4,4,5,5,5,6,7,8];

function _calcHcpIndexWHS(sortedDiffsAsc) {
  const n = Math.min(sortedDiffsAsc.length, 20);
  const use = n < _WHS_TABLE.length ? _WHS_TABLE[n] : 8;
  if (!use) return null;
  return +(sortedDiffsAsc.slice(0, use).reduce((s, d) => s + d, 0) / use * 0.96).toFixed(1);
}

// Pure WHS simulation: take 20 most recent differentials, find best 8, avg × 0.96 = currentHI.
// Simulates next round: oldest of the 20 drops out, new differential comes in.
// Validated against Golfbox: diff 18.0 → 21.1→20.4, diff 19.6 → 21.3→20.9.
function _calcHcpMotivation(diffs, slope = 113, courseRating = 72, coursePar = 72, knownHI = null) {
  const withDiff = (diffs || []).filter(d => d.differential != null && d.source !== 'fore');
  if (withDiff.length < 8) return null;
  const byDate = [...withDiff].sort((a, b) => new Date(b.date) - new Date(a.date));
  const last20 = byDate.slice(0, 20);
  const sortedAsc = last20.map(d => parseFloat(d.differential)).sort((a, b) => a - b);
  const currentHI = knownHI != null ? parseFloat(knownHI) : _calcHcpIndexWHS(sortedAsc);
  if (currentHI === null) return null;
  // Playing HCP for actual tee (shown per tee in new round flow)
  const playingHCP = Math.round(currentHI * slope / 113 + (courseRating - coursePar));
  // Stableford thresholds always on normalbane (course-independent): round(36 + normHCP - diff)
  const normHCP = Math.round(currentHI);
  const toNorm = diff => Math.round(36 + normHCP - diff);
  const stablefordImprove = toNorm(sortedAsc[7]) + 1;
  const droppedRound = last20.length >= 20 ? last20[19] : null;
  const stablefordDecline = droppedRound ? toNorm(parseFloat(droppedRound.differential)) : null;
  const droppedDiff = droppedRound ? parseFloat(droppedRound.differential) : null;
  const droppedContext = droppedDiff != null ? (droppedDiff < currentHI ? 'good_drop' : 'bad_drop') : null;
  const droppedDate = droppedRound?.date ?? null;
  return { currentHI, playingHCP, stablefordImprove, stablefordDecline, droppedContext, droppedDate, count: last20.length };
}

function _renderMotivBanner(motiv) {
  if (!motiv?.droppedContext) return '';
  if (motiv.droppedContext === 'good_drop') {
    return `<div style="background:rgba(255,140,50,0.08);border:1px solid rgba(255,140,50,0.3);border-radius:10px;padding:12px 16px;font-size:13px;color:rgba(255,180,100,0.9);">En god runde faller ut — vær obs på HCP!</div>`;
  }
  return `<div style="background:rgba(82,183,136,0.08);border:1px solid rgba(82,183,136,0.3);border-radius:10px;padding:12px 16px;font-size:13px;color:rgba(82,183,136,0.9);">En dårlig runde faller ut — godt utgangspunkt!</div>`;
}

async function updateRoundMotivation() {
  const teeId = document.getElementById('roundTee').value;
  const el = document.getElementById('teeMotivDiv');
  if (!el) return;
  if (!teeId) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="font-size:12px;color:var(--cream-dim);padding:8px 0;">⏳ Beregner HCP-mål...</div>';
  try {
    const { data: tee } = await db.from('tee_sets').select('slope,course_rating,course_id').eq('id', teeId).single();
    if (!tee?.slope || !tee?.course_rating) { el.innerHTML = ''; return; }
    const slope = tee.slope, cr = tee.course_rating;
    const { data: courseHoles } = await db.from('holes').select('hole_number,par,stroke_index').eq('course_id', tee.course_id);
    const holeRange = document.getElementById('roundHoleRange')?.value || 'all';
    const par = (courseHoles||[]).reduce((s,h) => s + (h.par||0), 0) || 72;
    const motivActiveHoles = holeRange === 'front9' ? (courseHoles||[]).filter(h => h.hole_number <= 9)
      : holeRange === 'back9' ? (courseHoles||[]).filter(h => h.hole_number >= 10)
      : (courseHoles||[]);
    const playerIds = allPlayers.map(p => p.id);
    if (!playerIds.length) { el.innerHTML = ''; return; }
    const { data: allDiffs } = await db.from('score_differentials').select('player_id,date,differential,source').in('player_id', playerIds);
    const byPlayer = {};
    (allDiffs || []).forEach(d => { (byPlayer[d.player_id] = byPlayer[d.player_id] || []).push(d); });
    const courseName = document.getElementById('roundCourse').options[document.getElementById('roundCourse').selectedIndex]?.text || '';
    const playerRows = allPlayers
      .map(p => ({ p, motiv: _calcHcpMotivation(byPlayer[p.id] || [], slope, cr, par, p.handicap ?? null) }))
      .filter(({ motiv }) => motiv !== null)
      .map(({ p, motiv }) => {
        const X = motiv.stablefordImprove, Y = motiv.stablefordDecline;
        const activeS = _activeStrokes(motiv.playingHCP, motivActiveHoles);
        return `
        <div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
            <div style="font-size:13px;color:var(--cream);">${p.display_name}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.4);">Tildelte slag: ${activeS}</div>
          </div>
          <div style="font-size:12px;color:#4caf7d;">${X}p eller mer → HCP ned</div>
          ${Y != null ? `<div style="font-size:12px;color:rgba(255,120,100,0.9);">Under ${Y}p → HCP opp</div>` : ''}
          <div style="font-size:11px;color:rgba(255,255,255,0.3);">${Y != null ? `${Y}–${X - 1}p` : `Under ${X}p`} → ingen endring</div>
          ${motiv.droppedContext === 'good_drop' ? `<div style="font-size:11px;color:rgba(82,183,136,0.7);font-style:italic;">En dårlig runde faller ut — godt utgangspunkt!</div>` : motiv.droppedContext === 'bad_drop' ? `<div style="font-size:11px;color:rgba(255,180,100,0.75);font-style:italic;">En god runde faller ut — vær obs!</div>` : ''}
        </div>`;
      });
    if (!playerRows.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:14px;border:1px solid rgba(255,255,255,0.07);margin-bottom:4px;">
      <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">🎯 HCP-mål · ${courseName} · Slope ${slope}</div>
      ${playerRows.join('')}
    </div>`;
  } catch(e) {
    el.innerHTML = '';
  }
}

// ── GOLFBOX IMPORT ──
let _golfboxFiles = [];
let _golfboxParsed = [];

function openGolfboxImport() {
  _golfboxFiles = [];
  _golfboxParsed = [];
  document.getElementById('gbImportAlert').innerHTML = '';
  document.getElementById('gbFileList').innerHTML = '';
  document.getElementById('gbStep1').style.display = 'block';
  document.getElementById('gbStep2').style.display = 'none';
  document.getElementById('gbAnalyzeBtn').style.display = 'none';
  document.getElementById('gbImportFileInput').value = '';
  openModal('modalGolfboxImport');
}

function handleGolfboxFiles(input) {
  _golfboxFiles = Array.from(input.files);
  const list = document.getElementById('gbFileList');
  if (!_golfboxFiles.length) { list.innerHTML = ''; document.getElementById('gbAnalyzeBtn').style.display = 'none'; return; }
  list.innerHTML = _golfboxFiles.map(f => `
    <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(0,0,0,0.2); border-radius:8px; margin-bottom:6px;">
      <span style="font-size:18px;">🖼️</span>
      <span style="font-size:13px; color:var(--cream); flex:1;">${f.name}</span>
      <span style="font-size:11px; color:var(--cream-dim);">${(f.size/1024).toFixed(0)} KB</span>
    </div>`).join('');
  document.getElementById('gbAnalyzeBtn').style.display = 'block';
}

async function analyzeGolfboxImages() {
  if (!_golfboxFiles.length) return;
  const btn = document.getElementById('gbAnalyzeBtn');
  const alertEl = document.getElementById('gbImportAlert');
  btn.disabled = true;
  alertEl.innerHTML = '';
  _golfboxParsed = [];
  const prompt = `Du ser et skjermbilde eller foto av en poengliste fra Golfbox eller Gimmie (norske golf-apper).
Trekk ut ALLE synlige runder. For hver runde returner:
- date: dato i format YYYY-MM-DD
- differential: "HCP spilt til"-verdien (desimaltall, f.eks. 24.3)
- hcp_before: handicap FØR runden, hvis synlig (null ellers)
- hcp_after: handicap ETTER runden, hvis synlig (null ellers)
- course_name: banens navn, hvis synlig (null ellers)
- source: "gimmie" hvis Gimmie-appen, "golfbox" hvis Golfbox

Returner KUN dette JSON-objektet (ingen annen tekst):
{"rounds":[{"date":"2024-03-15","differential":12.4,"hcp_before":13.2,"hcp_after":12.9,"course_name":"Hvam Golf","source":"golfbox"}]}
Hvis ingen runder er lesbare, returner {"rounds":[]}.`;

  for (let i = 0; i < _golfboxFiles.length; i++) {
    btn.textContent = `⏳ Analyserer bilde ${i + 1} av ${_golfboxFiles.length}…`;
    try {
      const base64 = await _fileToBase64(_golfboxFiles[i]);
      const result = await callClaudeProxy(base64, _golfboxFiles[i].type, prompt, 2000);
      if (result.rounds && Array.isArray(result.rounds)) _golfboxParsed.push(...result.rounds);
    } catch (e) {
      alertEl.innerHTML = `<div class="alert alert-error">Feil på bilde ${i + 1}: ${e.message}</div>`;
    }
  }
  btn.disabled = false;
  btn.textContent = '🔍 Analyser med Claude';
  if (!_golfboxParsed.length) {
    alertEl.innerHTML = '<div class="alert alert-error">Ingen runder funnet. Prøv klarere bilder med dato og HCP-kolonne synlig.</div>';
    return;
  }
  _golfboxParsed.sort((a, b) => new Date(b.date) - new Date(a.date));
  document.getElementById('gbStep1').style.display = 'none';
  document.getElementById('gbStep2').style.display = 'block';
  _renderGolfboxPreview();
}

function _renderGolfboxPreview() {
  document.getElementById('gbPreviewCount').textContent = _golfboxParsed.length + ' runder funnet';
  document.getElementById('gbPreviewList').innerHTML = _golfboxParsed.map((r, i) => `
    <div style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="flex:1;">
        <div style="font-size:13px; color:var(--cream);">${r.date}${r.course_name ? ' · ' + r.course_name : ''}</div>
        <div style="font-size:11px; color:var(--cream-dim);">Diff: ${r.differential ?? '–'}${r.hcp_before != null ? ' · HCP: ' + r.hcp_before + ' → ' + (r.hcp_after ?? '?') : ''}</div>
      </div>
      <span style="font-size:11px; padding:2px 7px; border-radius:4px; background:rgba(201,168,76,0.15); color:var(--gold-dim);">${r.source || 'golfbox'}</span>
      <button onclick="_removeGolfboxEntry(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:0 4px;">✕</button>
    </div>`).join('');
}

function _removeGolfboxEntry(i) { _golfboxParsed.splice(i, 1); _renderGolfboxPreview(); }

async function saveGolfboxHistory() {
  if (!_golfboxParsed.length) return;
  const btn = document.getElementById('gbSaveBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Sletter gamle Gimmie-rader…';
  await db.from('score_differentials')
    .delete()
    .eq('player_id', currentProfile.id)
    .eq('source', 'gimmie');

  // Build set of existing gimmie date+differential keys to skip duplicates within same source
  const { data: existingRows } = await db.from('score_differentials')
    .select('date, differential')
    .eq('player_id', currentProfile.id)
    .eq('source', 'gimmie');
  const existingKeys = new Set((existingRows || []).map(r => `${r.date}|${r.differential}`));

  let saved = 0, skipped = 0;
  for (let i = 0; i < _golfboxParsed.length; i++) {
    btn.textContent = `⏳ Lagrer ${i + 1} av ${_golfboxParsed.length}…`;
    const r = _golfboxParsed[i];
    if (existingKeys.has(`${r.date}|${r.differential}`)) { skipped++; continue; }
    const { error } = await db.from('score_differentials').upsert({
      player_id: currentProfile.id,
      date: r.date,
      differential: r.differential,
      source: r.source || 'golfbox',
      course_name: r.course_name || null,
      hcp_before: r.hcp_before ?? null,
      hcp_after: r.hcp_after ?? null,
    }, { onConflict: 'player_id,date,differential,source', ignoreDuplicates: true });
    if (error) { skipped++; } else { saved++; }
  }
  // Update profile handicap to hcp_after from the most recent imported differential
  const withHcp = _golfboxParsed.filter(r => r.hcp_after != null);
  if (withHcp.length) {
    const newest = withHcp.reduce((a, b) => (a.date >= b.date ? a : b));
    const newHcp = parseFloat(newest.hcp_after);
    if (!isNaN(newHcp)) {
      await db.from('profiles').update({ handicap: newHcp }).eq('id', currentProfile.id);
      currentProfile.handicap = newHcp;
    }
  }

  btn.disabled = false; btn.textContent = 'Lagre historikk';
  if (saved === 0 && skipped > 0) {
    document.getElementById('gbImportAlert').innerHTML = `<div style="padding:12px 16px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:var(--cream-dim);font-size:14px;">Historikk er allerede oppdatert — ingen nye runder funnet.</div>`;
    return;
  }
  closeModal('modalGolfboxImport');
  loadProfilePage();
}

function _fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function _fetchStablefordStats(profileId, diffs, currentHI) {
  try {
    const hiNum = currentHI != null ? parseFloat(currentHI) : null;
    const entries = [];
    const gimmieDiffs = (diffs || []).filter(d => d.source !== 'fore' && d.differential != null);
    for (const d of gimmieDiffs) {
      const nh = d.hcp_before != null ? Math.round(parseFloat(d.hcp_before)) : (hiNum != null ? Math.round(hiNum) : null);
      if (nh == null) continue;
      const sf = Math.round(36 + nh - parseFloat(d.differential));
      if (sf >= 10 && sf <= 60) entries.push({ date: d.date, sf });
    }
    const cache = await _ensureProfileScoreCache(profileId, diffs, currentHI);
    for (const r of cache.roundSummaries) {
      if (r.is18) entries.push({ date: r.date, sf: r.sf });
    }
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = entries.slice(0, 10).map(e => e.sf);
    return recent.length ? { eighteen: recent } : null;
  } catch (_) { return null; }
}

let _diffsLoading = false;
async function loadAndRenderDifferentials() {
  if (_diffsLoading) return;
  _diffsLoading = true;
  try {
    const { data, error } = await db.from('score_differentials')
      .select('*').eq('player_id', currentProfile.id).order('date', { ascending: true });
    if (error) throw error;
    const diffs = data || [];
    _profileDiffsCache = diffs;
    _renderGolfboxImportList(diffs);
    const [sfStats, estimate] = await Promise.all([
      _fetchStablefordStats(currentProfile.id, diffs, currentProfile?.handicap ?? null),
      calculateEstimatedHCP(currentProfile.id)
    ]);
    _estimatedHCP = estimate;
    _renderStatCards(diffs, sfStats, estimate);
    const smEl = document.getElementById('statsMotivation');
    if (smEl) {
      const motiv = _calcHcpMotivation(diffs, 113, 72, 72, currentProfile?.handicap ?? null);
      smEl.innerHTML = motiv ? _renderMotivBanner(motiv) : '';
    }
    _renderHcpGraph(diffs);
    _renderHcpHistoryList(diffs);
  } catch (_) {
    // Network/auth hiccup on wake — keep existing rendered data
  } finally {
    _diffsLoading = false;
  }
}

function _renderStatCards(diffs, sfStats, estimate) {
  const el = document.getElementById('statsKpis');
  if (!el) return;
  if (!diffs.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--cream-dim);">Ingen data ennå – importer runder for å se statistikk.</p>';
    return;
  }
  const sorted = [...diffs].sort((a, b) => new Date(a.date) - new Date(b.date));
  const withHcp = sorted.filter(d => d.hcp_after != null);
  const hcpNow = withHcp.length ? parseFloat(withHcp[withHcp.length - 1].hcp_after) : null;
  const hcpPrev = withHcp.length > 1 ? parseFloat(withHcp[withHcp.length - 2].hcp_after) : null;
  const delta = hcpNow != null && hcpPrev != null ? +(hcpNow - hcpPrev).toFixed(1) : null;
  const improved = delta != null && delta < 0;
  const worsened = delta != null && delta > 0;
  const trendColor = improved ? '#4caf7d' : worsened ? 'var(--danger)' : 'var(--cream-dim)';
  const trendArrow = improved ? '↓' : worsened ? '↑' : '–';
  const trendLabel = delta != null && delta !== 0 ? (delta > 0 ? '+' : '') + delta : '';

  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.25);border-radius:12px;padding:18px 20px;border:1px solid rgba(255,255,255,0.08);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
        <div>
          <div style="font-size:9px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">HCP nå</div>
          <div style="font-family:'Playfair Display',serif;font-size:38px;color:var(--cream);line-height:1;">${hcpNow != null ? hcpNow.toFixed(1) : '–'}</div>
          <div style="font-size:13px;color:${trendColor};margin-top:6px;font-weight:600;">${trendArrow !== '–' ? trendArrow + ' ' + trendLabel : (hcpNow != null ? '<span style="color:var(--cream-dim);font-size:11px;">stabil</span>' : '')}</div>
        </div>
        ${estimate ? `<div style="text-align:right;">
          <div style="font-size:9px;color:var(--cream-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Estimert HCP</div>
          <div style="font-family:'Playfair Display',serif;font-size:38px;color:var(--gold-light);line-height:1;">${estimate.estimatedHCP}</div>
          <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:6px;">${estimate.newRoundsCount} runde${estimate.newRoundsCount !== 1 ? 'r' : ''} siden import</div>
        </div>` : ''}
      </div>
    </div>`;
}


function _renderGolfboxImportList(diffs) {
  const el = document.getElementById('golfboxImportList');
  if (!el) return;
  const imported = diffs.filter(d => d.source !== 'fore').sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!imported.length) { el.innerHTML = '<p style="font-size:13px; color:var(--cream-dim); margin-top:8px;">Ingen importerte runder ennå.</p>'; return; }
  const show = imported.slice(0, 5);
  el.innerHTML = show.map(d => `
    <div style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="flex:1;">
        <div style="font-size:13px; color:var(--cream);">${d.date}${d.course_name ? ' · ' + d.course_name : ''}</div>
        <div style="font-size:11px; color:var(--cream-dim);">Differential: ${d.differential ?? '–'}</div>
      </div>
      <span style="font-size:11px; padding:2px 7px; border-radius:4px; background:rgba(201,168,76,0.15); color:var(--gold-dim);">${d.source}</span>
    </div>`).join('') + (imported.length > 5 ? `<p style="font-size:12px; color:var(--cream-dim); margin-top:8px;">+ ${imported.length - 5} eldre runder — se HCP-utvikling for full historikk</p>` : '');
}

function _renderHcpGraph(diffs) {
  const el = document.getElementById('hcpGraph');
  if (!el) return;
  const pts = diffs.filter(d => d.hcp_after != null).map(d => ({ date: d.date, hcp: parseFloat(d.hcp_after) }));
  if (pts.length < 2) { el.innerHTML = '<p style="font-size:13px; color:var(--cream-dim); text-align:center; padding:12px 0;">Importér minst 2 runder med HCP-verdi for å se grafen.</p>'; return; }
  const W = 340, H = 130, pL = 34, pR = 10, pT = 10, pB = 22;
  const hcps = pts.map(p => p.hcp);
  const minH = Math.min(...hcps), maxH = Math.max(...hcps), range = maxH - minH || 1;
  const xS = i => pL + (i / (pts.length - 1)) * (W - pL - pR);
  const yS = h => pT + (1 - (h - minH) / range) * (H - pT - pB);
  const poly = pts.map((p, i) => `${xS(i).toFixed(1)},${yS(p.hcp).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${xS(i).toFixed(1)}" cy="${yS(p.hcp).toFixed(1)}" r="3.5" fill="var(--gold)" stroke="var(--green-deep)" stroke-width="1.5"/>`).join('');
  const yLabels = [minH, (minH+maxH)/2, maxH].map(h => `<text x="${pL-5}" y="${yS(h).toFixed(1)}" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="end" dominant-baseline="middle">${h.toFixed(1)}</text>`).join('');
  const lastIdx = pts.length - 1;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible;" xmlns="http://www.w3.org/2000/svg">
    <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${H-pB}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <line x1="${pL}" y1="${H-pB}" x2="${W-pR}" y2="${H-pB}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    ${yLabels}
    <text x="${xS(0).toFixed(1)}" y="${H-5}" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="start">${pts[0].date.slice(5)}</text>
    <text x="${xS(lastIdx).toFixed(1)}" y="${H-5}" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="end">${pts[lastIdx].date.slice(5)}</text>
    <polyline points="${poly}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>`;
}

async function calculateEstimatedHCP(playerId) {
  // Fetch gimmie + golfbox differentials, deduplicate by date+differential, newest first
  const { data: rawImportedDiffs } = await db.from('score_differentials')
    .select('date, differential')
    .eq('player_id', playerId)
    .in('source', ['gimmie', 'golfbox'])
    .order('date', { ascending: false });

  const seen = new Set();
  const gimmieDiffs = (rawImportedDiffs || []).filter(d => {
    const key = `${d.date}|${d.differential}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const lastImportDate = gimmieDiffs.length ? gimmieDiffs[0].date : null;

  // Get round IDs where this player has scores (used only to narrow the rounds query)
  const { data: scoreRows } = await db.from('scores')
    .select('round_id')
    .eq('player_id', playerId)
    .gt('strokes', 0);

  let newDifferentials = [];

  if (scoreRows?.length) {
    const roundIdsWithScores = [...new Set(scoreRows.map(s => s.round_id))];

    // Fetch completed rounds after the cutoff with tee set data
    let roundsQuery = db.from('rounds')
      .select('id, date, hole_range, course_id, tee_sets(course_rating, slope)')
      .eq('status', 'completed')
      .in('id', roundIdsWithScores);

    if (lastImportDate) roundsQuery = roundsQuery.gt('date', lastImportDate);

    const { data: rounds } = await roundsQuery;

    if (rounds?.length) {
      // For each round fetch strokes filtered by BOTH round_id AND player_id to avoid summing other players
      newDifferentials = (await Promise.all(
        rounds
          .filter(r => r.tee_sets?.course_rating && r.tee_sets?.slope)
          .map(async r => {
            const { data: roundScores } = await db.from('scores')
              .select('hole_number, strokes')
              .eq('round_id', r.id)
              .eq('player_id', playerId)
              .gt('strokes', 0);
            const holeCount = (roundScores || []).length;
            const is9Hole = holeCount <= 9 || r.hole_range === 'front9' || r.hole_range === 'back9';

            if (is9Hole) {
              // Fetch ALL 18 holes for the course to compute netto par for unplayed holes
              const { data: allHoles } = await db.from('holes')
                .select('hole_number, par, stroke_index')
                .eq('course_id', r.course_id)
                .order('hole_number');

              const cr = r.tee_sets.course_rating;
              const slope = r.tee_sets.slope;
              const coursePar18 = (allHoles || []).reduce((s, h) => s + (h.par || 0), 0) || 72;
              const phcp = _playingHcp(currentProfile.handicap, slope, cr, coursePar18);

              const strokeMap = {};
              (roundScores || []).forEach(s => { strokeMap[s.hole_number] = s.strokes; });

              const totalStrokesPlayed = (roundScores || []).reduce((s, row) => s + row.strokes, 0);
              const playedHoleNums = new Set(Object.keys(strokeMap).map(Number));

              // For each unplayed hole, compute netto par = par + tildelte
              let unplayedNettoParSum = 0;
              for (const h of (allHoles || [])) {
                if (playedHoleNums.has(h.hole_number) || !h.par || !h.stroke_index) continue;
                let tildelte = Math.floor(phcp / 18);
                if (h.stroke_index <= (phcp % 18)) tildelte++;
                unplayedNettoParSum += h.par + tildelte;
              }

              const adjustedGross = totalStrokesPlayed + unplayedNettoParSum;
              const differential = (adjustedGross - cr) * 113 / slope;

              if (differential < 0) return null;
              return { date: r.date, differential };
            }

            // 18-hole: simple stroke differential
            const totalStrokes = (roundScores || []).reduce((s, row) => s + row.strokes, 0);
            const differential = (totalStrokes - r.tee_sets.course_rating) * 113 / r.tee_sets.slope;
            if (totalStrokes < 50 || differential < 0) return null;
            return { date: r.date, differential };
          })
      )).filter(Boolean);
    }
  }

  // Simulate Gimmie's rolling window starting from existing gimmie history as baseline
  const gimmieBaseline = (gimmieDiffs || [])
    .filter(d => d.differential != null)
    .map(d => ({ date: d.date, differential: parseFloat(d.differential) }));

  // Apply new rounds oldest-first, rolling the window forward one step at a time
  const newSorted = newDifferentials
    .map(d => ({ date: d.date, differential: parseFloat(d.differential) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let rollingWindow = gimmieBaseline.slice(0, 20); // cap baseline at 20 before simulation

  for (const d of newSorted) {
    rollingWindow.unshift(d);
    if (rollingWindow.length > 20) rollingWindow.pop();
  }

  if (!rollingWindow.length || !newDifferentials.length) return null;

  const finalBest8 = [...rollingWindow].sort((a, b) => a.differential - b.differential).slice(0, 8);
  const finalAvg = finalBest8.reduce((s, d) => s + d.differential, 0) / finalBest8.length;
  const estimatedHCP = finalAvg.toFixed(1);

  const result = { estimatedHCP, newRoundsCount: newDifferentials.length, lastImportDate };
  return result;
}

function _renderHcpHistoryList(diffs) {
  const el = document.getElementById('hcpHistoryList');
  if (!el) return;
  if (!diffs.length) { el.innerHTML = '<p style="font-size:13px; color:var(--cream-dim);">Ingen historikk ennå.</p>'; return; }
  const sorted = [...diffs].sort((a, b) => new Date(b.date) - new Date(a.date));
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
      <th style="padding:6px 4px;text-align:left;color:var(--cream-dim);font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Dato</th>
      <th style="padding:6px 4px;text-align:left;color:var(--cream-dim);font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Bane</th>
      <th style="padding:6px 4px;text-align:right;color:var(--cream-dim);font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Diff</th>
      <th style="padding:6px 4px;text-align:right;color:var(--cream-dim);font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">HCP</th>
      <th style="padding:6px 4px;text-align:center;color:var(--cream-dim);font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Kilde</th>
    </tr></thead>
    <tbody>${sorted.map(d => `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:8px 4px;color:var(--cream);">${d.date}</td>
        <td style="padding:8px 4px;color:var(--cream-dim);font-size:12px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.course_name || '–'}</td>
        <td style="padding:8px 4px;text-align:right;font-family:'Playfair Display',serif;color:var(--gold);">${d.differential != null ? d.differential : '–'}</td>
        <td style="padding:8px 4px;text-align:right;color:var(--cream-dim);font-size:12px;">${d.hcp_before != null ? d.hcp_before + ' → ' + (d.hcp_after ?? '?') : (d.hcp_after != null ? d.hcp_after : '–')}</td>
        <td style="padding:8px 4px;text-align:center;"><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(201,168,76,0.15);color:var(--gold-dim);">${d.source || '–'}</span></td>
      </tr>`).join('')}
    </tbody></table>`;
}
