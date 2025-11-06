#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 -m http.server 5174 -d dist 2>/dev/null || npx --yes serve -l 5174 dist
