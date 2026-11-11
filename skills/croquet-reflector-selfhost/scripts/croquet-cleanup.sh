#!/bin/bash
# Delete stale data from the file store of a self-hosted Croquet reflector. Keeps persistent data
# (apps/<appId>/<persistentId>/save, reflector/u). Dry run by default; --apply deletes.
#
# Observed layout:
#   <sessionId>/latest.json, <sessionId>/*.json              session records written by the reflector
#   apps/<appId>/snap/<codeHash>/<persistentId>.<sessionId>/ snapshots
#   snapshots/<sessionId>/                                   snapshots of clients without an API key
#   apps/<appId>/<persistentId>/save/<hash>                  persistent data
#   reflector/u/<developerId>/<appId>/<persistentId>/saved.json  pointer to persistent data
#   dispatcher/testing/<sessionId>.json                      session registration
# Anyone can PUT, so stale files anywhere else are deleted too.
# Environment: CROQUET_FILES, CROQUET_TMP, CROQUET_RETENTION_DAYS (default 14).
set -euo pipefail

FILES=${CROQUET_FILES:-/var/lib/croquet/files}
TMP=${CROQUET_TMP:-/var/lib/croquet/tmp}
DAYS=${CROQUET_RETENTION_DAYS:-14}
WARN_PERCENT=80
APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

has_recent_file() {
    [[ -n "$(find "$1" -type f -mtime "-$DAYS" -print -quit)" ]]
}

remove() {
    echo "stale: ${1#"$FILES"/}"
    if $APPLY; then rm -rf -- "$1"; fi
}

# Keep snapshots that latest.json may point to: delete only when the session is stale too
if [[ -d "$FILES/apps" ]]; then
    find "$FILES/apps" -mindepth 4 -maxdepth 4 -type d -path '*/snap/*' -print0 |
        while IFS= read -r -d '' dir; do
            session=${dir##*.}
            has_recent_file "$dir" && continue
            [[ -d "$FILES/$session" ]] && has_recent_file "$FILES/$session" && continue
            remove "$dir"
        done
fi
if [[ -d "$FILES/snapshots" ]]; then
    find "$FILES/snapshots" -mindepth 1 -maxdepth 1 -type d -print0 |
        while IFS= read -r -d '' dir; do
            session=${dir##*/}
            has_recent_file "$dir" && continue
            [[ -d "$FILES/$session" ]] && has_recent_file "$FILES/$session" && continue
            remove "$dir"
        done
fi

# Session records, and anything put in unexpected places
find "$FILES" -mindepth 1 -maxdepth 1 ! -name apps ! -name reflector ! -name snapshots ! -name dispatcher -print0 |
    while IFS= read -r -d '' entry; do
        if [[ -d "$entry" ]]; then
            has_recent_file "$entry" || remove "$entry"
        elif [[ -z "$(find "$entry" -mtime "-$DAYS" -print -quit)" ]]; then
            remove "$entry"
        fi
    done

if [[ -d "$FILES/dispatcher" ]]; then
    find "$FILES/dispatcher" -type f ! -mtime "-$DAYS" -print0 |
        while IFS= read -r -d '' file; do remove "$file"; done
fi

if $APPLY; then
    # Remove temp files of aborted PUTs and empty directories
    find "$TMP" -mindepth 1 -type f -mtime +0 -delete
    find "$FILES" -mindepth 1 -type d -empty -mtime +0 -delete
fi

df -h "$FILES" | tail -1
usage=$(df -P "$FILES" | awk 'NR==2 { sub("%", "", $5); print $5 }')
if ((usage >= WARN_PERCENT)); then
    echo "warning: the file store is ${usage}% full" >&2
fi
