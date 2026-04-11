#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIDO_DIR="$(dirname "$SCRIPT_DIR")"
exec "$AIDO_DIR/aido" "$@"
