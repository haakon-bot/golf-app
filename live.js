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
      .select('*, courses(name, holes), tee_sets(name, slope, course_rating), flights(id, name, flight_players(id, player_id, handicap, profiles(display_name)))')
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
          stableford += calcStablefordLive(strokes, h.par, phcp, h.stroke_index, 18);
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
      const pts = h.stroke_index ? calcStablefordLive(strokes, h.par, hcp, h.stroke_index, 18) : 0;
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
              <div style="font-size:11px;color:var(--cream-dim);">thru ${s.holesPlayed} · HCP ${s.fp.handicap ?? '–'}</div>
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
function toggleLiveScorecardRow(playerId) {
  const target = document.getElementById('lvsc-' + playerId);
  if (!target) return;
  const isOpen = target.style.display !== 'none';
  document.querySelectorAll('[id^="lvsc-"]').forEach(e => { e.style.display = 'none'; });
  if (!isOpen) target.style.display = 'block';
}
