#!/usr/bin/env bash
set -euo pipefail
# Caller must set TAG_PREFIX (e.g. "frontend-v") and CLIFF_CONFIG (e.g.
# "frontend/cliff.toml", only used here to derive the commit path filter -
# the changelog step calls git-cliff itself), plus the usual
# GITHUB_REF_TYPE/GITHUB_REF_NAME, INPUT_VERSION, CHANNEL, GH_TOKEN,
# GITHUB_REPOSITORY, RUNNER_TEMP, GITHUB_OUTPUT provided by the Actions
# runner / workflow env.
number='(0|[1-9][0-9]*)'
base_pattern="$number\.$number\.$number"
tag_pattern="^${TAG_PREFIX}${base_pattern}(-rc\.[1-9][0-9]*)?$"
if [ "$GITHUB_REF_TYPE" = tag ]; then
  TAG=$GITHUB_REF_NAME
else
  VERSION=${INPUT_VERSION:-}
  if [ -z "$VERSION" ]; then
    # Bump from the last stable tag ourselves rather than via git-cliff
    # --bumped-version: that only treats a tag as a release boundary when
    # the *tagged commit* touches include_paths, but our tags land on
    # whatever commit is HEAD at release time (often a commit for a
    # different component in this monorepo) - so it silently fell back to
    # cliff.toml's hardcoded [bump] initial_tag every time.
    PREV=$(git tag --merged HEAD --sort=-version:refname \
      | { grep -E "^${TAG_PREFIX}${base_pattern}$" || true; } | head -n 1)
    [ -n "$PREV" ] || { echo '::error::No previous stable release tag found; pass an explicit starting version'; exit 1; }
    IFS=. read -r MAJOR MINOR PATCH <<< "${PREV#"$TAG_PREFIX"}"
    PATH_FILTER=$(dirname "$CLIFF_CONFIG")
    SUBJECTS=$(git log "$PREV..HEAD" --no-merges --format='%s' -- "$PATH_FILTER")
    BODY=$(git log "$PREV..HEAD" --no-merges --format='%b' -- "$PATH_FILTER")
    [ -n "$SUBJECTS" ] || { echo '::error::No commits since last release to bump from; pass an explicit version'; exit 1; }
    if grep -qE '^[a-zA-Z]+(\([^)]*\))?!:' <<< "$SUBJECTS" || grep -q '^BREAKING CHANGE:' <<< "$BODY"; then
      VERSION="$((MAJOR + 1)).0.0"
    elif grep -qE '^feat(\([^)]*\))?:' <<< "$SUBJECTS"; then
      VERSION="${MAJOR}.$((MINOR + 1)).0"
    else
      VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
    fi
  fi
  [[ "$VERSION" =~ ^${base_pattern}$ ]] || { echo '::error::Version must be X.Y.Z'; exit 1; }
  TAG="${TAG_PREFIX}${VERSION}"
  if [ "${CHANNEL:-rc}" = rc ]; then
    LAST=$(git tag -l "$TAG-rc.*" | sed -nE "s/^${TAG_PREFIX}${VERSION//./\.}-rc\.([1-9][0-9]*)$/\1/p" | sort -n | tail -n 1)
    TAG="$TAG-rc.$((${LAST:-0} + 1))"
  elif [ "$CHANNEL" != stable ]; then
    echo '::error::Unknown release channel'; exit 1
  fi
  if git show-ref --verify --quiet "refs/tags/$TAG"; then
    echo "::error::Tag already exists: $TAG. Use a new version or rerun the original workflow."
    exit 1
  fi
fi
[[ "$TAG" =~ $tag_pattern ]] || { echo "::error::Expected ${TAG_PREFIX}X.Y.Z or ${TAG_PREFIX}X.Y.Z-rc.N"; exit 1; }
# Fail on API errors rather than mistaking an authorization failure for absence.
gh api --paginate "repos/$GITHUB_REPOSITORY/releases?per_page=100" --slurp > "$RUNNER_TEMP/releases.json"
jq -e --arg tag "$TAG" '[.[][] | select(.tag_name == $tag and .draft == false)] | length == 0' "$RUNNER_TEMP/releases.json" >/dev/null || {
  echo "::error::Release already published: $TAG"; exit 1;
}
{
  echo "tag=$TAG"
  echo "version=${TAG#"$TAG_PREFIX"}"
  if [[ "$TAG" == *-rc.* ]]; then echo prerelease=true; else echo prerelease=false; fi
} >> "$GITHUB_OUTPUT"
