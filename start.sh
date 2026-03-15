#!/bin/bash
set -a
source "$(dirname "$0")/.env"
set +a
node "$(dirname "$0")/src/app.js"
