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
      if (strokes === 1) {
        cellStyle = `width:28px;height:28px;border-radius:50%;background:#fac775;color:#412402;outline:2px solid #ef9f27;outline-offset:2px;`;
      } else if (diff <= -2) {
        cellStyle = `width:26px;height:26px;border-radius:2px;background:#faeeda;color:#633806;outline:2px solid #fac775;outline-offset:2px;`;
      } else if (diff === -1) {
        cellStyle = `width:28px;height:28px;border-radius:50%;background:transparent;color:#85b7eb;border:2px solid #85b7eb;`;
      } else if (diff === 0) {
        cellStyle = `width:28px;height:28px;border-radius:2px;background:transparent;color:var(--cream);`;
      } else if (diff === 1) {
        cellStyle = `width:26px;height:26px;border-radius:2px;background:transparent;color:#f09595;border:2px solid #f09595;`;
      } else {
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
