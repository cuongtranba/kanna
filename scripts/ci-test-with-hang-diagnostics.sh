#!/usr/bin/env bash
# CI test runner with hang diagnostics.
#
# Runs `bun test` exactly as before. If bun does not finish within
# HANG_AFTER seconds, dumps the stuck process tree (per-thread wchan +
# current syscall, kernel stacks, open fds, and a best-effort gdb
# backtrace) BEFORE killing it, then fails the job. On normal completion
# it is a transparent passthrough (same exit code, no extra output).
#
# Purpose: the bun-test step intermittently stalls the full 180s on CI
# while passing locally. Component code is exonerated; this captures the
# exact blocking syscall/stack on the next hung run.
set -uo pipefail

HANG_AFTER="${HANG_AFTER:-170}"

bun test --timeout 30000 &
BUNPID=$!

dump_pid() {
  local p="$1"
  echo "--- pid $p ($(tr -d '\0' </proc/"$p"/comm 2>/dev/null)) ---"
  echo "cmdline: $(tr '\0' ' ' </proc/"$p"/cmdline 2>/dev/null)"
  echo "syscall: $(cat /proc/"$p"/syscall 2>/dev/null)   # arg0=syscall nr (1=write 0=read 7=poll 61=wait4 202/98=futex 230=clock_nanosleep)"
  echo "wchan:   $(cat /proc/"$p"/wchan 2>/dev/null)"
  grep -E 'State|Threads|VmRSS' /proc/"$p"/status 2>/dev/null
  echo "kernel stack:"
  sudo cat /proc/"$p"/stack 2>/dev/null || echo "  (unavailable)"
  echo "per-thread:"
  for t in /proc/"$p"/task/*; do
    [ -d "$t" ] || continue
    echo "  tid $(basename "$t"): wchan=$(cat "$t"/wchan 2>/dev/null) syscall=$(cut -d' ' -f1 "$t"/syscall 2>/dev/null)"
  done
  echo "open fds:"
  ls -l /proc/"$p"/fd 2>/dev/null | head -40
}

(
  sleep "$HANG_AFTER"
  echo "::group::HANG DIAGNOSTICS — bun pid $BUNPID alive after ${HANG_AFTER}s"
  date -u
  PGID="$(ps -o pgid= -p "$BUNPID" 2>/dev/null | tr -d ' ')"
  echo "=== process group $PGID ==="
  ps -o pid,ppid,pgid,stat,wchan:42,etimes,cmd -g "$PGID" 2>/dev/null \
    || ps -o pid,ppid,stat,wchan:42,etimes,cmd ax 2>/dev/null | grep -E "bun|git|[g]rep" | head -40
  PIDS="$BUNPID"
  PIDS="$PIDS $(pgrep -g "$PGID" 2>/dev/null | tr '\n' ' ')"
  for p in $(echo "$PIDS" | tr ' ' '\n' | sort -u); do
    [ -d "/proc/$p" ] && dump_pid "$p"
  done
  echo "=== gdb backtrace (best effort, 90s cap) ==="
  if timeout 60 sudo apt-get install -y gdb >/dev/null 2>&1; then
    timeout 90 sudo gdb -p "$BUNPID" -batch -nx \
      -ex 'set pagination off' -ex 'thread apply all bt' 2>/dev/null | head -250 \
      || echo "(gdb attach failed)"
  else
    echo "(gdb install failed)"
  fi
  echo "::endgroup::"
  echo "::error::bun test hung >${HANG_AFTER}s — see HANG DIAGNOSTICS group above"
  kill -SIGKILL "$BUNPID" 2>/dev/null
) &
WATCHDOG=$!

wait "$BUNPID"
CODE=$?

kill "$WATCHDOG" 2>/dev/null
wait "$WATCHDOG" 2>/dev/null

exit "$CODE"
