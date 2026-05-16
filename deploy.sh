#!/bin/bash
set -e

cd "$(dirname "$0")"

./update-version.sh

VERSION=$(grep -oE 'v[0-9]+\.[0-9]+' index.html | head -1)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')

git add index.html sw.js manifest.json icon.svg update-version.sh deploy.sh .gitignore
git commit -m "deploy $VERSION – $TIMESTAMP"
git push origin main

echo ""
echo "✓ $VERSION deployet til GitHub"
