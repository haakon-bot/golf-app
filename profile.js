// ── PROFILE ──
// Ren spillapp (aug 2026): INGEN HCP-forvaltning. Fjernet Golfbox/Gimmie-import,
// score_differentials, estimert HCP, HCP-utvikling og HCP-motivasjon (git-tag
// v1.157-pre-profile-cleanup bevarer den gamle varianten). HCP er ett tall
// spilleren taster selv — redigeres her eller i rundeoppsettet.
let _profileLoading = false;

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
    <div style="text-align:center;padding:22px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:14px;margin-bottom:20px;">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Handicap</div>
      <div style="font-family:'Playfair Display',serif;font-size:52px;color:var(--gold-light);line-height:1;">${p.handicap ?? '–'}</div>
      <div style="font-size:12px;color:var(--cream-dim);margin-top:8px;">Tallet du taster selv. Rediger under «Rediger profil» eller i rundeoppsettet.</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:2px;">
      ${_makeCollapsibleHTML('secRunder', '<i class="ti ti-clipboard-list" style="font-size:15px;vertical-align:-2px;margin-right:6px;"></i>Mine runder', `
        <div id="alleRunderList"><div class="loading"><div class="spinner"></div></div></div>
      `)}
      ${_makeCollapsibleHTML('secEditProfile', '<i class="ti ti-pencil" style="font-size:15px;vertical-align:-2px;margin-right:6px;"></i>Rediger profil', `
        <div id="profileAlert"></div>
        <div class="form-group"><label>Visningsnavn</label><input type="text" id="editDisplayName" value="${p.display_name || ''}"></div>
        <div class="form-group"><label>Handicap (HCP)</label><input type="number" id="editHcp" value="${p.handicap ?? ''}" step="0.1" min="-10" max="54"></div>
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
  `;
  _profileLoading = false;
}

// Mine runder: runder spilt i DENNE appen som profilen var med i. Trykk →
// fullt spill/scorekort (rundeoppsummering) for å mimre. Aktiv → fortsett.
async function _lazyLoadAlleRunder() {
  const el = document.getElementById('alleRunderList');
  if (!el) return;
  const { data: rounds } = await db.from('rounds')
    .select('id, date, hole_range, status, courses(name), flights(flight_players(player_id))')
    .order('date', { ascending: false });
  const mine = (rounds || []).filter(r => r.flights?.some(f => f.flight_players?.some(fp => fp.player_id === currentProfile.id)));
  if (!mine.length) { el.innerHTML = '<p style="font-size:13px;color:var(--cream-dim);">Ingen runder spilt ennå.</p>'; return; }
  el.innerHTML = mine.map(r => {
    const range = r.hole_range === 'front9' ? 'Hull 1–9' : r.hole_range === 'back9' ? 'Hull 10–18' : 'Full runde';
    const done = r.status === 'completed';
    const click = done ? `showRoundSummary('${r.id}')` : `openRound('${r.id}')`;
    return `<div onclick="${click}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;-webkit-tap-highlight-color:transparent;">
      <div style="min-width:0;">
        <div style="font-size:13px;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.courses?.name || '–'}</div>
        <div style="font-size:11px;color:var(--cream-dim);margin-top:2px;">${r.date} · ${range}</div>
      </div>
      <div style="flex-shrink:0;font-size:12px;color:${done ? 'var(--gold)' : 'var(--green-light)'};">${done ? 'Se spillet →' : '🟢 Aktiv →'}</div>
    </div>`;
  }).join('');
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
  const hcpVal = document.getElementById('editHcp').value;
  const handicap = hcpVal === '' ? null : parseFloat(hcpVal);
  if (!displayName) { showAlert('profileAlert', 'Visningsnavn kan ikke være tomt', 'error'); return; }
  const { error } = await db.from('profiles').update({ display_name: displayName, handicap }).eq('id', currentProfile.id);
  if (error) { showAlert('profileAlert', 'Feil: ' + error.message, 'error'); return; }
  currentProfile.display_name = displayName;
  currentProfile.handicap = handicap;
  showAlert('profileAlert', '✅ Lagret!', 'success');
  setTimeout(() => loadProfilePage(), 700);
}
