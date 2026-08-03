#!/usr/bin/env bash

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

step() { printf '%s▸%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
hint() { printf '  %s↳ %s%s\n' "$C_DIM" "$*" "$C_RESET" >&2; }
rule() { printf '%s────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"; }
