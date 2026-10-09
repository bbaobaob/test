#!/data/data/com.termux/files/usr/bin/bash
# ──────────────────────────────────────────────────────────
# Termux Watchdog — Reaction Role Bot (Node.js)  v1.11.3
# Keeps bot alive 24/7, auto-restarts on crash.
#
# Usage:
#   chmod +x scripts/termux-watchdog.sh
#   ./scripts/termux-watchdog.sh          # foreground (for tmux)
#   ./scripts/termux-watchdog.sh --daemon # background (nohup)
# ──────────────────────────────────────────────────────────

cd "$(dirname "$0")/.." || exit 1
# Use `node index.js` directly. The project's `npm start` script is exactly
# this, but invoking npm in this Termux adds a fragile stdout pipe whose
# closure triggers EPIPE crashes. Direct node is stable for 24/7 operation.
BOT_CMD="node index.js"
LOG_DIR="logs"
PID_FILE="runtime/bot.pid"
WATCHDOG_PID_FILE="runtime/watchdog.pid"
MAX_RESTART_DELAY=60

mkdir -p "$LOG_DIR" runtime

export NODE_ENV="${NODE_ENV:-production}"
export LOW_RAM_MODE="${LOW_RAM_MODE:-1}"
export ENABLE_MEMBER_INTENT="${ENABLE_MEMBER_INTENT:-0}"
export ENABLE_LIVE_MEMBER_CACHE="${ENABLE_LIVE_MEMBER_CACHE:-0}"
export PICKER_TIMEOUT="${PICKER_TIMEOUT:-90}"
export MEMBER_CACHE_TTL="${MEMBER_CACHE_TTL:-3600}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

_cleanup() {
    echo "[watchdog] Shutting down..."
    if [ -f "$PID_FILE" ]; then
        kill "$(cat "$PID_FILE")" 2>/dev/null || true
        rm -f "$PID_FILE"
    fi
    rm -f "$WATCHDOG_PID_FILE"
    exit 0
}

_usage() {
    echo "Usage: $0 [--daemon|--stop|--status]"
    echo "  (no flag)   Run in foreground (for tmux/screen)"
    echo "  --daemon    Run in background via nohup"
    echo "  --stop      Stop the running instance"
    echo "  --status    Check if bot is running"
    exit 0
}

_run_watchdog() {
    trap _cleanup SIGTERM SIGINT

    local attempt=0
    local delay=1
    echo "$$" > "$WATCHDOG_PID_FILE"

    echo "[watchdog] Starting Reaction Role Bot (Node.js)..."
    while true; do
        echo "[watchdog] Launch: $BOT_CMD (attempt $((++attempt)))"
        $BOT_CMD &
        local bot_pid=$!
        echo "$bot_pid" > "$PID_FILE"
        wait "$bot_pid"
        local exit_code=$?
        rm -f "$PID_FILE"
        echo "[watchdog] Bot exited with code $exit_code at $(date '+%Y-%m-%d %H:%M:%S')"

        if [ $exit_code -eq 0 ]; then
            echo "[watchdog] Clean exit — not restarting."
            break
        fi

        echo "[watchdog] Restarting in ${delay}s..."
        sleep "$delay"
        [ $delay -lt $MAX_RESTART_DELAY ] && delay=$((delay * 2))
    done
}

case "${1:-}" in
    --daemon)
        if [ -f "$WATCHDOG_PID_FILE" ] && kill -0 "$(cat "$WATCHDOG_PID_FILE")" 2>/dev/null; then
            echo "[watchdog] Already running (PID $(cat "$WATCHDOG_PID_FILE"))"
            exit 0
        fi
        nohup "$0" > "$LOG_DIR/watchdog.log" 2>&1 &
        echo "[watchdog] Started in background (PID $!)"
        ;;
    --stop)
        if [ -f "$WATCHDOG_PID_FILE" ]; then
            kill "$(cat "$WATCHDOG_PID_FILE")" 2>/dev/null || true
            rm -f "$WATCHDOG_PID_FILE"
        fi
        if [ -f "$PID_FILE" ]; then
            kill "$(cat "$PID_FILE")" 2>/dev/null && echo "[watchdog] Stopped" || echo "[watchdog] No process found"
            rm -f "$PID_FILE"
        else
            pkill -f "node index.js" 2>/dev/null && echo "[watchdog] Stopped (by pkill)" || echo "[watchdog] Bot not running"
        fi
        ;;
    --status)
        if [ -f "$WATCHDOG_PID_FILE" ] && kill -0 "$(cat "$WATCHDOG_PID_FILE")" 2>/dev/null; then
            echo "[watchdog] Watchdog running (PID $(cat "$WATCHDOG_PID_FILE"))"
            if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
                echo "[watchdog] Bot running (PID $(cat "$PID_FILE"))"
            fi
        elif [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo "[watchdog] Bot running (PID $(cat "$PID_FILE"))"
        elif pgrep -f "node index.js" >/dev/null 2>&1; then
            echo "[watchdog] Bot running (PID $(pgrep -f 'node index.js' | head -1))"
        else
            echo "[watchdog] Bot not running"
        fi
        ;;
    --help|-h)
        _usage
        ;;
    *)
        _run_watchdog
        ;;
esac
