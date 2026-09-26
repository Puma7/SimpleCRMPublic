#!/bin/sh
free="$FAKE_DF_FREE_KB"
if [ -f "$FAKE_STORE/pruned" ] && [ -n "${FAKE_DF_FREE_KB_AFTER_PRUNE:-}" ]; then free="$FAKE_DF_FREE_KB_AFTER_PRUNE"; fi
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nfake 99999999 0 %s 1%% /\n' "$free"
