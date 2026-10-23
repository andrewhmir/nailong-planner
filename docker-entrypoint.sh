#!/bin/sh
# Railway (and Docker named volumes in general) mount the data volume owned by
# root, while the app runs as the unprivileged `app` user. SQLite then cannot
# create /data/planner.db, so every request fails and the deploy never turns
# healthy. Fix the mount's ownership once per container start, then drop
# privileges and exec the real command.
#
# Running the image as a non-root user (`docker run --user 1000`) skips the chown
# and keeps the previous behaviour.
set -eu

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R app:app "$DATA_DIR"
  exec gosu app "$@"
fi

exec "$@"
