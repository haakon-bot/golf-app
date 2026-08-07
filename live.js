// ── LIVE PAGE ──
let _currentLiveRoundId = null;
let _liveLoading = false;

async function loadLivePage() {
  if (_liveLoading) return;
  _liveLoading = true;
  const btn = document.getElementById('liveRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const el = document.getElementById('liveContent');
    const sub = document.getElementById('liveSubtitle');
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Laster...</div>';

    const { data: active } = await db.from('rounds')
      .select('*, courses(name, holes), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name))), games(*)')
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
  } finally {
    _liveLoading = false;
    const btn = document.getElementById('liveRefreshBtn');
    if (btn) { btn.disabled = false; btn.textContent = '↻ Oppdater'; }
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
    const phcp = _playingHcp(fp.handicap, round.tee_sets?.slope, round.tee_sets?.course_rating, _livePar);
    let stableford = 0, brutto = 0, netto = 0, parThru = 0, holesPlayed = 0;
    Object.entries(playerScores).forEach(([hn, strokes]) => {
      if (strokes > 0) {
        const h = holeMap[parseInt(hn)];
        if (h?.par && h?.stroke_index) {
          let extra = Math.floor(phcp / 18);
          if (h.stroke_index <= (phcp % 18)) extra++;
          stableford += calcStableford(strokes, h.par, phcp, h.stroke_index, 18);
          brutto += strokes;
          netto += strokes - extra;
          parThru += h.par;
          holesPlayed++;
        }
      }
    });
    const bruttoVsPar = holesPlayed ? brutto - parThru : null;
    const nettoVsPar = holesPlayed ? netto - parThru : null;
    return { fp, name: fp.profiles?.display_name || '?', stableford, holesPlayed, scores: playerScores, bruttoVsPar, nettoVsPar, phcp };
  }).sort((a, b) => b.stableford - a.stableford);

  const maxHole = standings.reduce((max, s) => Math.max(max, s.holesPlayed), 0);

  // Compute skins via spillmotoren (skins-modulen). Flat skinsMap: playerId → antall.
  const skinsMap = {};
  const _skins = getGame('skins').compute({
    round, holes: _liveActiveHoles, scores: scoreMap,
    flights: round.flights || [], fullCoursePar: _livePar,
  });
  if (_skins) _skins.flights.forEach(f => Object.assign(skinsMap, f.skinsByPlayer));

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

  window._liveContext = { standings, holes: _liveActiveHoles, holeMap, round, _livePar };

  const holeNums = _liveActiveHoles.map(h => h.hole_number);
  const gridCols = Math.min(holeNums.length, 9);
  function buildScorecard(playerScores, hcp) {
    return holeNums.map(hn => {
      const h = holeMap[hn];
      const strokes = playerScores[hn];
      if (!strokes || !h?.par) return `<div style="text-align:center;padding:3px 1px;"><div style="width:28px;height:28px;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:13px;color:rgba(255,255,255,0.2);">–</div><div style="font-size:9px;color:rgba(255,255,255,0.15);margin-top:2px;">–</div></div>`;
      const diff = strokes - h.par;
      const pts = h.stroke_index ? calcStableford(strokes, h.par, hcp, h.stroke_index, 18) : 0;
      let bs = 'width:28px;height:28px;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;';
      let col = 'var(--cream)';
      if (diff <= -2)      { col='#c8c0b0'; bs+='border-radius:50%;border:2px solid #c8c0b0;box-shadow:0 0 0 2px #0d2818,0 0 0 4px #c8c0b0;'; }
      else if (diff === -1){ col='#c8c0b0'; bs+='border-radius:50%;border:2px solid #c8c0b0;'; }
      else if (diff === 1) { col='#c8c0b0'; bs+='border-radius:2px;border:2px solid #c8c0b0;'; }
      else if (diff >= 2)  { col='#c8c0b0'; bs+='border-radius:2px;border:2px solid #c8c0b0;box-shadow:0 0 0 2px #0d2818,0 0 0 4px #c8c0b0;'; }
      return `<div style="text-align:center;padding:4px 1px;"><div style="color:${col};${bs}">${strokes}</div><div style="font-size:9px;color:${pts>=3?'#fac775':pts===2?'rgba(255,255,255,0.5)':'#f09595'};margin-top:3px;font-weight:500;">${pts}p</div></div>`;
    }).join('');
  }

  el.innerHTML = `
    <div style="background:rgba(201,168,76,0.08); border:1px solid rgba(201,168,76,0.25); border-radius:12px; padding:14px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-size:11px; color:var(--gold); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">🟢 Live · Hull ${maxHole} av ${holeCount}</div>
        <div style="font-size:16px; color:var(--cream); font-weight:500;">${round.courses?.name}</div>
        <div style="font-size:12px; color:var(--cream-dim); margin-top:2px;">${round.date} · ${round.tee_sets?.name || ''}</div>
      </div>
      <button onclick="shareLiveLink('${roundId}', '${round.courses?.name || ''}')" style="background:rgba(201,168,76,0.15); border:1px solid rgba(201,168,76,0.3); color:var(--gold); padding:10px 14px; border-radius:10px; cursor:pointer; font-size:13px; font-family:'DM Sans',sans-serif; white-space:nowrap;">📤 Del</button>
    </div>

    <div style="font-size:11px; color:var(--cream-dim); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px;">Leaderboard <span style="text-transform:none;letter-spacing:0;font-size:10px;opacity:0.7;">(trykk på spiller for fullt scorecard)</span></div>
    <div style="background:rgba(0,0,0,0.2); border-radius:12px; overflow:hidden; margin-bottom:16px; border:1px solid rgba(255,255,255,0.06);">
      ${standings.map((s, i) => {
        const isLead = i === 0;
        const firstName = s.name.split(' ')[0];
        const scHtml = (() => {
          const hdr = holeNums.map(hn => { const h=holeMap[hn]; return `<div style="text-align:center;font-size:10px;color:var(--cream-dim);padding:1px;">${hn}${h?.par?`<span style="color:rgba(255,255,255,0.25);font-size:8px;"> p${h.par}</span>`:''}</div>`; }).join('');
          const cells = buildScorecard(s.scores, s.phcp);
          return `<div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:10px 12px;border:1px solid rgba(255,255,255,0.06);"><div style="display:grid;grid-template-columns:repeat(${gridCols},1fr);gap:2px;margin-bottom:4px;">${hdr}</div><div style="display:grid;grid-template-columns:repeat(${gridCols},1fr);gap:2px;">${cells}</div></div>`;
        })();
        return `<div style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <div onclick="toggleLiveScorecardRow('${s.fp.player_id}')" style="display:grid;grid-template-columns:24px 1fr auto auto auto;align-items:center;gap:8px;padding:12px 16px;${isLead ? 'background:rgba(201,168,76,0.07);' : ''}cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <div style="font-size:13px;color:${isLead ? 'var(--gold)' : 'var(--cream-dim)'};text-align:center;">${i+1}</div>
            <div>
              <div style="font-size:14px;color:var(--cream);font-weight:${isLead ? '600' : '400'};">${firstName}</div>
              <div style="font-size:11px;color:var(--cream-dim);">thru ${s.holesPlayed} · HCP ${s.fp.handicap ?? '–'}${skinsAmount(round) ? ` · ${skinsMap[s.fp.player_id] ?? 0} skins` : ''}</div>
            </div>
            <div style="text-align:center;min-width:38px;">
              <div style="font-size:10px;color:var(--cream-dim);margin-bottom:2px;">Brutto</div>
              <div style="font-size:14px;font-weight:600;color:${_vsParColor(s.bruttoVsPar)};">${_fmtVsPar(s.bruttoVsPar)}</div>
            </div>
            <div style="text-align:center;min-width:38px;">
              <div style="font-size:10px;color:var(--cream-dim);margin-bottom:2px;">Netto</div>
              <div style="font-size:14px;font-weight:600;color:${_vsParColor(s.nettoVsPar)};">${_fmtVsPar(s.nettoVsPar)}</div>
            </div>
            <div style="text-align:center;min-width:38px;">
              <div style="font-size:10px;color:var(--cream-dim);margin-bottom:2px;">Stab</div>
              <div style="font-size:16px;font-weight:600;color:var(--gold);">${s.stableford}p</div>
            </div>
          </div>
          <div id="lvsc-${s.fp.player_id}" style="display:none;padding:0 16px 14px;background:rgba(0,0,0,0.15);">${scHtml}</div>
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

    <div style="font-size:11px; color:var(--cream-dim); text-align:center; margin-top:8px;">Sist oppdatert: ${new Date().toLocaleTimeString('no-NO', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
  `;
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
  // Runde-spesifikk lenke (§2.7) — to samtidige konkurranser kolliderer ikke.
  const url = `${location.origin}${location.pathname}${roundId ? '#live=' + roundId : '#live'}`;
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
// ── Bli med / join (§2.7 G3) ──────────────────────────────────────────────
// Arrangøren deler én kort kode/lenke; hver spiller åpner den, velger seg selv
// fra oppsettet → rutes til sin flights scoring. Krever join-migreringen
// (rounds.join_code + flight_players.claimed_at).
function _genJoinCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // uten forvekslbare (0/O, 1/I)
  let s = ''; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
async function shareJoinLink(roundId, courseName) {
  if (!roundId) return;
  try {
    const { data: round, error } = await db.from('rounds').select('id, join_code').eq('id', roundId).single();
    if (error) throw error;
    let code = round?.join_code;
    if (!code) {
      code = _genJoinCode();
      const { error: e2 } = await db.from('rounds').update({ join_code: code }).eq('id', roundId);
      if (e2) throw e2;
    }
    const url = `${location.origin}${location.pathname}#join=${code}`;
    const text = `⛳ Bli med i golfspillet${courseName ? ' på ' + courseName : ''}!\nKode: ${code}\n${url}`;
    if (navigator.share) navigator.share({ title: 'Bli med – The Fantastic FORE!', text, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => alert('Bli-med-lenke kopiert!\nKode: ' + code)).catch(() => prompt('Kopier lenken:', url));
  } catch (e) {
    alert('Kunne ikke lage bli-med-kode. Er join-migreringen kjørt i Supabase?\n' + (e.message || ''));
  }
}
function _joinHashCode() { const m = (location.hash || '').match(/^#join=(.+)$/); return m ? decodeURIComponent(m[1]) : null; }
let _joinInterval = null;
async function showJoinPage() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('publicLivePage').style.display = 'none';
  const pend = document.getElementById('pendingPage'); if (pend) pend.style.display = 'none';
  document.getElementById('joinPage').style.display = 'block';
  await renderJoinPage();
  if (!_joinInterval) _joinInterval = setInterval(renderJoinPage, 6000);   // gråing oppdateres
}
async function renderJoinPage() {
  const code = _joinHashCode();
  const statusEl = document.getElementById('joinStatus');
  const contentEl = document.getElementById('joinContent');
  if (!code) { contentEl.innerHTML = _joinMsg('Mangler kode', 'Lenken må inneholde en kode.'); return; }
  const { data: round, error } = await db.from('rounds')
    .select('id, join_code, date, status, courses(name), flights(id, name, flight_players(id, player_id, claimed_at, profiles(display_name)))')
    .eq('join_code', code).single();
  if (error || !round) { statusEl.textContent = ''; contentEl.innerHTML = _joinMsg('Fant ikke spillet', 'Sjekk koden, eller be arrangøren dele på nytt.'); return; }
  statusEl.textContent = `${round.courses?.name || ''} · ${round.date}`;
  const myFpId = localStorage.getItem('fore_me_' + round.id);
  const flights = (round.flights || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const flightHtml = flights.map(f => {
    const rows = (f.flight_players || []).map(fp => {
      const name = fp.profiles?.display_name || '?';
      const mine = myFpId === fp.id;
      const taken = !!fp.claimed_at && !mine;
      const style = taken ? 'opacity:0.4;' : '';
      const right = mine ? `<span style="font-size:11px;color:var(--green-light);">✓ deg</span>`
        : taken ? `<span style="font-size:11px;color:var(--cream-dim);">allerede med</span>`
        : `<span style="font-size:12px;color:var(--gold);">Velg →</span>`;
      const onclick = (taken || mine) ? '' : `onclick="claimSelf('${fp.id}','${round.id}')"`;
      return `<div ${onclick} style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-radius:10px;background:rgba(0,0,0,0.2);border:1px solid ${mine ? 'var(--green-light)' : 'rgba(255,255,255,0.08)'};margin-bottom:6px;cursor:${(taken || mine) ? 'default' : 'pointer'};${style}-webkit-tap-highlight-color:transparent;">
        <span style="font-size:14px;color:var(--cream);">${name}</span>${right}
      </div>`;
    }).join('');
    return `<div style="margin-bottom:18px;">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">${f.name || 'Flight'}</div>
      ${rows || '<div style="font-size:12px;color:var(--cream-dim);">Ingen spillere.</div>'}
    </div>`;
  }).join('');
  contentEl.innerHTML = `<div style="font-size:13px;color:var(--cream-dim);margin-bottom:16px;text-align:center;">Finn navnet ditt og trykk «Velg» — du rutes til din flight.</div>${flightHtml}`;
}
function _joinMsg(title, sub) {
  return `<div style="text-align:center;padding:50px 20px;color:var(--cream-dim);"><div style="font-size:40px;margin-bottom:12px;">⛳</div><div style="font-size:16px;color:var(--cream);">${title}</div><div style="font-size:13px;margin-top:8px;">${sub}</div></div>`;
}
async function claimSelf(fpId, roundId) {
  try {
    await db.from('flight_players').update({ claimed_at: new Date().toISOString() }).eq('id', fpId);
  } catch (e) { /* claimed_at kan mangle før migrering — fortsett likevel */ }
  localStorage.setItem('fore_me_' + roundId, fpId);   // enhets-identitet (også for gjest, G4)
  if (_joinInterval) { clearInterval(_joinInterval); _joinInterval = null; }
  if (currentProfile) {
    document.getElementById('joinPage').style.display = 'none';
    showApp();
    openRound(roundId);
  } else {
    // Gjest uten innlogging: full gjeste-tasting kommer i G4.
    document.getElementById('joinContent').innerHTML = _joinMsg('Du er med! ✓', 'Gjeste-tasting uten innlogging kommer straks. Logg inn for å taste nå.') +
      `<div style="text-align:center;margin-top:16px;"><button onclick="showLoginFromPublic()" class="btn btn-outline" style="font-size:13px;padding:10px 24px;">Logg inn</button></div>`;
  }
}
function toggleLiveScorecardRow(playerId) {
  const target = document.getElementById('lvsc-' + playerId);
  if (!target) return;
  const isOpen = target.style.display !== 'none';
  document.querySelectorAll('[id^="lvsc-"]').forEach(e => { e.style.display = 'none'; });
  if (!isOpen) target.style.display = 'block';
}
