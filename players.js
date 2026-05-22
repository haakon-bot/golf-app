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
