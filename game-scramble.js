// ==========================================================================
// game_events-kontrakt for scramble-utslag (SPILLAPP-SPEC.md §5.1, §11.3).
// Definert NÅ (increment 1) selv om tracker-UI-et som SKRIVER hendelsene
// kommer i increment 2 — da plugges §11.3-straffen inn uten omskriving.
//
// Én rad per hull der et lags utslag registreres:
//   event_type = 'drive_used'
//   game_id    = scramble-spillet
//   round_id   = runden
//   hole_number = hullet
//   team_id    = laget som scoret
//   player_id  = spilleren hvis utslag ble brukt
//   payload    = {}  (reservert; f.eks. { reslag: true } ved gilligan senere)
// ==========================================================================
const DRIVE_USED = 'drive_used';

// Alle drive_used-hendelser, valgfritt filtrert på spill og/eller lag.
function driveEvents(events, { gameId = null, teamId = null } = {}) {
  return (events || []).filter(e =>
    e.event_type === DRIVE_USED &&
    (gameId == null || e.game_id === gameId) &&
    (teamId == null || e.team_id === teamId));
}

// Antall registrerte utslag per spiller (player_id → count) for gitt filter.
// game_events er append-only → et hull kan ha flere drive_used (rettelser).
// Siste (nyeste created_at) gjelder. → { hole_number: player_id }.
function latestDriveByHole(events, filter = {}) {
  const tmp = {};
  driveEvents(events, filter).forEach(e => {
    const h = e.hole_number, ts = e.created_at || '';
    if (!tmp[h] || ts >= tmp[h].ts) tmp[h] = { pid: e.player_id, ts };
  });
  const out = {};
  Object.keys(tmp).forEach(h => { out[h] = tmp[h].pid; });
  return out;
}
// Antall registrerte utslag per spiller (dedupet på hull → siste valg gjelder).
function driveCountsByPlayer(events, filter = {}) {
  const counts = {};
  Object.values(latestDriveByHole(events, filter)).forEach(pid => {
    if (pid) counts[pid] = (counts[pid] || 0) + 1;
  });
  return counts;
}

// ==========================================================================
// Delte lag-helpers (WHS) — brukes av TeamBuilder og ScrambleGame.
// ==========================================================================

// WHS-brøk per lagstørrelse (SPILLAPP-SPEC.md §5.1): laveste spiller vektes tyngst.
const SCRAMBLE_FRACTIONS = { 1: [1], 2: [0.35, 0.15], 3: [0.30, 0.20, 0.10], 4: [0.25, 0.20, 0.15, 0.10] };

// Lag-HCP: medlemmenes spillende HCP sortert lavest-først, vektet med WHS-brøk,
// rundet. Ukjent lagstørrelse (>4) → likt vektet snitt.
function scrambleTeamHandicap(members, slope, cr, par, fractions) {
  const hcps = (members || []).map(m => _playingHcp(m.handicap, slope, cr, par)).sort((a, b) => a - b);
  if (!hcps.length) return null;
  const f = fractions || SCRAMBLE_FRACTIONS[hcps.length] || hcps.map(() => 1 / hcps.length);
  return Math.round(hcps.reduce((s, h, i) => s + h * (f[i] ?? 0), 0));
}

// ÉN KILDE TIL SANNHET: utled lag-HCP på nytt fra medlemmenes spiller-HCP +
// gjeldende tee (slope/CR/par) via WHS-brøken, og persister endringene til
// game_teams. Brukes av BÅDE tee-bytte (scoring) og oppsett-redigering
// (wizard) — spiller-HCP + tee er de rå inndataene, lag-HCP er alltid utledet.
//   teams: game_teams-rader (må ha id + member_ids [+ team_handicap for diff])
//   hcpByPlayer: { player_id: spiller-HCP }
// → [{ id, team_handicap }] med de nye verdiene (også de uendrede).
async function persistScrambleTeamHandicaps(teams, hcpByPlayer, slope, cr, par) {
  const results = [];
  for (const t of (teams || [])) {
    const members = (t.member_ids || []).map(id => ({ handicap: hcpByPlayer[id] ?? 36 }));
    const th = members.length ? scrambleTeamHandicap(members, slope, cr, par) : (t.team_handicap ?? null);
    const cur = t.team_handicap != null ? Number(t.team_handicap) : null;
    if (th !== cur) await db.from('game_teams').update({ team_handicap: th }).eq('id', t.id);
    results.push({ id: t.id, team_handicap: th });
  }
  return results;
}

// Ekstra slag laget får på ett hull gitt lag-HCP fordelt over 18 hull etter SI.
function _teamExtraStrokes(teamHcp, strokeIndex) {
  if (!strokeIndex || teamHcp == null) return 0;
  let extra = Math.floor(teamHcp / 18);
  if (strokeIndex <= (teamHcp % 18)) extra++;
  return extra;
}

// ==========================================================================
// TeamBuilder — gjenbrukbar lag-bygger (SPILLAPP-SPEC.md §2 «lag-puslespill»).
// BEVISST frittstående fra modal-koden: når den dynamiske §2-flyten kommer,
// løftes komponenten over uendret; kun bolt-on-limet i dagens modal er
// engangsarbeid. Ren vanilla, rendrer inn i en container, holder egen state
// og viser lag-HCP live når spillere flyttes mellom lag.
// ==========================================================================
const TeamBuilder = {
  _c: null, _players: [], _numTeams: 2, _course: {}, _assign: {},

  _onChange: null,

  // opts: { container (el|id), players:[{id,name,handicap}], numTeams, slope, cr, par,
  //         assign (initial {playerId:teamIndex}), onChange (teams, assign) => void }
  mount(opts = {}) {
    this._c = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
    this._numTeams = opts.numTeams || 2;
    this._course = { slope: opts.slope, cr: opts.cr, par: opts.par };
    this._assign = { ...(opts.assign || {}) };
    this._onChange = opts.onChange || null;
    this.setPlayers(opts.players || []);
  },

  // Sett hele fordelingen på én gang (brukes av «bland på nytt»).
  setAssignment(map) { this._assign = { ...map }; this.render(); },

  setCourse(slope, cr, par) { this._course = { slope, cr, par }; this.render(); },

  _max: 4,   // maks spillere per lag (WHS-brøk definert for ≤4)
  _counts() { return Array.from({ length: this._numTeams }, (_, t) => this._players.filter(x => this._assign[x.id] === t).length); },
  _smallestOpen() {
    const c = this._counts(); let min = -1;
    for (let t = 0; t < this._numTeams; t++) if (c[t] < this._max && (min < 0 || c[t] < c[min])) min = t;
    if (min < 0) { this._numTeams++; return this._numTeams - 1; }   // alle fulle → nytt lag
    return min;
  },

  setNumTeams(n) {
    const minT = Math.max(1, Math.ceil((this._players.length || 1) / this._max));   // nok lag til at ingen > 4
    this._numTeams = Math.max(minT, n | 0);
    // flytt spillere ut av fjernede lag til minste åpne
    this._players.forEach(p => { if (this._assign[p.id] == null || this._assign[p.id] >= this._numTeams) this._assign[p.id] = this._smallestOpen(); });
    this.render();
  },

  // Oppdater spillerlista. Sikrer nok lag (maks 4/lag, auto-nudge), beholder
  // eksisterende plassering, legger nye på minste åpne lag (balansert).
  setPlayers(players) {
    this._players = players || [];
    Object.keys(this._assign).forEach(id => { if (!this._players.find(p => p.id === id)) delete this._assign[id]; });
    const need = Math.max(1, Math.ceil(this._players.length / this._max));
    if (this._numTeams < need) this._numTeams = need;
    this._players.forEach(p => {
      const cur = this._assign[p.id];
      if (cur != null && cur < this._numTeams) return;
      this._assign[p.id] = this._smallestOpen();
    });
    this.render();
  },

  assign(pid, team) {
    const c = this._counts();
    if (this._assign[pid] !== team && c[team] >= this._max) return;   // fullt lag → avvis
    this._assign[pid] = team;
    this.render();
  },

  // → [{ name, member_ids, members, team_handicap }] for hvert lag.
  getTeams() {
    const teams = [];
    for (let t = 0; t < this._numTeams; t++) {
      const members = this._players.filter(p => this._assign[p.id] === t);
      teams.push({
        name: `Lag ${t + 1}`,
        member_ids: members.map(p => p.id),
        members,
        team_handicap: members.length ? scrambleTeamHandicap(members, this._course.slope, this._course.cr, this._course.par) : null,
      });
    }
    return teams;
  },

  render() {
    if (!this._c) return;
    if (!this._players.length) {
      this._c.innerHTML = `<div style="font-size:12px;color:var(--cream-dim);padding:10px 0;">Velg spillere over for å bygge lag.</div>`;
      if (this._onChange) this._onChange([], this._assign);
      return;
    }
    const teams = this.getTeams();
    const counts = this._counts();
    const minT = Math.max(2, Math.ceil(this._players.length / this._max));
    const stepBtn = (delta, disabled, label) => `<button type="button" ${disabled ? 'disabled' : `onclick="TeamBuilder.setNumTeams(${this._numTeams + delta})"`} style="width:30px;height:30px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:${disabled ? 'rgba(255,255,255,0.2)' : 'var(--gold)'};font-size:16px;cursor:${disabled ? 'default' : 'pointer'};">${label}</button>`;
    const teamPicker = `<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:10px;">
      ${stepBtn(-1, this._numTeams <= minT, '−')}<span style="font-size:13px;color:var(--cream);min-width:52px;text-align:center;">${this._numTeams} lag</span>${stepBtn(1, this._numTeams >= this._players.length, '+')}
    </div>`;
    const teamCards = teams.map(t => `<div style="flex:1;min-width:84px;text-align:center;padding:8px;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid ${t.member_ids.length > this._max ? 'rgba(192,57,43,0.4)' : 'rgba(201,168,76,0.2)'};">
      <div style="font-size:11px;color:var(--gold-light);">${t.name}</div>
      <div style="font-family:'Playfair Display',serif;font-size:20px;color:var(--gold);">${t.team_handicap != null ? t.team_handicap : '–'}</div>
      <div style="font-size:9px;color:var(--cream-dim);">lag-HCP · ${t.member_ids.length}/${this._max}</div>
    </div>`).join('');
    const rows = this._players.map(p => {
      const seg = [];
      for (let t = 0; t < this._numTeams; t++) {
        const on = this._assign[p.id] === t;
        const full = !on && counts[t] >= this._max;
        seg.push(`<button type="button" ${full ? 'disabled' : `onclick="TeamBuilder.assign('${p.id}',${t})"`} style="min-width:32px;padding:5px 8px;margin:2px;border:1px solid ${on ? 'var(--gold)' : 'rgba(255,255,255,0.12)'};border-radius:6px;background:${on ? 'rgba(201,168,76,0.2)' : 'transparent'};color:${on ? 'var(--gold)' : full ? 'rgba(255,255,255,0.2)' : 'var(--cream-dim)'};font-size:12px;cursor:${full ? 'not-allowed' : 'pointer'};">${t + 1}</button>`);
      }
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;">
        <span style="font-size:13px;color:var(--cream);">${p.name} <span style="color:var(--cream-dim);font-size:11px;">(${p.handicap ?? '–'})</span></span>
        <div style="display:flex;flex-wrap:wrap;justify-content:flex-end;">${seg.join('')}</div>
      </div>`;
    }).join('');
    this._c.innerHTML = `
      ${teamPicker}
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">${teamCards}</div>
      <div>${rows}</div>`;
    if (this._onChange) this._onChange(this.getTeams(), this._assign);
  },
};

// ==========================================================================
// FlightBuilder (SPILLAPP-SPEC.md §2.5/§2.7) — fordel spillere på flighter.
// TeamBuilder-klon for multi-flight-konkurranse: variabelt antall flighter,
// MAKS 4 per flight, ingen HCP (flighter er scoregrupper, ikke lag). Nye
// spillere legges på minste ikke-fulle flight; auto-nudge legger til flight
// når det trengs. Ren vanilla, egen state, onChange-hook som TeamBuilder.
// ==========================================================================
const FlightBuilder = {
  _c: null, _players: [], _numFlights: 1, _assign: {}, _onChange: null, _max: 4,

  // opts: { container, players:[{id,name}], numFlights, assign, max, onChange }
  mount(opts = {}) {
    this._c = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
    this._numFlights = opts.numFlights || 1;
    this._max = opts.max || 4;
    this._assign = { ...(opts.assign || {}) };
    this._onChange = opts.onChange || null;
    this.setPlayers(opts.players || []);
  },

  _counts() { return Array.from({ length: this._numFlights }, (_, f) => this._players.filter(x => this._assign[x.id] === f).length); },
  _smallestOpen() {
    const c = this._counts();
    let min = -1;
    for (let f = 0; f < this._numFlights; f++) if (c[f] < this._max && (min < 0 || c[f] < c[min])) min = f;
    if (min < 0) { this._numFlights++; return this._numFlights - 1; }   // alle fulle → ny flight
    return min;
  },

  setPlayers(players) {
    this._players = players || [];
    // nok flighter til å romme alle (auto-nudge)
    const need = Math.max(1, Math.ceil(this._players.length / this._max));
    if (this._numFlights < need) this._numFlights = need;
    // fjern borttatte
    Object.keys(this._assign).forEach(id => { if (!this._players.find(p => p.id === id)) delete this._assign[id]; });
    // plasser nye (eller ugyldig-plasserte) på minste åpne flight
    this._players.forEach(p => {
      const cur = this._assign[p.id];
      if (cur != null && cur < this._numFlights) return;
      this._assign[p.id] = this._smallestOpen();
    });
    this.render();
  },

  setAssignment(map) { this._assign = { ...map }; this.render(); },
  addFlight() { this._numFlights++; this.render(); },
  assign(pid, flight) {
    const c = this._counts();
    if (this._assign[pid] !== flight && c[flight] >= this._max) return;  // full → avvis
    this._assign[pid] = flight;
    this.render();
  },

  // → [{ name:'Flight N', member_ids, members }] for hver flight.
  getFlights() {
    const flights = [];
    for (let f = 0; f < this._numFlights; f++) {
      const members = this._players.filter(p => this._assign[p.id] === f);
      flights.push({ name: `Flight ${f + 1}`, member_ids: members.map(p => p.id), members });
    }
    return flights;
  },

  render() {
    if (!this._c) return;
    if (!this._players.length) {
      this._c.innerHTML = `<div style="font-size:12px;color:var(--cream-dim);padding:10px 0;">Velg spillere over for å fordele dem på flighter.</div>`;
      if (this._onChange) this._onChange(this.getFlights(), this._assign);
      return;
    }
    const counts = this._counts();
    const flightCards = this.getFlights().map((fl, f) => `<div style="flex:1;min-width:120px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid ${counts[f] > this._max ? 'rgba(192,57,43,0.4)' : 'rgba(201,168,76,0.2)'};">
      <div style="font-size:11px;color:var(--gold-light);">${fl.name} <span style="color:var(--cream-dim);">${counts[f]}/${this._max}</span></div>
      <div style="font-size:11px;color:var(--cream);margin-top:3px;min-height:14px;">${fl.members.map(m => m.name).join(', ') || '—'}</div>
    </div>`).join('');
    const rows = this._players.map(p => {
      const seg = [];
      for (let f = 0; f < this._numFlights; f++) {
        const on = this._assign[p.id] === f;
        const full = !on && counts[f] >= this._max;
        seg.push(`<button type="button" ${full ? 'disabled' : `onclick="FlightBuilder.assign('${p.id}',${f})"`} style="min-width:32px;padding:5px 8px;border:1px solid ${on ? 'var(--gold)' : 'rgba(255,255,255,0.12)'};background:${on ? 'rgba(201,168,76,0.2)' : 'transparent'};color:${on ? 'var(--gold)' : full ? 'rgba(255,255,255,0.2)' : 'var(--cream-dim)'};font-size:12px;cursor:${full ? 'not-allowed' : 'pointer'};${f === 0 ? 'border-radius:6px 0 0 6px;' : f === this._numFlights - 1 ? 'border-radius:0 6px 6px 0;' : ''}">${f + 1}</button>`);
      }
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;">
        <span style="font-size:13px;color:var(--cream);">${p.name}</span>
        <div style="display:flex;">${seg.join('')}</div>
      </div>`;
    }).join('');
    this._c.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">${flightCards}</div>
      <div style="text-align:right;margin-bottom:8px;"><button type="button" onclick="FlightBuilder.addFlight()" style="background:none;border:1px dashed rgba(201,168,76,0.4);color:var(--gold);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;">+ Ny flight</button></div>
      <div>${rows}</div>`;
    if (this._onChange) this._onChange(this.getFlights(), this._assign);
  },
};

// ==========================================================================
// Scramble / Texas scramble (SPILLAPP-SPEC.md §5.1) — første lagspill.
// Delt ball: scorer på team_id (scores). compute leser lag-scores + drive_used.
// ==========================================================================

// Scramble-spillet (hovedspill) på en runde, eller null.
function scrambleGame(round) {
  return roundGames(round).find(g => g.game_type === 'scramble' && g.is_main) || null;
}

// Minstekvote for et lag: global standard, eller lag-spesifikk override når
// «ulik kvote per lag» er på (config.teamMinDrives keyet på lagnavn).
function scrambleMinDrives(config, team) {
  const per = (config && config.teamMinDrives) || {};
  if (config && config.perTeamDrives && team && team.name != null && per[team.name] != null) {
    return Math.max(1, parseInt(per[team.name]) || 1);
  }
  return (config && config.minDrivesPerPlayer) || 1;
}

function _scrambleQuota(config, team, events, thru, totalHoles) {
  if (!config || !config.countingDrives) return null;
  const min = scrambleMinDrives(config, team);
  const mode = config.penaltyMode || 'stroke';         // 'warn' | 'stroke' | 'out'
  const used = driveCountsByPlayer(events, { teamId: team.id });
  const byPlayer = {};
  let remainingSum = 0;
  (team.member_ids || []).forEach(pid => {
    const u = used[pid] || 0;
    const rem = Math.max(0, min - u);
    byPlayer[pid] = { used: u, min, remaining: rem };
    remainingSum += rem;
  });
  const holesLeft = Math.max(0, totalHoles - thru);
  // §11.3.2: manglende utslag som ikke lenger kan nås innen minstekvoten.
  const violations = Math.max(0, remainingSum - holesLeft);
  const penalty = mode === 'stroke' ? violations : 0;   // 1 slag per manglende utslag
  const out = mode === 'out' && violations > 0;         // ute av premie
  return { min, mode, byPlayer, remainingSum, holesLeft, impossible: violations > 0, violations, penalty, out };
}

const ScrambleGame = {
  type: 'scramble',
  meta: {
    navn: 'Scramble',
    beskrivelse: 'Lagspill med delt ball — laget spiller beste plassering hvert slag. Netto lagscore mot par.',
    minSpillere: 2,
    maxSpillere: 4,          // ett spill = én flight, maks 4 (§2.5)
    kreverLag: true,
    kreverIndividuellScore: false,
    roles: ['main'],
    status: 'ready',
  },

  // Standard games.config for scramble (§2.2: wizard seeder herfra). Formatet
  // er nøyaktig det compute leser — ingen oversettelse. «Tellende utslag»
  // uttrykkes i UI som ett tall (0 = av) som mapper på countingDrives+min.
  defaultConfig() {
    return { scoring: 'netto', countingDrives: false, minDrivesPerPlayer: 1, penaltyMode: 'stroke', fractionMode: 'whs' };
  },

  // Konfig-kontroller (scoring + tellende utslag). Lag-byggeren mountes separat
  // via TeamBuilder (egen gjenbrukbar komponent), ikke herfra.
  setupUI(config = {}) {
    const scoring = config.scoring || 'netto';
    const opt = (v, l) => `<option value="${v}" ${scoring === v ? 'selected' : ''}>${l}</option>`;
    return `<div style="display:flex;flex-direction:column;gap:10px;">
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--cream);">
        <span>Scoring</span>
        <select id="scrambleScoring" style="padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;">
          ${opt('netto', 'Netto (mot par)')}${opt('slag', 'Brutto slag')}${opt('stableford', 'Stableford')}
        </select>
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--cream-dim);cursor:pointer;">
        <input type="checkbox" id="scrambleCountDrives" ${config.countingDrives ? 'checked' : ''} style="width:16px;height:16px;">
        <span>Tellende utslag</span>
        <input type="number" id="scrambleMinDrives" value="${config.minDrivesPerPlayer || 1}" min="1" max="6" style="width:52px;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;text-align:center;">
        <span>min/spiller</span>
      </label>
    </div>`;
  },

  // ctx = { teams, config, totalHoles } — advarer om rare kombinasjoner (§2).
  validate(ctx) {
    const teams = (ctx.teams || []).filter(t => (t.member_ids || []).length);
    if (teams.length < 1) return { ok: false, warning: 'Scramble krever minst ett lag med spillere.' };
    if (teams.length === 1) return { ok: false, warning: 'Scramble trenger minst to lag for en kamp.' };
    // Tellende utslag: minstekvoten (min × antall spillere) må få plass innenfor
    // antall hull som spilles — ellers er den umulig å oppfylle. Tar hensyn til
    // 9-hulls runder (totalHoles) og lag-spesifikke kvoter.
    const cfg = ctx.config || {};
    if (cfg.countingDrives) {
      const holes = ctx.totalHoles || 18;
      for (const t of teams) {
        const size = (t.member_ids || []).length;
        const min = scrambleMinDrives(cfg, t);
        if (size > 0 && min * size > holes) {
          const maxOk = Math.floor(holes / size);
          return { ok: false, warning: `${t.name || 'Laget'}: ${min} tellende utslag × ${size} spillere = ${min * size}, men runden har bare ${holes} hull. Sett minstekvoten til maks ${maxOk} for dette laget.` };
        }
      }
    }
    return { ok: true };
  },

  // ctx = { round, holes, teamScores (teamId→hull→slag), teams, events, fullCoursePar }
  // → { scoring, config, teams: [{ team, teamHcp, holeResults, totalGross, totalNet,
  //     totalSf, totalPar, thru, quota, penalty }] } | null
  compute(ctx) {
    const g = scrambleGame(ctx.round);
    if (!g) return null;
    const config = g.config || {};
    const scoring = config.scoring || 'netto';
    const teams = (ctx.teams && ctx.teams.length ? ctx.teams : (g.game_teams || []));
    if (!teams.length) return null;
    const slope = ctx.round.tee_sets?.slope, cr = ctx.round.tee_sets?.course_rating;
    const par = ctx.fullCoursePar || 72;
    const holes = ctx.holes || [];
    const totalHoles = holes.length || 18;
    const results = teams.map(team => {
      const teamHcp = team.team_handicap != null ? Number(team.team_handicap)
        : scrambleTeamHandicap(team.members || [], slope, cr, par);
      const ts = (ctx.teamScores && ctx.teamScores[team.id]) || {};
      let totalGross = 0, totalNet = 0, totalSf = 0, totalPar = 0, thru = 0;
      const holeResults = holes.map(h => {
        const gross = ts[h.hole_number] || 0;
        const extra = _teamExtraStrokes(teamHcp, h.stroke_index);
        const net = gross ? gross - extra : 0;
        const sf = gross ? calcStableford(gross, h.par, teamHcp, h.stroke_index) : 0;
        if (gross) { totalGross += gross; totalNet += net; totalSf += sf; totalPar += (h.par || 0); thru++; }
        return { holeNumber: h.hole_number, par: h.par, si: h.stroke_index, gross, extra, net, sf };
      });
      const quota = _scrambleQuota(config, team, ctx.events, thru, totalHoles);
      const penalty = quota ? quota.penalty : 0;
      return { team, teamHcp, holeResults, totalGross, totalNet: totalNet + penalty, totalSf, totalPar, thru, quota, penalty, out: quota ? quota.out : false };
    });
    const val = r => scoring === 'stableford' ? r.totalSf : scoring === 'slag' ? r.totalGross : r.totalNet;
    results.sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;   // ute av premie sorteres sist
      if (!a.thru && !b.thru) return 0;
      if (!a.thru) return 1;
      if (!b.thru) return -1;
      return scoring === 'stableford' ? val(b) - val(a) : val(a) - val(b);
    });
    return { scoring, config, teams: results };
  },

  // Tracker-stripe: lag-stilling. Kvote per spiller vises kun når countingDrives
  // er på (increment 2) — logikken er klar, men dvaler i increment 1.
  trackerUI(ctx) {
    const data = ScrambleGame.compute(ctx);
    if (!data || !data.teams.length) return '';
    const scoring = data.scoring;
    return data.teams.map((r, i) => {
      const lead = i === 0 && r.thru > 0;
      const vsPar = r.totalGross ? r.totalNet - r.totalPar : null;
      const main = scoring === 'stableford' ? `${r.totalSf}p`
        : scoring === 'slag' ? `${r.totalGross || '–'}`
        : (vsPar == null ? '–' : vsPar === 0 ? 'E' : vsPar > 0 ? `+${vsPar}` : `${vsPar}`);
      const q = r.quota;
      const quotaLine = q ? `<div style="font-size:9px;color:${r.out || q.impossible ? '#f09595' : 'var(--cream-dim)'};">${r.out ? '⚠ ute av premie' : r.penalty ? `+${r.penalty} straff` : q.violations ? '⚠ kvotebrudd' : 'kvote ok'}</div>` : '';
      return `<div style="flex-shrink:0;text-align:center;padding:7px 12px;border-radius:8px;border:1px solid ${lead ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.07)'};background:${lead ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};">
        <div style="font-size:10px;color:var(--cream-dim);">${r.team.name} · HCP ${r.teamHcp ?? '–'}</div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:${lead ? 'var(--gold)' : 'var(--cream)'};">${main}</div>
        <div style="font-size:9px;color:var(--cream-dim);">${r.thru} hull</div>
        ${quotaLine}
      </div>`;
    }).join('');
  },

  // Seksjon i rundeoppsummeringen: lag-scorekort + totaler.
  summaryUI(ctx) {
    const data = ScrambleGame.compute(ctx);
    if (!data || !data.teams.length) return '';
    const scoring = data.scoring;
    const holes = ctx.holes || [];
    const scoreLabel = scoring === 'stableford' ? 'Poeng' : scoring === 'slag' ? 'Slag' : 'Netto';
    const headerCells = data.teams.map(r => `<th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">${r.team.name}</th>`).join('');
    const holeRows = holes.map(h => {
      const cells = data.teams.map(r => {
        const hr = r.holeResults.find(x => x.holeNumber === h.hole_number);
        const g = hr?.gross || 0;
        const color = g ? getScoreColor(g, h.par) : 'var(--cream-dim)';
        return `<td style="padding:5px 8px;text-align:center;font-family:'Playfair Display',serif;font-size:14px;color:${color};">${g || '–'}</td>`;
      }).join('');
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:5px 8px;color:var(--cream-dim);font-size:12px;">${h.hole_number}</td>
        <td style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:12px;">${h.par}</td>
        ${cells}
      </tr>`;
    }).join('');
    const val = r => scoring === 'stableford' ? `${r.totalSf}p` : scoring === 'slag' ? `${r.totalGross || '–'}` : (() => {
      if (!r.totalGross) return '–';
      const d = r.totalNet - r.totalPar;
      return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`;
    })();
    const totals = data.teams.map((r, i) => `<div style="flex:1;min-width:90px;text-align:center;padding:10px;background:${i === 0 && r.thru > 0 ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};border-radius:8px;border:1px solid ${i === 0 && r.thru > 0 ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.07)'};">
      <div style="font-size:11px;color:var(--cream-dim);">${r.team.name} · HCP ${r.teamHcp ?? '–'}</div>
      <div style="font-family:'Playfair Display',serif;font-size:22px;color:${i === 0 && r.thru > 0 ? 'var(--gold)' : 'var(--cream)'};">${val(r)}</div>
      <div style="font-size:11px;color:var(--cream-dim);">${r.totalGross || '–'} slag${r.penalty ? ` · +${r.penalty} straff` : ''}${r.out ? ' · <span style="color:#e8a070;">⚠ ute av premie</span>' : ''}</div>
    </div>`).join('');
    return `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:16px;">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">⛳ Scramble · ${scoreLabel}</div>
      <div style="overflow-x:auto;margin-bottom:14px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
            <th style="padding:5px 8px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Hull</th>
            <th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Par</th>
            ${headerCells}
          </tr></thead>
          <tbody>${holeRows}</tbody>
        </table>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">${totals}</div>
    </div>`;
  },
};
registerGame(ScrambleGame);
