"""
Watchdog for main.py — the other half of the self-recycling design (see
main.py's own "Concurrency & memory-discipline design" comment for the
full rationale). main.py exits cleanly (via server.should_exit) once it's
served VOICE_SERVICE_MAX_REQUESTS requests, to hand its accumulated model
memory back to the OS; something has to notice that exit and start a fresh
one, or "recycling" just means "the service goes down after N requests and
stays down." That's this script's only job.

Why a hand-rolled watchdog instead of the standard tool for this
(gunicorn's own --max-requests, which does both the recycling AND the
respawn in one battle-tested place): gunicorn's worker model needs POSIX
fork(), so it cannot run on Windows at all — and this project's actual
dev/demo machine, where this needs to genuinely run today, is Windows. A
real Linux production deployment can absolutely still use gunicorn (or
Docker/systemd restart policies) instead of this script — see README.md's
"Production deployment" section — they're alternatives, not something this
script needs to coexist with; main.py always exits(0) cleanly regardless
of what's supervising it.

Crash-loop protection: a restart within CRASH_LOOP_WINDOW_S of the
previous start is treated as a real failure, not a normal recycle (a
normal recycle only happens after genuinely serving N requests, which
takes real time) — after CRASH_LOOP_MAX_FAST_RESTARTS of those in a row,
this stops restarting and exits loudly rather than burning CPU respawning
a process that's failing to start at all (e.g., a missing dependency, a
port already in use).

Run: .venv-voice/Scripts/python.exe run_supervised.py
Stop: Ctrl+C — forwarded to the child so it shuts down cleanly too, not
left orphaned.

Scaling beyond one process: this platform's own infra-sizing work capped
real expected volume at ~1000 applications/month, which one well-behaved
(non-blocking, self-recycling) process comfortably handles — see main.py's
own sizing note. If real traffic ever needs more than one CPU core's worth
of throughput, run several of these with a different VOICE_SERVICE_PORT
each (they're fully independent — no shared state) and put a simple
reverse proxy or round-robin dispatch in front; deliberately not built
here since nothing in this codebase's actual traffic pattern needs it yet,
and building it speculatively would be real complexity with no real
problem behind it.
"""
import os
import subprocess
import sys
import time

CRASH_LOOP_WINDOW_S = 15  # a restart faster than this after the previous start is "didn't really run", not a normal recycle
CRASH_LOOP_MAX_FAST_RESTARTS = 5

THIS_DIR = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    fast_restart_count = 0
    child: subprocess.Popen | None = None

    def _forward_stop(*_args):
        if child is not None and child.poll() is None:
            child.terminate()
        raise SystemExit(0)

    try:
        import signal
        signal.signal(signal.SIGINT, _forward_stop)
        # SIGTERM exists as a Python-level constant on Windows too, but
        # nothing delivers it cross-process there in practice — harmless
        # to register either way, and it's the real stop signal on Linux
        # (e.g. `docker stop`, systemd).
        signal.signal(signal.SIGTERM, _forward_stop)
    except (ValueError, AttributeError):
        pass  # not on the main thread, or a signal this platform doesn't have — Ctrl+C still works via KeyboardInterrupt below

    print("[run_supervised] Starting, watching main.py — Ctrl+C to stop.", flush=True)

    while True:
        started_at = time.monotonic()
        child = subprocess.Popen([sys.executable, os.path.join(THIS_DIR, "main.py")], cwd=THIS_DIR)
        try:
            exit_code = child.wait()
        except KeyboardInterrupt:
            child.terminate()
            child.wait()
            print("[run_supervised] Stopped.", flush=True)
            return 0

        ran_for = time.monotonic() - started_at
        print(f"[run_supervised] main.py exited (code {exit_code}) after {ran_for:.1f}s.", flush=True)

        if ran_for < CRASH_LOOP_WINDOW_S:
            fast_restart_count += 1
            if fast_restart_count >= CRASH_LOOP_MAX_FAST_RESTARTS:
                print(
                    f"[run_supervised] main.py has exited within {CRASH_LOOP_WINDOW_S}s of starting "
                    f"{fast_restart_count} times in a row — this looks like a real startup failure, not "
                    "a normal recycle (those only happen after serving real traffic, which takes longer "
                    "than this). Stopping rather than spinning. Check the output above for the actual error.",
                    file=sys.stderr, flush=True,
                )
                return 1
        else:
            fast_restart_count = 0  # a real, healthy run — reset the crash-loop counter

        print("[run_supervised] Restarting…", flush=True)


if __name__ == "__main__":
    sys.exit(main())
