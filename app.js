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
