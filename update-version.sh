#!/bin/bash
set -e

cd "$(dirname "$0")"

# ── Les gjeldende versjoner ──
CURRENT_APP=$(grep -oE 'v[0-9]+\.[0-9]+' index.html | head -1)
CURRENT_SW=$(grep -oE 'fore-v[0-9]+' sw.js | head -1)

if [ -z "$CURRENT_APP" ]; then
  echo "❌ Fant ikke versjonsnummer (v1.XX) i index.html" >&2; exit 1
fi
if [ -z "$CURRENT_SW" ]; then
  echo "❌ Fant ikke cache-versjon (fore-vX) i sw.js" >&2; exit 1
fi

# ── Øk versjonsnumrene ──
MAJOR=$(echo "$CURRENT_APP" | grep -oE '[0-9]+' | head -1)
MINOR=$(echo "$CURRENT_APP" | grep -oE '[0-9]+' | tail -1)
NEW_APP="v${MAJOR}.$((MINOR + 1))"

SW_NUM=$(echo "$CURRENT_SW" | grep -oE '[0-9]+')
NEW_SW="fore-v$((SW_NUM + 1))"

# ── Oppdater filer ──
sed -i '' "s/${CURRENT_APP}/${NEW_APP}/g" index.html
sed -i '' "s/${CURRENT_SW}/${NEW_SW}/g" sw.js

echo "✓  index.html  ${CURRENT_APP} → ${NEW_APP}"
echo "✓  sw.js       ${CURRENT_SW} → ${NEW_SW}"
