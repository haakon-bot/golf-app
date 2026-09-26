// ==========================================================================
// Sidekonkurranse / Junk (SPILLAPP-SPEC.md §4/§10) — nærmest pin / lengst
// drive på valgte hull. Konfigureres i oppsettet (hvilke hull, hvilken type,
// poeng ved seier). Alle flighter kan registrere forsøk når de spiller
// hullet; vinneren MÅ bekreftes i rundeoppsummeringen før poengene telles —
// bekreftelse er alltid tilgjengelig der, uavhengig av om runden er lukket
// (rounds.status settes til 'completed' av FØRSTE flight som trykker
// «Avslutt», ikke siste — å binde bekreftelse til det ville låse feil
// vinner hvis en annen flight ikke er ferdig med hullet ennå).
//
// game_events-kontrakt:
//   'junk_entry'     — player_id = den som slo/puttet, hole_number, payload:{kind,value}
//   'junk_confirmed' — player_id = bekreftet vinner, hole_number, payload:{kind}
// Append-only → siste (nyeste created_at) gjelder for begge typer, så en
// feilregistrering eller ombestemt vinner rettes med en ny hendelse, ikke
// en oppdatering.
//
// Poengene teller KUN inn i turneringens sammenlagt-sum (tournament.js),
// ikke i rundens egen Stableford-visning noe sted i appen (besluttet
// sept 2026) — enklest og lavest risiko, ingen eksisterende visning endres.
// ==========================================================================

// Én kilde til sannhet for alle fire konkurransetypene: hvilken retning som
// "vinner" (laveste/høyeste verdi), enhet og etikett. closest_pin/longest_drive
// er de opprinnelige (positive poeng); farthest_pin/shortest_drive er de
// "gøyale" straffevariantene (samme |poeng|, men med minus).
const JUNK_KIND_META = {
  closest_pin:    { label: '🎯 Nærmest pin',    unit: 'cm', better: 'lower',  penalty: false },
  longest_drive:  { label: '🚀 Lengst drive',   unit: 'm',  better: 'higher', penalty: false },
  farthest_pin:   { label: '🤦 Lengst fra pin', unit: 'cm', better: 'higher', penalty: true },
  shortest_drive: { label: '🐌 Kortest drive',  unit: 'm',  better: 'lower',  penalty: true },
};

const JunkGame = {
  type: 'junk',
  meta: {
    navn: 'Sidekonkurranse',
    beskrivelse: 'Nærmest pin / lengst drive på valgte hull — og for de som vil ha det litt gøyere: lengst fra pin / kortest drive med straffepoeng. Alle registrerer forsøk underveis; vinner bekreftes i rundeoppsummeringen.',
    minSpillere: 1,
    maxSpillere: null,
    kreverLag: false,
    kreverIndividuellScore: false,
    roles: ['addon'],
    status: 'ready',
  },

  KIND_META: JUNK_KIND_META,

  defaultConfig() { return { entries: [], points: 2 }; },   // entries: [{hole, kind}]

  setupUI() { return ''; },   // faktisk oppsett-UI rendres av _wizAddonSettingUI (type 'junk') i rounds.js

  validate() { return { ok: true }; },

  // Forsvar mot en config som ble lagret feil/ufullstendig av en tidligere
  // versjon (f.eks. hull-nedtrekket som byttet verdi under seg, fikset sept
  // 2026): dropper alt som ikke er et brukbart {hole:number, kind} par, i
  // stedet for å la et bad-shape-objekt kræsje rendring lenger nede.
  _safeEntries(config) {
    const raw = Array.isArray(config?.entries) ? config.entries : [];
    return raw.filter(e => e && Number.isFinite(e.hole) && JUNK_KIND_META[e.kind]);
  },

  // Siste junk_entry per spiller for hull+type. En senere junk_removed for
  // samme spiller/hull/type fjerner forsøket (append-only — ingenting slettes
  // i databasen, «✕» legger bare til en fjern-hendelse).
  _latestByPlayer(events, hole, kind) {
    const out = {};
    (events || []).forEach(e => {
      if ((e.event_type !== 'junk_entry' && e.event_type !== 'junk_removed') || e.hole_number !== hole || e.payload?.kind !== kind) return;
      // Tidspunkt som tall: lokale (…Z) og server-tider (…+00:00) kan blandes
      const ts = Date.parse(e.created_at || '') || 0;
      if (!out[e.player_id] || ts >= out[e.player_id].ts) out[e.player_id] = { value: e.payload?.value, ts, removed: e.event_type === 'junk_removed' };
    });
    Object.keys(out).forEach(pid => { if (out[pid].removed) delete out[pid]; });
    return out;
  },
  _latestConfirmed(events, hole, kind) {
    let best = null;
    (events || []).forEach(e => {
      if (e.event_type !== 'junk_confirmed' || e.hole_number !== hole || e.payload?.kind !== kind) return;
      if (!best || (e.created_at || '') >= (best.created_at || '')) best = e;
    });
    return best ? best.player_id : null;
  },

  // ctx = { round, flights, events } → { entries: [{hole, kind, points, candidates, bestId, confirmedId}] }
  compute(ctx) {
    const g = gameOfType(ctx.round, 'junk');
    const config = (g && g.config) || {};
    const entries = JunkGame._safeEntries(config);
    const points = Number.isFinite(config.points) ? config.points : 2;
    const allFP = (ctx.flights || []).flatMap(f => f.flight_players || []);
    const nameById = {}; allFP.forEach(fp => { nameById[fp.player_id] = fp.profiles?.display_name || '?'; });
    const evs = ctx.events || [];
    const results = entries.map(entry => {
      const meta = JUNK_KIND_META[entry.kind] || JUNK_KIND_META.closest_pin;
      const latest = JunkGame._latestByPlayer(evs, entry.hole, entry.kind);
      const candidates = Object.entries(latest)
        .map(([pid, v]) => ({ playerId: pid, name: nameById[pid] || '?', value: v.value }))
        .sort((a, b) => meta.better === 'higher' ? b.value - a.value : a.value - b.value);
      // En bekreftet vinner hvis forsøk senere er fjernet (✕) teller ikke
      const confirmed = JunkGame._latestConfirmed(evs, entry.hole, entry.kind);
      return {
        hole: entry.hole, kind: entry.kind, points: meta.penalty ? -points : points,
        candidates, bestId: candidates[0]?.playerId || null,
        confirmedId: candidates.some(c => c.playerId === confirmed) ? confirmed : null,
      };
    });
    return { entries: results };
  },

  // Viser inputfelt for KUN hullet man står på nå (ctx.currentHole).
  trackerUI(ctx) {
    const g = gameOfType(ctx.round, 'junk');
    if (!g) return '';
    const config = g.config || {};
    const here = JunkGame._safeEntries(config).filter(e => e.hole === ctx.currentHole);
    if (!here.length) return '';
    const allFP = (ctx.flights || []).flatMap(f => f.flight_players || []);
    const evs = ctx.events || [];
    const blocks = here.map(entry => {
      const meta = JUNK_KIND_META[entry.kind] || JUNK_KIND_META.closest_pin;
      const latest = JunkGame._latestByPlayer(evs, entry.hole, entry.kind);
      const unit = meta.unit;
      const firstName = pid => allFP.find(fp => fp.player_id === pid)?.profiles?.display_name?.split(' ')[0] || '?';
      // Alle flighters forsøk, beste først (den som «leder» øverst)
      const sorted = Object.entries(latest).sort((x, y) => meta.better === 'higher' ? y[1].value - x[1].value : x[1].value - y[1].value);
      const logged = sorted.map(([pid, v], i) => `<div style="display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
          <span style="width:18px; text-align:center;">${i === 0 ? (meta.penalty ? '😬' : '🏆') : ''}</span>
          <span style="flex:1; color:${i === 0 ? 'var(--gold-light)' : 'var(--cream)'}; font-size:14px;">${firstName(pid)}</span>
          <span style="color:var(--cream); font-size:14px; font-variant-numeric:tabular-nums;">${v.value} ${unit}</span>
          <button onclick="removeJunkEntry('${g.id}',${entry.hole},'${entry.kind}','${pid}')" title="Fjern" style="background:none; border:none; color:rgba(255,255,255,0.35); font-size:15px; padding:2px 6px; cursor:pointer;">✕</button>
        </div>`).join('');
      const uid = `${g.id}-${entry.hole}-${entry.kind}`;
      const playerOptions = allFP.map(fp => `<option value="${fp.player_id}">${(fp.profiles?.display_name || '?').split(' ')[0]}</option>`).join('');
      return `<div style="margin-bottom:8px; padding:10px 12px; background:rgba(201,168,76,0.08); border:1px solid rgba(201,168,76,0.3); border-radius:10px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
          <div style="font-size:13px; color:var(--gold-light); font-weight:600;">${meta.label} · hull ${entry.hole}</div>
          <div style="font-size:11px; color:var(--cream-dim);">${meta.penalty ? '−' : '+'}${Math.abs(Number.isFinite(config.points) ? config.points : 2)}p · alle flighter</div>
        </div>
        ${logged || '<div style="font-size:12px; color:var(--cream-dim); margin-bottom:6px;">Ingen registrert ennå.</div>'}
        <div style="display:flex; gap:6px; margin-top:8px;">
          <select id="junkP-${uid}" style="flex:1; padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:14px;">${playerOptions}</select>
          <input type="number" inputmode="decimal" step="0.1" min="0" id="junkV-${uid}" placeholder="${unit}" style="width:70px; padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:14px; text-align:center;">
          <button onclick="logJunkEntry('${g.id}',${entry.hole},'${entry.kind}')" style="padding:8px 14px; border-radius:6px; border:none; background:var(--gold); color:var(--green-deep); font-size:14px; font-weight:600; cursor:pointer;">Lagre</button>
        </div>
      </div>`;
    }).join('');
    return `<div style="width:100%;">${blocks}</div>`;
  },

  // Rundeoppsummeringen: liste per hull med kandidater + bekreft-knapp.
  // Bekreftelse er ALLTID tilgjengelig her (ikke koblet til at runden lukkes).
  summaryUI(ctx) {
    const g = gameOfType(ctx.round, 'junk');
    if (!g) return '';
    const data = JunkGame.compute(ctx);
    if (!data.entries.length) return '';
    const roundId = ctx.round.id;
    const gameId = g.id;
    const rows = data.entries.map(entry => {
      const meta = JUNK_KIND_META[entry.kind] || JUNK_KIND_META.closest_pin;
      const label = meta.label;
      const unit = meta.unit;
      if (!entry.candidates.length) {
        return `<div style="padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:12px; color:var(--cream-dim);">${label} · hull ${entry.hole} — ingen registrert ennå</div>
        </div>`;
      }
      const candList = entry.candidates.map(c => `<span style="display:inline-flex; align-items:center; gap:2px; margin-right:8px; color:${c.playerId === entry.confirmedId ? 'var(--gold)' : 'var(--cream-dim)'};">${c.name.split(' ')[0]} ${c.value}${unit}${c.playerId === entry.confirmedId ? ' ✓' : ''}<button onclick="removeJunkEntryInSummary('${gameId}','${roundId}',${entry.hole},'${entry.kind}','${c.playerId}')" title="Fjern" style="background:none; border:none; color:rgba(255,255,255,0.35); font-size:13px; padding:0 4px; cursor:pointer;">✕</button></span>`).join('');
      const confirmedName = entry.confirmedId ? (entry.candidates.find(c => c.playerId === entry.confirmedId)?.name.split(' ')[0] || '?') : null;
      const bestName = entry.candidates.find(c => c.playerId === entry.bestId)?.name.split(' ')[0] || '?';
      const uid = `${entry.hole}-${entry.kind}`;
      const playerOptions = entry.candidates.map(c => `<option value="${c.playerId}" ${c.playerId === (entry.confirmedId || entry.bestId) ? 'selected' : ''}>${c.name.split(' ')[0]} (${c.value}${unit})</option>`).join('');
      const confirmBtn = `<button onclick="confirmJunkWinner('${gameId}','${roundId}',${entry.hole},'${entry.kind}',document.getElementById('junkConfirmSel-${uid}').value)" style="padding:6px 12px;border-radius:6px;border:none;background:var(--gold);color:var(--green-deep);font-size:12px;font-weight:600;cursor:pointer;">${entry.confirmedId ? 'Lagre' : 'Bekreft ' + bestName}</button>`;
      const picker = `<div style="display:flex; gap:6px;">
        <select id="junkConfirmSel-${uid}" style="flex:1; padding:6px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.3); color:var(--cream); font-size:12px;">${playerOptions}</select>
        ${confirmBtn}
      </div>`;
      return `<div style="padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:12px; color:var(--cream-dim); margin-bottom:4px;">${label} · hull ${entry.hole} <span style="color:rgba(255,255,255,0.35);">(${entry.points > 0 ? '+' : ''}${entry.points}p ved seier)</span></div>
        <div style="font-size:13px; margin-bottom:6px;">${candList}</div>
        ${entry.confirmedId
          ? `<div style="font-size:12px; color:var(--gold);">🔒 Bekreftet: ${confirmedName} <button onclick="_toggleJunkOverride('${uid}')" style="background:none;border:none;color:var(--cream-dim);text-decoration:underline;cursor:pointer;font-size:11px;margin-left:6px;">endre</button></div>
             <div id="junkOverride-${uid}" style="display:none;margin-top:6px;">${picker}</div>`
          : picker}
      </div>`;
    }).join('');
    return `<div style="background:rgba(201,168,76,0.06); border:1px solid rgba(201,168,76,0.25); border-radius:12px; padding:16px;">
      <div style="font-size:11px; color:var(--gold); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px;">🎯 Sidekonkurranse</div>
      ${rows}
    </div>`;
  },

  settle() { return null; },   // ingen pengeoppgjør — kun turneringspoeng
};
registerGame(JunkGame);

// ── Skriv-funksjoner (kalt fra onclick i trackerUI/summaryUI over) ──

// Registrer et forsøk underveis (scoring-skjermen, gjeldende hull).
async function logJunkEntry(gameId, hole, kind) {
  const uid = `${gameId}-${hole}-${kind}`;
  const playerId = document.getElementById(`junkP-${uid}`)?.value;
  const value = parseFloat(document.getElementById(`junkV-${uid}`)?.value);
  // 0 er en gyldig verdi (0 cm fra pin, 0 m drive) — kun tomt/ugyldig avvises
  if (!playerId || !Number.isFinite(value) || value < 0) return;
  const row = enqueueEvent({ game_id: gameId, round_id: currentRound.id, hole_number: hole, player_id: playerId, event_type: 'junk_entry', payload: { kind, value } });
  roundEvents.push({ ...row, created_at: new Date().toISOString() });   // umiddelbar UI-oppdatering
  renderGameTrackers();
}

// «✕» på scoringskjermen: legger til en junk_removed-hendelse via lagringskøen.
async function removeJunkEntry(gameId, hole, kind, playerId) {
  const ok = await showConfirm('Fjerne dette forsøket?', 'Fjern');
  if (!ok) return;
  const row = enqueueEvent({ game_id: gameId, round_id: currentRound.id, hole_number: hole, player_id: playerId, event_type: 'junk_removed', payload: { kind } });
  roundEvents.push({ ...row, created_at: new Date().toISOString() });
  renderGameTrackers();
}
// «✕» i rundeoppsummeringen (samme hendelse, direkte — oppsummeringen lastes på nytt).
async function removeJunkEntryInSummary(gameId, roundId, hole, kind, playerId) {
  const ok = await showConfirm('Fjerne dette forsøket? Er spilleren bekreftet vinner, må vinneren bekreftes på nytt.', 'Fjern');
  if (!ok) return;
  const { error } = await db.from('game_events').insert({ game_id: gameId, round_id: roundId, hole_number: hole, player_id: playerId, event_type: 'junk_removed', payload: { kind } });
  if (error) { alert('Kunne ikke fjerne forsøket: ' + error.message); return; }
  if (typeof showRoundSummary === 'function') showRoundSummary(roundId);
}

function _toggleJunkOverride(uid) {
  const el = document.getElementById(`junkOverride-${uid}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// Bekreft (eller overstyr) vinneren av et hull — rundeoppsummeringen, når som
// helst, uavhengig av om runden er lukket.
async function confirmJunkWinner(gameId, roundId, hole, kind, playerId) {
  if (!playerId) return;
  await db.from('game_events').insert({ game_id: gameId, round_id: roundId, hole_number: hole, player_id: playerId, event_type: 'junk_confirmed', payload: { kind } });
  if (typeof showRoundSummary === 'function') showRoundSummary(roundId);
}
