#!/bin/sh
# Ensure /data directories exist and are writable by the node user.
# The volume mount overwrites Dockerfile-created dirs, so we fix
# ownership at runtime before dropping to the unprivileged node user.

mkdir -p /data/locks /data/logos
chown -R node:node /data

exec su-exec node node src/index.js
