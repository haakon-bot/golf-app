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
