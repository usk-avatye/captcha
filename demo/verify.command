#!/bin/bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"
compose exec --no-TTY customer-api python /opt/demo/smoke.py
