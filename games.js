// ==========================================================================
// Spillmotoren — register, spillmodul-kontrakt og delte helpers
// SPILLAPP-SPEC.md §3. Rene globale <script>-filer (ingen modulsystem),
// så registeret er et globalt objekt og modulene registrerer seg selv.
// ==========================================================================

// ---- Delte beregningshelpers --------------------------------------------

// Spillende HCP = round(HI × Slope/113 + (CR − Par)). Par = full 18-hulls par.
// Flyttet hit fra scoring.js så motoren er selvstendig; fortsatt global.
function _playingHcp(hi, slope, cr, par) {
  return Math.round((hi || 36) * (slope || 113) / 113 + ((cr || 72) - (par || 72)));
}

// KONSOLIDERT stableford (SPILLAPP-SPEC.md §12). Erstatter de fire tidligere
// variantene (calcStableford / *WithHoles / *Static / *Live). SI 1 = vanskeligst.
// totalHoles styrer slagfordelingen — standard 18 (slag fordeles alltid over 18
// hull, filtreres på aktive hull for 9-hulls runder, jf. CLAUDE.md).
function calcStableford(strokes, par, hcp, si, totalHoles = 18) {
  if (!strokes || !par || !si) return 0;
  let extra = Math.floor(hcp / totalHoles);
  if (si <= (hcp % totalHoles)) extra++;
  return Math.max(0, par - (strokes - extra) + 2);
}

// ---- Register ------------------------------------------------------------

const GameRegistry = {};
function registerGame(mod) { GameRegistry[mod.type] = mod; }
function getGame(type) { return GameRegistry[type]; }
function listGames() { return Object.values(GameRegistry); }

// Games-rader lastes med runden (embed: rounds.select('*, games(*)')).
function roundGames(round) { return round?.games || []; }
function gameOfType(round, type) { return roundGames(round).find(g => g.game_type === type) || null; }
function mainGame(round) { return roundGames(round).find(g => g.is_main) || null; }
function sideGames(round) { return roundGames(round).filter(g => !g.is_main); }

// Kompatibilitet (§4): filtrer gyldige tillegg gitt hovedspill + kontekst.
// Minimal nå (kun skins finnes); utvides når flere spill kommer inn.
function compatibleAddons(mainType, ctx) {
  const main = getGame(mainType);
  return listGames().filter(g => {
    if (g.type === mainType) return false;
    if (g.meta.kreverIndividuellScore && main && main.meta.kreverLag && !main.meta.kreverIndividuellScore) return false;
    return true;
  });
}

// ==========================================================================
// Skins-modul (SPILLAPP-SPEC.md §5.3) — første spill i motoren.
// Migrert fra scoring.js/_computeSkins + live.js. rounds.skins_amount er
// erstattet av en games-rad (game_type='skins', config { amount }).
// ==========================================================================

// Beløp per skin fra games-raden. null hvis runden ikke har skins.
function skinsAmount(round) {
  const g = gameOfType(round, 'skins');
  const amt = g?.config?.amount;
  return amt != null ? Number(amt) : null;
}

// Kjernen: skins for én flight. Stableford per hull, høyest poeng tar potten,
// uavgjort ruller potten videre (carryover). fullCoursePar brukes til spillende
// HCP (full 18); slagfordeling over 18 hull via calcStableford default.
function _computeSkinsFlight(holes, scores, allFP, round, fullCoursePar) {
  const slope = round.tee_sets?.slope, cr = round.tee_sets?.course_rating;
  const fcp = fullCoursePar || 72;
  const hcpMap = {};
  allFP.forEach(fp => { hcpMap[fp.player_id] = _playingHcp(fp.handicap, slope, cr, fcp); });
  let pot = 0;
  const skinsByPlayer = {};
  allFP.forEach(fp => { skinsByPlayer[fp.player_id] = 0; });
  const holeResults = [];
  for (const hole of holes) {
    pot++;
    if (!hole.par || !hole.stroke_index) {
      holeResults.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, pot, noData: true, sfByPlayer: {} });
      continue;
    }
    const sfByPlayer = {};
    let maxSf = -1, anyScore = false;
    for (const fp of allFP) {
      const s = scores[fp.player_id]?.[hole.hole_number];
      if (!s || s <= 0) continue;
      anyScore = true;
      const sf = calcStableford(s, hole.par, hcpMap[fp.player_id], hole.stroke_index);
      sfByPlayer[fp.player_id] = sf;
      if (sf > maxSf) maxSf = sf;
    }
    if (!anyScore) {
      holeResults.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, pot, noScore: true, sfByPlayer: {} });
      continue;
    }
    const winners = allFP.filter(fp => sfByPlayer[fp.player_id] === maxSf && maxSf >= 0);
    if (winners.length === 1) {
      const w = winners[0];
      skinsByPlayer[w.player_id] += pot;
      holeResults.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: w.player_id,
        winnerName: w.profiles?.display_name?.split(' ')[0] || '?', pot, tied: false, sfByPlayer });
      pot = 0;
    } else {
      holeResults.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, pot, tied: true, sfByPlayer });
    }
  }
  return { skinsByPlayer, holeResults, remainingPot: pot };
}

const SkinsGame = {
  type: 'skins',
  meta: {
    navn: 'Skins',
    beskrivelse: 'Stableford per hull — høyest poeng tar potten. Uavgjort ruller potten videre.',
    minSpillere: 2,
    maxSpillere: 99,
    kreverLag: false,
    kreverIndividuellScore: true,
  },

  amount(round) { return skinsAmount(round); },

  // Oppsett-markup (beløp per skin). Foreløpig speiler den den statiske UI-en i
  // index.html; den dynamiske oppsett-flyten (§2) kobles på senere.
  setupUI(config = {}) {
    const val = config.amount ?? 50;
    return `<label style="display:flex;align-items:center;gap:8px;">
      <span>Kr per skin</span>
      <input type="number" id="skinsAmount" value="${val}" min="1" max="500" style="width:68px;">
    </label>`;
  },

  // Varsler rare kombinasjoner. Skins trenger min 2 spillere med individuell score
  // per flight — flights med <2 hopper vi bare over (ingen skins der).
  validate(ctx) {
    const flights = ctx.flights || [];
    const playable = flights.filter(f => (f.flight_players || []).length >= 2);
    if (!playable.length) return { ok: false, warning: 'Skins krever minst 2 spillere i en flight.' };
    return { ok: true };
  },

  // ctx = { round, holes (aktive), scores (playerId→hull→slag), flights, fullCoursePar }
  // → { amount, flights: [{ flight, skinsByPlayer, holeResults, remainingPot }] } | null
  compute(ctx) {
    const amount = SkinsGame.amount(ctx.round);
    if (!amount) return null;
    const flights = (ctx.flights || []).map(flight => {
      const fp = flight.flight_players || [];
      if (fp.length < 2) return null;
      const res = _computeSkinsFlight(ctx.holes, ctx.scores, fp, ctx.round, ctx.fullCoursePar);
      return { flight, ...res };
    }).filter(Boolean);
    return { amount, flights };
  },

  // Tracker-stripe på scoring-skjermen. Returnerer HTML-streng (tom = skjul).
  trackerUI(ctx) {
    const data = SkinsGame.compute(ctx);
    if (!data || !data.flights.length) return '';
    const kr = data.amount;
    const multiFlights = data.flights.length > 1;
    const parts = [];
    for (const { flight, skinsByPlayer, remainingPot } of data.flights) {
      const fp = flight.flight_players || [];
      const maxSkins = Math.max(...fp.map(f => skinsByPlayer[f.player_id] || 0));
      const cards = fp.map(p => {
        const n = skinsByPlayer[p.player_id] || 0;
        const isLeader = n > 0 && n === maxSkins;
        return `<div style="flex-shrink:0;text-align:center;padding:7px 12px;border-radius:8px;border:1px solid ${isLeader ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.07)'};background:${isLeader ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};">
          <div style="font-size:10px;color:var(--cream-dim);">${p.profiles?.display_name?.split(' ')[0] || '?'}</div>
          <div style="font-family:'Playfair Display',serif;font-size:18px;color:${isLeader ? 'var(--gold)' : 'var(--cream)'};">${n}</div>
          <div style="font-size:9px;color:var(--cream-dim);">${n * kr} kr</div>
        </div>`;
      });
      if (remainingPot > 1) cards.push(`<div style="flex-shrink:0;text-align:center;padding:7px 12px;border-radius:8px;border:1px solid rgba(82,183,136,0.3);background:rgba(82,183,136,0.1);">
        <div style="font-size:10px;color:var(--green-light);">Pott</div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--green-light);">×${remainingPot}</div>
        <div style="font-size:9px;color:var(--cream-dim);">${remainingPot * kr} kr</div>
      </div>`);
      if (multiFlights) {
        parts.push(`<div style="flex-shrink:0;">
          <div style="font-size:9px;color:var(--cream-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">${flight.name}</div>
          <div style="display:flex;gap:6px;">${cards.join('')}</div>
        </div>`);
      } else {
        parts.push(...cards);
      }
    }
    return parts.join('');
  },

  // Seksjon i rundeoppsummeringen. Returnerer HTML-streng (tom = skjul).
  summaryUI(ctx) {
    const data = SkinsGame.compute(ctx);
    if (!data || !data.flights.length) return '';
    const kr = data.amount;
    const multiFlights = data.flights.length > 1;
    const sections = data.flights.map(({ flight, skinsByPlayer, holeResults, remainingPot }) => {
      const allFP = flight.flight_players || [];
      const holeRows = holeResults.filter(r => !r.noData).map(r => {
        const sfCells = allFP.map(fp => {
          const sf = r.sfByPlayer?.[fp.player_id];
          const isWinner = r.winnerId === fp.player_id;
          return `<td style="padding:5px 8px;text-align:center;font-family:'Playfair Display',serif;font-size:14px;color:${isWinner ? 'var(--gold)' : sf != null ? 'var(--cream)' : 'var(--cream-dim)'};">${sf != null ? sf + 'p' : '–'}</td>`;
        }).join('');
        const winnerCell = r.noScore ? '<td style="padding:5px 8px;text-align:center;font-size:11px;color:var(--cream-dim);">–</td>'
          : r.tied ? `<td style="padding:5px 8px;text-align:center;font-size:11px;color:var(--green-light);">↩ Rull</td>`
          : `<td style="padding:5px 8px;text-align:center;font-size:12px;color:var(--gold);font-weight:600;">${r.winnerName} ×${r.pot}</td>`;
        return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:5px 8px;color:var(--cream-dim);font-size:12px;">${r.holeNumber}</td>
          <td style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:12px;">${r.par}</td>
          ${sfCells}${winnerCell}
        </tr>`;
      }).join('');
      const headerCells = allFP.map(fp => `<th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">${fp.profiles?.display_name?.split(' ')[0] || '?'}</th>`).join('');
      const totals = allFP.map(fp => {
        const n = skinsByPlayer[fp.player_id] || 0;
        return { name: fp.profiles?.display_name?.split(' ')[0] || '?', skins: n, kr: n * kr };
      }).sort((a, b) => b.skins - a.skins);
      const flightHeader = multiFlights ? `<div style="font-size:11px;color:var(--cream-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;">${flight.name}</div>` : '';
      return `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:16px;${multiFlights ? 'margin-bottom:12px;' : ''}">
        ${flightHeader}
        <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">🎰 Skins · ${kr} kr per skin</div>
        <div style="overflow-x:auto;margin-bottom:14px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
              <th style="padding:5px 8px;text-align:left;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Hull</th>
              <th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Par</th>
              ${headerCells}
              <th style="padding:5px 8px;text-align:center;color:var(--cream-dim);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:1px;">Vinner</th>
            </tr></thead>
            <tbody>${holeRows}</tbody>
          </table>
        </div>
        ${remainingPot > 0 ? `<div style="font-size:12px;color:var(--green-light);margin-bottom:12px;">⚠️ ${remainingPot} skin(s) uten vinner (siste hull uavgjort)</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${totals.map((t, i) => `<div style="flex:1;min-width:80px;text-align:center;padding:10px;background:${i === 0 && t.skins > 0 ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.2)'};border-radius:8px;border:1px solid ${i === 0 && t.skins > 0 ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.07)'};">
            <div style="font-size:11px;color:var(--cream-dim);">${t.name}</div>
            <div style="font-family:'Playfair Display',serif;font-size:22px;color:${i === 0 && t.skins > 0 ? 'var(--gold)' : 'var(--cream)'};">${t.skins}</div>
            <div style="font-size:12px;color:${t.kr > 0 ? 'var(--green-light)' : 'var(--cream-dim)'};">${t.kr} kr</div>
          </div>`).join('')}
        </div>
      </div>`;
    });
    return sections.join('');
  },
};
registerGame(SkinsGame);

// Skins-oppsett i ny-runde-modalen (statisk UI i index.html inntil videre).
function toggleSkinsAmount() {
  const wrap = document.getElementById('skinsAmountWrap');
  if (wrap) wrap.style.display = document.getElementById('skinsEnabled').checked ? 'flex' : 'none';
}

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
function driveCountsByPlayer(events, filter = {}) {
  const counts = {};
  driveEvents(events, filter).forEach(e => {
    if (e.player_id) counts[e.player_id] = (counts[e.player_id] || 0) + 1;
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

  // opts: { container (el|id), players:[{id,name,handicap}], numTeams, slope, cr, par }
  mount(opts = {}) {
    this._c = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
    this._numTeams = opts.numTeams || 2;
    this._course = { slope: opts.slope, cr: opts.cr, par: opts.par };
    this._assign = {};
    this.setPlayers(opts.players || []);
  },

  setCourse(slope, cr, par) { this._course = { slope, cr, par }; this.render(); },

  setNumTeams(n) {
    this._numTeams = Math.max(1, Math.min(4, n | 0));
    Object.keys(this._assign).forEach(id => { if (this._assign[id] >= this._numTeams) this._assign[id] = this._numTeams - 1; });
    this.render();
  },

  // Oppdater spillerlista (f.eks. når avkrysning i flighten endres). Beholder
  // eksisterende lag-plassering; nye spillere fordeles round-robin.
  setPlayers(players) {
    this._players = players || [];
    let idx = 0;
    this._players.forEach(p => { if (this._assign[p.id] == null) { this._assign[p.id] = idx % this._numTeams; idx++; } });
    Object.keys(this._assign).forEach(id => { if (!this._players.find(p => p.id === id)) delete this._assign[id]; });
    this.render();
  },

  assign(pid, team) { this._assign[pid] = team; this.render(); },

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
      this._c.innerHTML = `<div style="font-size:12px;color:var(--cream-dim);padding:10px 0;">Kryss av spillere i flighten under, og trykk «Bygg lag».</div>`;
      return;
    }
    const teams = this.getTeams();
    const teamPickerBtns = [2, 3, 4].map(n => `<button type="button" onclick="TeamBuilder.setNumTeams(${n})" style="flex:1;padding:6px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ${this._numTeams === n ? 'var(--gold)' : 'rgba(255,255,255,0.12)'};background:${this._numTeams === n ? 'rgba(201,168,76,0.18)' : 'transparent'};color:${this._numTeams === n ? 'var(--gold)' : 'var(--cream-dim)'};">${n} lag</button>`).join('');
    const teamCards = teams.map(t => `<div style="flex:1;min-width:90px;text-align:center;padding:8px;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(201,168,76,0.2);">
      <div style="font-size:11px;color:var(--gold-light);">${t.name}</div>
      <div style="font-family:'Playfair Display',serif;font-size:20px;color:var(--gold);">${t.team_handicap != null ? t.team_handicap : '–'}</div>
      <div style="font-size:9px;color:var(--cream-dim);">lag-HCP · ${t.member_ids.length} sp.</div>
    </div>`).join('');
    const rows = this._players.map(p => {
      const seg = [];
      for (let t = 0; t < this._numTeams; t++) {
        const on = this._assign[p.id] === t;
        seg.push(`<button type="button" onclick="TeamBuilder.assign('${p.id}',${t})" style="min-width:34px;padding:5px 8px;border:1px solid ${on ? 'var(--gold)' : 'rgba(255,255,255,0.12)'};background:${on ? 'rgba(201,168,76,0.2)' : 'transparent'};color:${on ? 'var(--gold)' : 'var(--cream-dim)'};font-size:12px;cursor:pointer;${t === 0 ? 'border-radius:6px 0 0 6px;' : t === this._numTeams - 1 ? 'border-radius:0 6px 6px 0;' : ''}">${t + 1}</button>`);
      }
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;">
        <span style="font-size:13px;color:var(--cream);">${p.name} <span style="color:var(--cream-dim);font-size:11px;">(${p.handicap ?? '–'})</span></span>
        <div style="display:flex;">${seg.join('')}</div>
      </div>`;
    }).join('');
    this._c.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:10px;">${teamPickerBtns}</div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">${teamCards}</div>
      <div>${rows}</div>`;
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

// Kvote/straff (§11.3). Fullt beregnbart fra drive_used-hendelser. DORMANT i
// increment 1: config.countingDrives er av → returnerer null (ingen straff)
// til tracker-UI-et i increment 2 begynner å logge utslag.
function _scrambleQuota(config, team, events, thru, totalHoles) {
  if (!config || !config.countingDrives) return null;
  const min = config.minDrivesPerPlayer || 1;
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
  // §11.3.2: 1 straffeslag per utslag som ikke lenger kan nås innen kvoten.
  const penalty = Math.max(0, remainingSum - holesLeft);
  return { min, byPlayer, remainingSum, holesLeft, impossible: penalty > 0, penalty };
}

const ScrambleGame = {
  type: 'scramble',
  meta: {
    navn: 'Scramble',
    beskrivelse: 'Lagspill med delt ball — laget spiller beste plassering hvert slag. Netto lagscore mot par.',
    minSpillere: 2,
    maxSpillere: 99,
    kreverLag: true,
    kreverIndividuellScore: false,
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
        <span>Tellende utslag (utslags-tracker kommer)</span>
        <input type="number" id="scrambleMinDrives" value="${config.minDrivesPerPlayer || 1}" min="1" max="6" style="width:52px;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:var(--cream);font-size:13px;text-align:center;">
        <span>min/spiller</span>
      </label>
    </div>`;
  },

  // ctx = { flights, teams } — advarer om rare kombinasjoner (§2).
  validate(ctx) {
    const teams = (ctx.teams || []).filter(t => (t.member_ids || []).length);
    if (teams.length < 1) return { ok: false, warning: 'Scramble krever minst ett lag med spillere.' };
    if (teams.length === 1) return { ok: false, warning: 'Scramble trenger minst to lag for en kamp.' };
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
      return { team, teamHcp, holeResults, totalGross, totalNet: totalNet + penalty, totalSf, totalPar, thru, quota, penalty };
    });
    const val = r => scoring === 'stableford' ? r.totalSf : scoring === 'slag' ? r.totalGross : r.totalNet;
    results.sort((a, b) => {
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
      const quotaLine = r.quota ? `<div style="font-size:9px;color:${r.quota.impossible ? '#f09595' : 'var(--cream-dim)'};">${r.penalty ? `+${r.penalty} straff` : 'kvote ok'}</div>` : '';
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
      <div style="font-size:11px;color:var(--cream-dim);">${r.totalGross || '–'} slag${r.penalty ? ` · +${r.penalty} straff` : ''}</div>
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
