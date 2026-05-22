// ── SUPABASE INIT ──
const SUPABASE_URL = 'https://fqiwnsmhypxtsdipzntm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxaXduc21oeXB4dHNkaXB6bnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MTA2NjIsImV4cCI6MjA5MzE4NjY2Mn0.QZjHeK-ckcM5aAIRsjeZalHQuLgkwCVcoxTL1pBpG68';
const CLAUDE_PROXY = 'https://fqiwnsmhypxtsdipzntm.supabase.co/functions/v1/claude-proxy';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);
let currentUser = null;
let currentProfile = null;

// ── AUTH ──
async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    await loadProfile(session.user.id);
    if (currentProfile) {
      if (currentProfile.is_approved === false) {
        await db.auth.signOut();
        showPending(currentProfile.display_name);
      } else {
        showApp();
        if (location.hash === '#live') {
          setTimeout(() => { showPage('live'); }, 400);
        }
      }
    } else showLogin();
  } else {
    if (location.hash === '#live') {
      showPublicLive();
    } else {
      showLogin();
    }
  }
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      // If the app shell is already visible the user is already logged in —
      // this is a token refresh, not a new sign-in. Don't re-run showApp()
      // or loadProfile(); it competes with visibilitychange calls and hangs.
      if (document.getElementById('appShell')?.style.display !== 'none') return;
      await loadProfile(session.user.id);
      if (currentProfile?.is_approved === false) { await db.auth.signOut(); showPending(currentProfile.display_name); return; }
      showApp();
    }
  });
}
async function loadProfile(userId) {
  const { data } = await db.from('profiles').select('*').eq('id', userId).single();
  if (data) currentProfile = data;
}
function showLogin() {
  document.getElementById('publicLivePage').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('pendingPage').style.display = 'none';
}
function showPending(displayName) {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('publicLivePage').style.display = 'none';
  document.getElementById('pendingPage').style.display = 'flex';
  const el = document.getElementById('pendingName');
  if (el) el.textContent = displayName || '';
}
function showLoginFromPublic() {
  document.getElementById('publicLivePage').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
}
let _publicLiveInterval = null;
async function showPublicLive() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('publicLivePage').style.display = 'block';
  await renderPublicLive();
  if (!_publicLiveInterval) _publicLiveInterval = setInterval(renderPublicLive, 20000);
}
async function renderPublicLive() {
  const statusEl = document.getElementById('publicLiveStatus');
  const contentEl = document.getElementById('publicLiveContent');
  const { data: active } = await db.from('rounds')
    .select('*, courses(name, holes), tee_sets(name, slope), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name)))')
    .eq('status', 'active').order('created_at', { ascending: false });
  if (!active?.length) {
    statusEl.textContent = 'Ingen aktive runder akkurat nå';
    contentEl.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--cream-dim);">
      <div style="font-size:48px; margin-bottom:16px;">⛳</div>
      <div style="font-size:16px; color:var(--cream);">Ingen aktive runder</div>
      <div style="font-size:13px; margin-top:8px;">Siden oppdateres automatisk</div>
    </div>`;
    return;
  }
  const round = active[0];
  statusEl.textContent = '🟢 Live · ' + round.courses?.name + ' · ' + round.date;
  const { data: scores } = await db.from('scores').select('*').eq('round_id', round.id);
  const { data: holes } = await db.from('holes').select('*').eq('course_id', round.course_id).order('hole_number');
  const allFP = (round.flights || []).flatMap(f => f.flight_players || []);
  const _pubRange = round.hole_range || 'all';
  const _pubActiveHoles = _pubRange === 'front9' ? (holes||[]).filter(h => h.hole_number <= 9)
    : _pubRange === 'back9' ? (holes||[]).filter(h => h.hole_number >= 10) : (holes||[]);
  const holeCount = _pubActiveHoles.length || round.courses?.holes || 18;
  const scoreMap = {}, holeMap = {};
  (scores || []).forEach(s => { if (!scoreMap[s.player_id]) scoreMap[s.player_id] = {}; scoreMap[s.player_id][s.hole_number] = s.strokes; });
  _pubActiveHoles.forEach(h => { holeMap[h.hole_number] = h; });
  const _pubPar = (holes||[]).reduce((s,h) => s + (h.par||0), 0) || 72;
  const standings = allFP.map(fp => {
    const ps = scoreMap[fp.player_id] || {};
    let pts = 0, played = 0;
    Object.entries(ps).forEach(([hn, strokes]) => {
      if (strokes > 0) { played++; const h = holeMap[parseInt(hn)]; if (h?.par && h?.stroke_index) pts += calcStablefordLive(strokes, h.par, _playingHcp(fp.handicap, round.tee_sets?.slope, round.tee_sets?.course_rating, _pubPar), h.stroke_index, 18); }
    });
    return { name: fp.profiles?.display_name || '?', pts, played, scores: ps };
  }).sort((a, b) => b.pts - a.pts);
  const maxHole = standings.reduce((m, s) => Math.max(m, s.played), 0);
  const feedEvents = (scores || []).filter(s => s.strokes > 0 && holeMap[s.hole_number]?.par)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 5)
    .map(s => {
      const h = holeMap[s.hole_number], fp = allFP.find(p => p.player_id === s.player_id);
      const diff = s.strokes - h.par;
      let label = 'Par', dot = '#888780';
      if (s.strokes === 1) { label = 'Hole in One 🏆'; dot = '#fac775'; }
      else if (diff <= -2) { label = 'Eagle 🦅'; dot = '#fac775'; }
      else if (diff === -1) { label = 'Birdie 🐦'; dot = '#85b7eb'; }
      else if (diff === 1) { label = 'Bogey'; dot = '#f09595'; }
      else if (diff >= 2) { label = `+${diff}`; dot = '#e24b4a'; }
      return { hole: s.hole_number, par: h.par, label, dot, name: (fp?.profiles?.display_name || '?').split(' ')[0], strokes: s.strokes };
    });
  contentEl.innerHTML = `
    <div style="background:rgba(201,168,76,0.08); border:1px solid rgba(201,168,76,0.2); border-radius:12px; padding:14px 16px; margin-bottom:16px;">
      <div style="font-size:11px; color:var(--gold); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Hull ${maxHole} av ${holeCount}</div>
      <div style="font-size:16px; color:var(--cream); font-weight:500;">${round.courses?.name}</div>
      <div style="font-size:12px; color:var(--cream-dim); margin-top:2px;">${round.tee_sets?.name || ''}</div>
    </div>
    <div style="font-size:11px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px;">Leaderboard</div>
    <div style="background:rgba(0,0,0,0.2); border-radius:12px; overflow:hidden; margin-bottom:16px; border:1px solid rgba(255,255,255,0.06);">
      ${standings.map((s, i) => `
        <div style="display:flex; align-items:center; gap:12px; padding:13px 16px; ${i < standings.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.05)' : ''}; ${i===0 ? 'background:rgba(201,168,76,0.07)' : ''};">
          <div style="font-size:13px; color:var(--cream-dim); min-width:20px;">${i+1}</div>
          <div style="flex:1;">
            <div style="font-size:14px; color:var(--cream); font-weight:${i===0?'600':'400'};">${s.name}</div>
            <div style="font-size:11px; color:var(--cream-dim);">thru ${s.played}</div>
          </div>
          <div style="font-size:22px; font-weight:600; color:var(--gold);">${s.pts}p</div>
        </div>`).join('')}
    </div>
    ${feedEvents.length ? `
    <div style="font-size:11px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px;">Live feed</div>
    <div style="background:rgba(0,0,0,0.2); border-radius:12px; padding:14px 16px; border:1px solid rgba(255,255,255,0.06);">
      ${feedEvents.map((e, i) => `
        <div style="display:flex; gap:10px; align-items:flex-start; ${i>0?'margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05)':''}">
          <div style="width:8px;height:8px;border-radius:50%;background:${e.dot};flex-shrink:0;margin-top:5px;"></div>
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--cream);">Hull ${e.hole} · Par ${e.par}</div>
            <div style="font-size:12px;color:var(--cream-dim);margin-top:2px;">${e.name} · ${e.label} · ${e.strokes} slag</div>
          </div>
        </div>`).join('')}
    </div>` : ''}
    <div style="font-size:11px;color:var(--cream-dim);text-align:center;margin-top:16px;">Oppdateres automatisk hvert 20 sek</div>
  `;
}
function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('topbarUsername').textContent = currentProfile?.username || '–';
  document.getElementById('dashGreeting').textContent = `Hei, ${currentProfile?.display_name || currentProfile?.username}!`;
  const _golfQuotes = [
    { text: "The most important shot in golf is the next one.", author: "Ben Hogan" },
    { text: "Golf is a good walk spoiled.", author: "Mark Twain" },
    { text: "The more I practice, the luckier I get.", author: "Gary Player" },
    { text: "The older I get, the better I used to be.", author: "Lee Trevino" },
    { text: "Nobody asked how you looked, just what you shot.", author: "Sam Snead" },
    { text: "To find a man's true character, play golf with him.", author: "P.G. Wodehouse" },
    { text: "The only thing a golfer needs is more daylight.", author: "Ben Hogan" },
    { text: "Drive for show, putt for dough.", author: "Bobby Locke" },
    { text: "Golf is deceptively simple and endlessly complicated.", author: "Arnold Palmer" },
    { text: "Happiness is a long walk with a putter.", author: "Greg Norman" },
    { text: "If you drink, don't drive. Don't even putt.", author: "Dean Martin" },
    { text: "They call it golf because all the other four-letter words were taken.", author: "Raymond Floyd" },
    { text: "Serenity is knowing that your worst shot is still pretty good.", author: "Johnny Miller" },
    { text: "You can't go into a shop and buy a good game of golf.", author: "Sam Snead" },
    { text: "I know I'm getting better at golf because I'm hitting fewer spectators.", author: "Gerald Ford" },
    { text: "Golf is a game in which you yell fore, shoot six, and write down five.", author: "Paul Harvey" },
    { text: "If you think it's hard to meet people, try picking up the wrong golf ball.", author: "Jack Lemmon" },
    { text: "Every day is a good day on the golf course.", author: "Anonymous" },
    { text: "Concentration comes out of a combination of confidence and hunger.", author: "Arnold Palmer" },
    { text: "A good golfer has the determination to win and the patience to wait for the breaks.", author: "Gary Player" },
  ];
  const _q = _golfQuotes[Math.floor(Date.now() / 86400000) % _golfQuotes.length];
  const _qEl = document.getElementById('dashQuote');
  if (_qEl) _qEl.textContent = `"${_q.text}" – ${_q.author}`;
  if (currentProfile?.is_admin) {
    // admin-rettigheter aktive
  }
  // players vises via Meg-siden
  loadCourses();
  loadDashboard();
}
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabLogin').style.display = isLogin ? 'block' : 'none';
  document.getElementById('tabRegister').style.display = isLogin ? 'none' : 'block';
  document.getElementById('tabLoginBtn').style.background = isLogin ? 'rgba(201,168,76,0.2)' : 'transparent';
  document.getElementById('tabLoginBtn').style.color = isLogin ? 'var(--gold-light)' : 'var(--cream-dim)';
  document.getElementById('tabRegisterBtn').style.background = isLogin ? 'transparent' : 'rgba(201,168,76,0.2)';
  document.getElementById('tabRegisterBtn').style.color = isLogin ? 'var(--cream-dim)' : 'var(--gold-light)';
}
async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) { showAlert('loginAlert', 'Fyll inn brukernavn og passord', 'error'); return; }
  const { data: profile, error: profileErr } = await db.from('profiles').select('id').eq('username', username).single();
  if (profileErr || !profile) { showAlert('loginAlert', 'Brukernavn ikke funnet', 'error'); return; }
  const { data: fullProfile } = await db.from('profiles').select('email').eq('username', username).single();
  const email = fullProfile?.email;
  if (!email) { showAlert('loginAlert', 'Ingen e-post koblet til brukeren. Kontakt Hawk.', 'error'); return; }
  const { data: authData, error } = await db.auth.signInWithPassword({ email, password });
  if (error) { showAlert('loginAlert', 'Feil brukernavn eller passord', 'error'); return; }
  const userId = authData?.user?.id;
  if (userId) await loadProfile(userId);
  if (currentProfile?.is_approved === false) { await db.auth.signOut(); showPending(currentProfile.display_name); return; }
  showApp();
}
async function handleRegister() {
  const username = document.getElementById('regUsername').value.trim().toLowerCase();
  const displayName = document.getElementById('regDisplayName').value.trim();
  const password = document.getElementById('regPassword').value;
  const hcp = parseFloat(document.getElementById('regHcp').value) || 54.0;
  const inviteCode = document.getElementById('regInviteCode').value.trim().toUpperCase();
  if (!username || !displayName || !password) { showAlert('registerAlert', 'Fyll inn alle påkrevde felt', 'error'); return; }
  if (password.length < 6) { showAlert('registerAlert', 'Passordet må være minst 6 tegn', 'error'); return; }
  if (inviteCode !== 'FORE') { showAlert('registerAlert', 'Feil invitasjonskode – spør Hawk om kode', 'error'); return; }
  const { data: existing } = await db.from('profiles').select('id').eq('username', username).single();
  if (existing) { showAlert('registerAlert', 'Brukernavnet er allerede tatt – velg et annet', 'error'); return; }
  // Auto-generer intern e-post – brukeren ser den aldri
  const email = `${username}@fantastic-fore.app`;
  const { data, error } = await db.auth.signUp({ email, password });
  if (error) { showAlert('registerAlert', error.message, 'error'); return; }
  if (data.user) {
    const { error: profileError } = await db.from('profiles').insert({
      id: data.user.id, username, display_name: displayName, email, handicap: hcp, is_admin: false, is_approved: false
    });
    if (profileError) { showAlert('registerAlert', 'Profil feilet: ' + profileError.message, 'error'); return; }
  }
  await db.auth.signOut();
  showPending(displayName);
}
async function handleLogout() {
  await db.auth.signOut();
  currentProfile = null;
  showLogin();
}

// ── NAVIGATION ──
function showPage(pageId) {
  // Stop live polling when navigating away
  if (pageId !== 'live' && _liveRefreshInterval) {
    clearInterval(_liveRefreshInterval);
    _liveRefreshInterval = null;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');
  const navMap = { dashboard: 'navDashboard', rounds: 'navRounds', live: 'navLive', courses: 'navCourses', profile: 'navProfile', players: 'navProfile' };
  const navBtn = document.getElementById(navMap[pageId]);
  if (navBtn) navBtn.classList.add('active');
  if (pageId === 'players') loadPlayers();
  if (pageId === 'profile') loadProfilePage();
  if (pageId === 'rounds') loadRounds();
  if (pageId === 'dashboard') loadDashboard();
  if (pageId === 'live') loadLivePage();
}

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

// ── PLAYERS ──
async function loadPlayers() {
  const { data: players } = await db.from('profiles').select('*').order('username');
  const el = document.getElementById('playersList');
  if (!players?.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">👤</div><h3>Ingen spillere</h3></div>'; return; }
  el.innerHTML = players.map(p => `
    <div class="player-item">
      <div class="player-avatar">${p.display_name?.[0] || p.username?.[0] || '?'}</div>
      <div class="player-info">
        <div class="player-name">${p.display_name} <span style="color:var(--cream-dim);font-size:13px;">@${p.username}</span> ${p.is_admin ? '<span class="badge badge-gold">Admin</span>' : ''}</div>
        <div class="player-meta">HCP: ${p.handicap ?? '–'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="hcp-badge">${p.handicap ?? '–'}</div>
        ${currentProfile?.is_admin ? `
          <button onclick="openEditPlayer('${p.id}','${(p.display_name||'').replace(/'/g,"\\'")}',${p.handicap??'null'})" style="background:none;border:1px solid rgba(201,168,76,0.3);color:var(--gold);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;font-family:'DM Sans',sans-serif;">Rediger</button>
          <button onclick="openResetPassword('${p.id}','${(p.display_name||'').replace(/'/g,"\\'")}','${p.username}')" style="background:none;border:1px solid rgba(82,183,136,0.3);color:var(--green-light);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;font-family:'DM Sans',sans-serif;">Reset pw</button>
          <button onclick="deletePlayer('${p.id}','${(p.display_name||'').replace(/'/g,"\\'")}','${p.username}')" style="background:none;border:1px solid rgba(192,57,43,0.4);color:var(--danger);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;font-family:'DM Sans',sans-serif;">Slett</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}
function openEditPlayer(playerId, displayName, handicap) {
  const overlay = document.createElement('div');
  overlay.id = 'editPlayerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--green-dark);border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:28px;max-width:420px;width:100%;">
      <h3 style="font-family:'Playfair Display',serif;color:var(--gold-light);margin-bottom:20px;">Rediger spiller</h3>
      <div id="editPlayerAlert"></div>
      <div class="form-group">
        <label>Visningsnavn</label>
        <input type="text" id="ep-name" value="${displayName}" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:var(--cream);font-size:14px;font-family:'DM Sans',sans-serif;">
      </div>
      <div class="form-group">
        <label>Handicap</label>
        <input type="number" id="ep-hcp" value="${handicap !== 'null' ? handicap : ''}" step="0.1" min="-10" max="54" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:var(--cream);font-size:14px;font-family:'DM Sans',sans-serif;">
      </div>
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button onclick="document.getElementById('editPlayerOverlay').remove()" style="flex:1;padding:10px;border-radius:8px;border:1px solid rgba(201,168,76,0.4);background:transparent;color:var(--gold);cursor:pointer;font-family:'DM Sans',sans-serif;">Avbryt</button>
        <button onclick="saveEditPlayer('${playerId}')" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--gold);color:var(--green-deep);font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Lagre</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function saveEditPlayer(playerId) {
  const name = document.getElementById('ep-name').value.trim();
  const hcp = parseFloat(document.getElementById('ep-hcp').value);
  if (!name) { document.getElementById('editPlayerAlert').innerHTML = '<div class="alert alert-error">Navn er påkrevd</div>'; return; }
  const { error } = await db.from('profiles').update({ display_name: name, handicap: isNaN(hcp) ? null : hcp }).eq('id', playerId);
  if (error) { document.getElementById('editPlayerAlert').innerHTML = `<div class="alert alert-error">${error.message}</div>`; return; }
  document.getElementById('editPlayerOverlay')?.remove();
  loadPlayers();
}

async function deletePlayer(playerId, displayName, username) {
  if (playerId === currentProfile?.id) {
    alert('Du kan ikke slette din egen bruker!');
    return;
  }
  const confirmed = await showConfirm(`Slette ${displayName} (@${username})? Dette kan ikke angres.`);
  if (!confirmed) return;
  await db.from('flight_players').delete().eq('player_id', playerId);
  await db.from('scores').delete().eq('player_id', playerId);
  await db.from('notifications').delete().eq('player_id', playerId);
  const { error } = await db.from('profiles').delete().eq('id', playerId);
  if (error) { alert('Feil ved sletting: ' + error.message); return; }
  loadPlayers();
}
function openResetPassword(playerId, displayName, username) {
  const overlay = document.createElement('div');
  overlay.id = 'resetPwOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--green-dark);border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:28px;max-width:420px;width:100%;">
      <h3 style="font-family:'Playfair Display',serif;color:var(--gold-light);margin-bottom:8px;">Reset passord</h3>
      <p style="font-size:13px;color:var(--cream-dim);margin-bottom:20px;">Sett et midlertidig passord for <strong style="color:var(--cream);">${displayName} (@${username})</strong>. Spilleren bør bytte dette selv under Min Profil.</p>
      <div id="resetPwAlert"></div>
      <div class="form-group">
        <label>Midlertidig passord</label>
        <input type="text" id="rp-pass" placeholder="f.eks. golf2026" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:var(--cream);font-size:14px;font-family:'DM Sans',sans-serif;">
      </div>
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button onclick="document.getElementById('resetPwOverlay').remove()" style="flex:1;padding:10px;border-radius:8px;border:1px solid rgba(201,168,76,0.4);background:transparent;color:var(--gold);cursor:pointer;font-family:'DM Sans',sans-serif;">Avbryt</button>
        <button onclick="doResetPassword('${playerId}')" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--green-mid);color:var(--cream);font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Sett passord</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doResetPassword(playerId) {
  const newPassword = document.getElementById('rp-pass').value.trim();
  if (!newPassword || newPassword.length < 6) {
    document.getElementById('resetPwAlert').innerHTML = '<div class="alert alert-error">Passord må være minst 6 tegn</div>';
    return;
  }
  try {
    const response = await fetch('https://fqiwnsmhypxtsdipzntm.supabase.co/functions/v1/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON },
      body: JSON.stringify({ userId: playerId, newPassword })
    });
    const data = await response.json();
    if (data.error) {
      document.getElementById('resetPwAlert').innerHTML = `<div class="alert alert-error">${data.error}</div>`;
      return;
    }
    document.getElementById('resetPwAlert').innerHTML = '<div class="alert alert-success">✅ Passord satt! Gi det videre til spilleren.</div>';
    setTimeout(() => document.getElementById('resetPwOverlay')?.remove(), 2000);
  } catch(e) {
    document.getElementById('resetPwAlert').innerHTML = `<div class="alert alert-error">Feil: ${e.message}</div>`;
  }
}
function openAddPlayer() {
  document.getElementById('addPlayerAlert').innerHTML = '';
  ['newUsername','newDisplayName','newHcp','newPlayerPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  openModal('modalAddPlayer');
}
async function savePlayer() {
  const username = document.getElementById('newUsername').value.trim().toLowerCase();
  const displayName = document.getElementById('newDisplayName').value.trim();
  const password = document.getElementById('newPlayerPassword')?.value || '';
  const hcp = parseFloat(document.getElementById('newHcp').value) || 54.0;
  if (!username || !displayName || !password || password.length < 6) { 
    showAlert('addPlayerAlert', 'Fyll inn brukernavn, navn og passord (minst 6 tegn)', 'error'); 
    return; 
  }
  const { data: existing } = await db.from('profiles').select('id').eq('username', username).single();
  if (existing) { showAlert('addPlayerAlert', 'Brukernavnet er allerede tatt', 'error'); return; }
  const email = `${username}@fantastic-fore.app`;
  const finalPassword = password || Math.random().toString(36).slice(-10);
  const { data, error } = await db.auth.signUp({ email, password: finalPassword });
  if (error) { showAlert('addPlayerAlert', error.message, 'error'); return; }
  if (data.user) {
    const { error: profileError } = await db.from('profiles').insert({
      id: data.user.id, username, display_name: displayName, email, handicap: hcp, is_admin: false, is_approved: true
    });
    if (profileError) { showAlert('addPlayerAlert', 'Profil feilet: ' + profileError.message, 'error'); return; }
  }
  showAlert('addPlayerAlert', `✅ ${displayName} opprettet! Brukernavn: <strong>${username}</strong> · Passord: <strong>${password}</strong> — gi dette til spilleren.`, 'success');
  setTimeout(() => { closeModal('modalAddPlayer'); loadPlayers(); }, 1000);
}

// ── UTILITIES ──
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  // Stopp eventuell tale ved lukking
  if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
}
function closeModalOnOverlay(event, id) { if (event.target.id === id) closeModal(id); }
function showAlert(containerId, msg, type) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}


// ── ROUNDS ──
let allPlayers = [];
let flightCount = 0;
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
    (tees || []).map(t => `<option value="${t.id}">${t.name} — Slope ${t.slope}, CR ${t.course_rating}</option>`).join('');
  sel.removeEventListener('change', updateRoundMotivation);
  sel.addEventListener('change', updateRoundMotivation);
  document.getElementById('teeMotivDiv').innerHTML = '';
  const { data: holes } = await db.from('holes').select('hole_number').eq('course_id', courseId);
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
    const rangeSelect = document.getElementById('roundHoleRange');
    if (rangeSelect) {
      rangeSelect.removeEventListener('change', updateRoundMotivation);
      rangeSelect.addEventListener('change', updateRoundMotivation);
    }
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
    <div style="display:flex; flex-wrap:wrap; gap:8px;" id="flight-players-${flightCount}">
      ${allPlayers.map(p => `
        <label style="display:flex; align-items:center; gap:6px; padding:6px 12px; background:rgba(255,255,255,0.05); border-radius:20px; cursor:pointer; border:1px solid rgba(255,255,255,0.1); font-size:13px; color:var(--cream-dim);">
          <input type="checkbox" value="${p.id}" data-name="${p.display_name}" data-hcp="${p.handicap || 36}" style="accent-color:var(--gold);">
          ${p.display_name} <span style="color:var(--cream-dim); font-size:11px;">(${p.handicap ?? '–'})</span>
        </label>
      `).join('')}
    </div>
  `;
  document.getElementById('flightList').appendChild(div);
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

    // HCP-motivasjon – hentes separat (samme mønster som statistikk-seksjonen)
    const motivEl = document.getElementById('dashMotivation');
    if (motivEl && currentProfile) {
      motivEl.innerHTML = '<div style="font-size:12px;color:var(--cream-dim);padding:6px 0;">⏳ Laster HCP-mål…</div>';
      try {
        const { data: myDiffs } = await db.from('score_differentials')
          .select('*').eq('player_id', currentProfile.id)
          .order('date', { ascending: true });
        const motiv = _calcHcpMotivation(myDiffs || [], 113, 72, 72, currentProfile?.handicap ?? null);
        motivEl.innerHTML = motiv ? _renderMotivBanner(motiv, false, true) : '';
      } catch(e) {
        motivEl.innerHTML = `<div style="font-size:11px;color:var(--danger);">Feil: ${e.message}</div>`;
      }
    }
  } finally {
    _dashboardLoading = false;
  }
}

// ── PENDING USERS (ADMIN) ──
async function openPendingUsers() {
  openModal('modalPendingUsers');
  await loadPendingUsersList();
}
async function loadPendingUsersList() {
  const el = document.getElementById('pendingUsersList');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Laster...</div>';
  const { data: pending } = await db.from('profiles').select('id, display_name, username, created_at').eq('is_approved', false).order('created_at', { ascending: true });
  if (!pending?.length) {
    el.innerHTML = '<div style="text-align:center; padding:32px; color:var(--cream-dim); font-size:14px;">Ingen ventende brukere 🎉</div>';
    document.getElementById('dashPendingBanner').innerHTML = '';
    return;
  }
  el.innerHTML = pending.map(u => `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.07);">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:38px; height:38px; border-radius:50%; background:var(--green-mid); border:2px solid var(--gold-dim); display:flex; align-items:center; justify-content:center; font-family:'Playfair Display',serif; font-size:14px; font-weight:700; color:var(--gold-light); flex-shrink:0;">${u.display_name?.[0] || '?'}</div>
        <div>
          <div style="font-size:14px; color:var(--cream); font-weight:500;">${u.display_name}</div>
          <div style="font-size:12px; color:var(--cream-dim);">@${u.username}</div>
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-shrink:0;">
        <button onclick="approvePendingUser('${u.id}','${u.display_name}')" style="padding:7px 14px; border-radius:6px; border:1px solid rgba(82,183,136,0.5); background:rgba(82,183,136,0.15); color:var(--green-light); font-size:13px; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all 0.2s;" onmouseover="this.style.background='rgba(82,183,136,0.3)'" onmouseout="this.style.background='rgba(82,183,136,0.15)'">✓ Godkjenn</button>
        <button onclick="rejectPendingUser('${u.id}','${u.display_name}')" style="padding:7px 14px; border-radius:6px; border:1px solid rgba(192,57,43,0.4); background:rgba(192,57,43,0.1); color:#e88; font-size:13px; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all 0.2s;" onmouseover="this.style.background='rgba(192,57,43,0.25)'" onmouseout="this.style.background='rgba(192,57,43,0.1)'">✕ Avvis</button>
      </div>
    </div>`).join('');
}
async function approvePendingUser(userId, displayName) {
  const { error } = await db.rpc('approve_user', { target_user_id: userId });
  if (error) { alert('Feil ved godkjenning: ' + error.message); return; }
  await loadPendingUsersList();
  await loadDashboard();
}
async function rejectPendingUser(userId, displayName) {
  const confirmed = await showConfirm(`Avvis og slett kontoen til ${displayName}?`, 'Avvis');
  if (!confirmed) return;
  await db.from('profiles').delete().eq('id', userId);
  await loadPendingUsersList();
  await loadDashboard();
}

// ── LIVE PAGE ──
let _liveRefreshInterval = null;
let _currentLiveRoundId = null;
let _liveLoading = false;

async function loadLivePage() {
  if (_liveLoading) return;
  _liveLoading = true;
  if (_liveRefreshInterval) { clearInterval(_liveRefreshInterval); _liveRefreshInterval = null; }
  try {
    const el = document.getElementById('liveContent');
    const sub = document.getElementById('liveSubtitle');
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Laster...</div>';

    const { data: active } = await db.from('rounds')
      .select('*, courses(name, holes), tee_sets(name, slope), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name)))')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (!active?.length) {
      sub.textContent = 'Ingen aktive runder akkurat nå';
      el.innerHTML = `
        <div style="text-align:center; padding:60px 20px; color:var(--cream-dim);">
          <div style="font-size:48px; margin-bottom:16px;">⛳</div>
          <div style="font-size:16px; margin-bottom:8px; color:var(--cream);">Ingen aktive runder</div>
          <div style="font-size:13px;">Når noen starter en runde vil den vises her</div>
        </div>`;
      return;
    }

    const round = active[0];
    _currentLiveRoundId = round.id;
    sub.textContent = round.courses?.name + ' · ' + round.date;
    await renderLiveView(round);
    _liveRefreshInterval = setInterval(() => loadLivePage(), 20000);
  } finally {
    _liveLoading = false;
  }
}

async function renderLiveView(round) {
  const el = document.getElementById('liveContent');
  const roundId = round.id;

  const { data: scores } = await db.from('scores').select('*').eq('round_id', roundId);
  const allFP = (round.flights || []).flatMap(f => f.flight_players || []);
  // Build score map
  const scoreMap = {};
  (scores || []).forEach(s => {
    if (!scoreMap[s.player_id]) scoreMap[s.player_id] = {};
    scoreMap[s.player_id][s.hole_number] = s.strokes;
  });

  // Get hole data, filtered by hole_range
  const { data: holes } = await db.from('holes').select('*').eq('course_id', round.course_id).order('hole_number');
  const _liveRange = round.hole_range || 'all';
  const _liveActiveHoles = _liveRange === 'front9' ? (holes||[]).filter(h => h.hole_number <= 9)
    : _liveRange === 'back9' ? (holes||[]).filter(h => h.hole_number >= 10) : (holes||[]);
  const holeCount = _liveActiveHoles.length || round.courses?.holes || 18;
  const holeMap = {};
  _liveActiveHoles.forEach(h => { holeMap[h.hole_number] = h; });
  const _livePar = (holes||[]).reduce((s,h) => s + (h.par||0), 0) || 72;

  // Calculate standings
  const standings = allFP.map(fp => {
    const playerScores = scoreMap[fp.player_id] || {};
    let stableford = 0;
    let holesPlayed = 0;
    Object.entries(playerScores).forEach(([hn, strokes]) => {
      if (strokes > 0) {
        holesPlayed++;
        const h = holeMap[parseInt(hn)];
        if (h?.par && h?.stroke_index) {
          stableford += calcStablefordLive(strokes, h.par, _playingHcp(fp.handicap, round.tee_sets?.slope, round.tee_sets?.course_rating, _livePar), h.stroke_index, 18);
        }
      }
    });
    return { fp, name: fp.profiles?.display_name || '?', stableford, holesPlayed, scores: playerScores };
  }).sort((a, b) => b.stableford - a.stableford);

  const maxHole = standings.reduce((max, s) => Math.max(max, s.holesPlayed), 0);

  // Build feed events
  const feedEvents = [];
  (scores || []).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 12).forEach(s => {
    if (!s.strokes) return;
    const h = holeMap[s.hole_number];
    const fp = allFP.find(p => p.player_id === s.player_id);
    if (!fp || !h?.par) return;
    const diff = s.strokes - h.par;
    let label = '', dot = '#888780', emoji = '';
    if (s.strokes === 1) { label = 'Hole in One'; dot = '#fac775'; emoji = '🏆'; }
    else if (diff <= -2) { label = 'Eagle'; dot = '#fac775'; emoji = '🦅'; }
    else if (diff === -1) { label = 'Birdie'; dot = '#85b7eb'; emoji = '🐦'; }
    else if (diff === 0) { label = 'Par'; dot = '#888780'; emoji = ''; }
    else if (diff === 1) { label = 'Bogey'; dot = '#f09595'; emoji = ''; }
    else { label = `+${diff}`; dot = '#e24b4a'; emoji = ''; }
    const firstName = (fp.profiles?.display_name || '?').split(' ')[0];
    feedEvents.push({ hole: s.hole_number, par: h.par, label, dot, emoji, firstName, strokes: s.strokes, created_at: s.created_at });
  });

  // Scorecards for all players — PGA style
  const holes9 = _liveActiveHoles.map(h => h.hole_number);
  function buildScorecard(playerScores, hcp) {
    return holes9.map(hn => {
      const h = holeMap[hn];
      const strokes = playerScores[hn];
      if (!strokes || !h?.par) return `
        <div style="text-align:center; padding:2px 1px;">
          <div style="width:28px; height:28px; margin:0 auto; display:flex; align-items:center; justify-content:center; font-size:13px; color:rgba(255,255,255,0.2);">–</div>
          <div style="font-size:9px; color:rgba(255,255,255,0.15); margin-top:1px;">–</div>
        </div>`;
      const diff = strokes - h.par;
      const pts = h.stroke_index ? calcStablefordLive(strokes, h.par, hcp || 36, h.stroke_index, 18) : 0;

      // PGA shapes
      let cellStyle = '';
      let textColor = 'var(--cream)';
      if (strokes === 1) {
        // Hole in one — gull dobbel sirkel
        cellStyle = `width:28px;height:28px;border-radius:50%;background:#fac775;color:#412402;outline:2px solid #ef9f27;outline-offset:2px;`;
      } else if (diff <= -2) {
        // Eagle — gul firkant med dobbel border
        cellStyle = `width:26px;height:26px;border-radius:2px;background:#faeeda;color:#633806;outline:2px solid #fac775;outline-offset:2px;`;
      } else if (diff === -1) {
        // Birdie — blå sirkel
        cellStyle = `width:28px;height:28px;border-radius:50%;background:transparent;color:#85b7eb;border:2px solid #85b7eb;`;
      } else if (diff === 0) {
        // Par — ingen markering
        cellStyle = `width:28px;height:28px;border-radius:2px;background:transparent;color:var(--cream);`;
      } else if (diff === 1) {
        // Bogey — enkel firkant
        cellStyle = `width:26px;height:26px;border-radius:2px;background:transparent;color:#f09595;border:2px solid #f09595;`;
      } else {
        // Dobbelt+ — dobbel firkant (rød fylt)
        cellStyle = `width:26px;height:26px;border-radius:2px;background:#e24b4a;color:#fff;outline:2px solid #e24b4a;outline-offset:2px;`;
      }

      return `
        <div style="text-align:center; padding:2px 1px;">
          <div style="margin:0 auto; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600; ${cellStyle}">${strokes}</div>
          <div style="font-size:9px; color:${pts >= 3 ? '#fac775' : pts === 2 ? 'var(--cream-dim)' : '#f09595'}; margin-top:2px; font-weight:500;">${pts}p</div>
        </div>`;
    }).join('');
  }
  const allScorecardsHtml = standings.map(s => `
    <div style="margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; padding-left:2px;">
        <div style="font-size:13px; color:var(--cream); font-weight:500;">${s.name}</div>
        <div style="font-size:12px; color:var(--gold);">${s.stableford}p totalt</div>
      </div>
      <div style="background:rgba(0,0,0,0.2); border-radius:10px; padding:10px 12px; border:1px solid rgba(255,255,255,0.06);">
        <div style="display:grid; grid-template-columns:repeat(9,1fr); gap:2px; margin-bottom:4px;">
          ${holes9.map(hn => {
            const h = holeMap[hn];
            return `<div style="text-align:center; font-size:10px; color:var(--cream-dim); padding:1px;">${hn}${h?.par ? `<span style="color:rgba(255,255,255,0.25);font-size:8px;"> p${h.par}</span>` : ''}</div>`;
          }).join('')}
        </div>
        <div style="display:grid; grid-template-columns:repeat(9,1fr); gap:2px;">
          ${buildScorecard(s.scores, _playingHcp(s.fp.handicap, round.tee_sets?.slope, round.tee_sets?.course_rating, _livePar))}
        </div>
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div style="background:rgba(201,168,76,0.08); border:1px solid rgba(201,168,76,0.25); border-radius:12px; padding:14px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-size:11px; color:var(--gold); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">🟢 Live · Hull ${maxHole} av ${holeCount}</div>
        <div style="font-size:16px; color:var(--cream); font-weight:500;">${round.courses?.name}</div>
        <div style="font-size:12px; color:var(--cream-dim); margin-top:2px;">${round.date} · ${round.tee_sets?.name || ''}</div>
      </div>
      <button onclick="shareLiveLink('${roundId}', '${round.courses?.name || ''}')" style="background:rgba(201,168,76,0.15); border:1px solid rgba(201,168,76,0.3); color:var(--gold); padding:10px 14px; border-radius:10px; cursor:pointer; font-size:13px; font-family:'DM Sans',sans-serif; white-space:nowrap;">📤 Del</button>
    </div>

    <div style="font-size:11px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px;">Leaderboard</div>
    <div style="background:rgba(0,0,0,0.2); border-radius:12px; overflow:hidden; margin-bottom:16px; border:1px solid rgba(255,255,255,0.06);">
      ${standings.map((s, i) => {
        const isLead = i === 0;
        return `<div style="display:flex; align-items:center; gap:12px; padding:13px 16px; ${i < standings.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.05)' : ''}; ${isLead ? 'background:rgba(201,168,76,0.07)' : ''};">
          <div style="font-size:13px; color:var(--cream-dim); min-width:20px; text-align:center;">${i+1}</div>
          <div style="flex:1;">
            <div style="font-size:14px; color:var(--cream); font-weight:${isLead ? '600' : '400'};">${s.name}</div>
            <div style="font-size:11px; color:var(--cream-dim);">HCP ${s.fp.handicap || '–'} · thru ${s.holesPlayed}</div>
          </div>
          <div style="font-size:22px; font-weight:600; color:var(--gold); min-width:40px; text-align:right;">${s.stableford}p</div>
        </div>`;
      }).join('')}
    </div>

    ${feedEvents.length ? `
    <div style="font-size:11px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px;">Live feed</div>
    <div style="background:rgba(0,0,0,0.2); border-radius:12px; padding:14px 16px; margin-bottom:16px; border:1px solid rgba(255,255,255,0.06);">
      ${feedEvents.slice(0, 6).map((e, i) => `
        <div style="display:flex; gap:10px; align-items:flex-start; ${i > 0 ? 'margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.05);' : ''}">
          <div style="width:8px; height:8px; border-radius:50%; background:${e.dot}; flex-shrink:0; margin-top:5px;"></div>
          <div>
            <div style="font-size:13px; font-weight:500; color:var(--cream);">Hull ${e.hole} · Par ${e.par}</div>
            <div style="font-size:12px; color:var(--cream-dim); margin-top:2px;">${e.firstName} slo ${e.label}${e.emoji ? ' ' + e.emoji : ''} · ${e.strokes} slag</div>
          </div>
        </div>`).join('')}
    </div>` : ''}

    <div style="font-size:11px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px;">Scorecards</div>
    ${allScorecardsHtml}

    <div style="font-size:11px; color:var(--cream-dim); text-align:center; margin-top:8px;">Oppdateres automatisk hvert 20 sek</div>
  `;
}

function calcStablefordLive(strokes, par, hcp, si, totalHoles) {
  let extra = Math.floor(hcp / totalHoles);
  if (si <= (hcp % totalHoles)) extra++;
  return Math.max(0, par - (strokes - extra) + 2);
}

function showShareRoundModal(roundId, courseName, date) {
  document.getElementById('shareRoundDesc').textContent = `${courseName} · ${date}`;
  window._shareRoundId = roundId;
  window._shareCourseName = courseName;
  openModal('modalShareRound');
}

function doShareRound() {
  shareLiveLink(window._shareRoundId, window._shareCourseName);
}

function shareLiveLink(roundId, courseName) {
  const url = `${location.origin}${location.pathname}#live`;
  const text = `🏌️ ${courseName || 'Golfrunde'} er i gang – følg med live!\n${url}`;
  if (navigator.share) {
    navigator.share({ title: 'The Fantastic FORE! – Live', text, url })
      .catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => {
      alert('Live-lenke kopiert til utklippstavlen!');
    }).catch(() => {
      prompt('Kopier lenken:', url);
    });
  }
}

// URL routing: #live åpner Live-tab direkte

// ── CLAUDE PROXY HELPER ──
async function callClaudeProxy(fileData, fileType, prompt, maxTokens = 1500) {
  const mediaType = fileType === 'application/pdf' ? 'application/pdf' : fileType;
  const contentType = fileType === 'application/pdf' ? 'document' : 'image';
  const response = await fetch(CLAUDE_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: [
        { type: contentType, source: { type: 'base64', media_type: mediaType, data: fileData } },
        { type: 'text', text: prompt }
      ]}]
    })
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Proxy-feil (${response.status})${errText ? ': ' + errText.slice(0, 200) : ''}`);
  }
  const data = await response.json();
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
  const text = (data.content || []).map(c => c.text || '').join('');
  if (!text) throw new Error('Tomt svar fra Claude – prøv igjen');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Fant ingen JSON i svaret: ' + text.slice(0, 120));
  return JSON.parse(jsonMatch[0]);
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

// ── CONFIRM DIALOG ──
function showConfirm(message, confirmText = 'Slett') {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--green-dark);border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:28px;max-width:400px;width:100%;";
    const p = document.createElement("p");
    p.style.cssText = "color:var(--cream);font-size:15px;margin-bottom:24px;line-height:1.5;";
    p.textContent = message;
    const btns = document.createElement("div");
    btns.style.cssText = "display:flex;gap:12px;justify-content:flex-end;";
    const no = document.createElement("button");
    no.textContent = "Avbryt";
    no.style.cssText = "padding:10px 20px;border-radius:8px;border:1px solid rgba(201,168,76,0.4);background:transparent;color:var(--gold);font-size:14px;cursor:pointer;touch-action:manipulation;";
    const yes = document.createElement("button");
    yes.textContent = confirmText;
    yes.style.cssText = "padding:10px 20px;border-radius:8px;border:none;background:var(--danger);color:white;font-size:14px;cursor:pointer;font-weight:600;touch-action:manipulation;";
    btns.appendChild(no);
    btns.appendChild(yes);
    box.appendChild(p);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    yes.onclick = () => { overlay.remove(); resolve(true); };
    no.onclick = () => { overlay.remove(); resolve(false); };
  });
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


// ── START ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
init();


async function _resumeScoring() {
  if (!currentRound?.id) return;
  // Re-fetch scores in case other players scored while phone was asleep
  const { data: scores } = await db.from('scores').select('*').eq('round_id', currentRound.id);
  if (scores) {
    roundScores = {};
    scores.forEach(s => {
      if (!roundScores[s.player_id]) roundScores[s.player_id] = {};
      roundScores[s.player_id][s.hole_number] = s.strokes;
    });
  }
  renderScoringHole();
}

let _visibilityDebounce = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentProfile) {
    clearTimeout(_visibilityDebounce);
    _visibilityDebounce = setTimeout(async () => {
      // Scoring screen open: restore full state instead of touching other pages
      if (document.getElementById('scoringScreen')?.style.display !== 'none') {
        await _resumeScoring();
        return;
      }
      const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
      if (activePage === 'dashboard') loadDashboard();
      else if (activePage === 'rounds') loadRounds();
      else if (activePage === 'live') loadLivePage();
      else if (activePage === 'profile') {
        if (document.getElementById('statsKpis')) loadAndRenderDifferentials();
        else loadProfilePage();
      }
    }, 500);
  }
});
