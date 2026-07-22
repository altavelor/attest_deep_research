#!/usr/bin/env bash
#
# Shared CLI-style output helpers for the agent automation scripts.
# Source this after `set -euo pipefail`. Colors are enabled only when stdout is
# a terminal, so piped/CI output stays plain and grep-friendly.

if [[ -t 1 ]]; then
  C_BOLD=$'\e[1m'
  C_DIM=$'\e[2m'
  C_BLUE=$'\e[34m'
  C_GREEN=$'\e[32m'
  C_YELLOW=$'\e[33m'
  C_RED=$'\e[31m'
  C_RESET=$'\e[0m'
else
  C_BOLD=""
  C_DIM=""
  C_BLUE=""
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
  C_RESET=""
fi

# A running action.
step() { printf '%s▸%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
# A completed action.
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
# A non-fatal warning (stderr).
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
# A fatal error (stderr).
err() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
# A follow-up hint under an error (stderr).
hint() { printf '  %s↳ %s%s\n' "$C_DIM" "$*" "$C_RESET" >&2; }
# A horizontal separator.
rule() { printf '%s────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"; }
