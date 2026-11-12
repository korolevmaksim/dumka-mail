#!/bin/bash
# Renders every mock state to design-review/stage3/renders (2880x1800, same scale as the stage 0 screenshots).
set -euo pipefail
cd "$(dirname "$0")/.."
targets=()
for d in d1 d2 d3; do for s in inbox thread agent confirm empty loading error; do targets+=("mocks/mock.html#$d-$s"); done; done
for s in firstrun firstrunerror search settings; do targets+=("mocks/mock.html#sh-$s"); done
rm -rf renders
../../node_modules/.bin/electron tools/render.cjs renders "${targets[@]}"
