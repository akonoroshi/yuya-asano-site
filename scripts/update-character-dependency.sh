#!/bin/sh
set -eu

repo=ssh://git@github.com/akonoroshi/vrm-characters.git
current=$(node -p 'require("./package-lock.json").packages["node_modules/@tonari/characters"].resolved.split("#")[1]')
history=$1/history
git init --bare --quiet "$history"

compatible_head() {
  head=$(git ls-remote "$repo" "$1") || return
  candidate=$(printf '%s\n' "$head" | cut -f 1)
  if [ -z "$candidate" ] || [ "$candidate" = "$current" ]; then
    printf '%s' "$candidate"
    return
  fi

  # Fetch commit history without downloading the source or avatar assets.
  git -C "$history" fetch --quiet --no-tags --filter=tree:0 "$repo" "$1" || return
  candidate=$(git -C "$history" rev-parse FETCH_HEAD) || return
  if git -C "$history" cat-file -e "$current^{commit}" 2>/dev/null &&
     git -C "$history" merge-base --is-ancestor "$current" "$candidate"; then
    printf '%s' "$candidate"
  fi
}

# Follow the currently deployed feature until its history reaches main.
latest=$(compatible_head refs/heads/main)
if [ -z "$latest" ]; then
  latest=$(compatible_head refs/heads/codex/shared-prepared-gesture-playback)
fi
if [ -z "$latest" ] || [ "$latest" = "$current" ]; then
  printf 'No newer shared commit compatible with %s.\n' "$current"
  exit 0
fi

printf 'Updating shared characters from %s to %s.\n' "$current" "$latest"
npm install --package-lock-only --ignore-scripts --no-audit --no-fund \
  "@tonari/characters@github:akonoroshi/vrm-characters#$latest"
