#!/usr/bin/env bash
# Builds the deployable site into ./_site.
#
# The app's code and data are copied into a folder named after the commit
# (b-<sha>/) and index.html is pointed at it. Every deploy therefore has new
# URLs for every file, so a browser can never mix files from two versions,
# whatever it has cached. The repo itself still runs unbuilt from any static
# server; this step only matters for deployed copies.
set -euo pipefail
cd "$(dirname "$0")/.."

sha="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || date +%s)}"
v="b-${sha:0:12}"
out="${1:-_site}"

rm -rf "$out"
mkdir -p "$out/$v"
cp -r index.html manifest.webmanifest sw.js icons "$out/"
touch "$out/.nojekyll"
cp -r css js plugins vendor data "$out/$v/"
sed -i -E "s#(href|src)=\"(css|js|vendor)/#\\1=\"$v/\\2/#g" "$out/index.html"

# List of every versioned file, so the app can cache them all for offline use.
(cd "$out/$v" && find . -type f ! -name files.json | sed 's#^\./##' | sort |
  python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))' > files.json)

echo "Built $out (version $v, $(python3 -c "import json;print(len(json.load(open('$out/$v/files.json'))))") files)"
