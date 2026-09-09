#!/usr/bin/env bash
set -euo pipefail
# Caller must set TAG_PREFIX (e.g. "frontend-v") and CLIFF_CONFIG (e.g.
# "frontend/cliff.toml"), plus the usual GITHUB_REF_TYPE/GITHUB_REF_NAME,
# INPUT_VERSION, CHANNEL, GH_TOKEN, GITHUB_REPOSITORY, RUNNER_TEMP,
# GITHUB_OUTPUT provided by the Actions runner / workflow env.
number='(0|[1-9][0-9]*)'
base_pattern="$number\.$number\.$number"
tag_pattern="^${TAG_PREFIX}${base_pattern}(-rc\.[1-9][0-9]*)?$"
if [ "$GITHUB_REF_TYPE" = tag ]; then
  TAG=$GITHUB_REF_NAME
else
  VERSION=${INPUT_VERSION:-}
  if [ -z "$VERSION" ]; then
    VERSION=$(git-cliff --config "$CLIFF_CONFIG" --bumped-version)
    VERSION=${VERSION#"$TAG_PREFIX"}
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
