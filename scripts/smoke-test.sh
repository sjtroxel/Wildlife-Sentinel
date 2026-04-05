#!/usr/bin/env bash
# Phase 9 — Track 7 Smoke Test
# Usage: bash scripts/smoke-test.sh
#
# Covers all automated checks. At the end it prints instructions
# for the 4 manual items (Discord, frontend, CORS).

set -uo pipefail

BACKEND="https://wildlife-sentinel.up.railway.app"
FRONTEND="https://wildlife-sentinel.vercel.app"

# ── Colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}✅ PASS${RESET}  $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}❌ FAIL${RESET}  $1"; FAIL=$((FAIL + 1)); }
info() { echo -e "  ${YELLOW}ℹ️  INFO${RESET}  $1"; }
header() { echo -e "\n${BOLD}$1${RESET}"; }

# ── Helper: fetch JSON and print it ────────────────────────────────────────
fetch_json() {
  curl -sf --max-time 10 "$1" 2>/dev/null
}

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Wildlife Sentinel — Phase 9 Smoke Test${RESET}"
echo -e "${BOLD}  Backend:  $BACKEND${RESET}"
echo -e "${BOLD}  Frontend: $FRONTEND${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# ── 1. /health ──────────────────────────────────────────────────────────────
header "1/5  GET /health"
HEALTH=$(fetch_json "$BACKEND/health") || { fail "/health request failed (connection error or non-2xx)"; HEALTH="{}"; }

if [ -n "$HEALTH" ]; then
  echo "     Response: $HEALTH"
  STATUS=$(echo "$HEALTH" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  DB=$(echo "$HEALTH" | grep -o '"db":"[^"]*"' | cut -d'"' -f4)
  REDIS=$(echo "$HEALTH" | grep -o '"redis":"[^"]*"' | cut -d'"' -f4)
  DISCORD=$(echo "$HEALTH" | grep -o '"discord":"[^"]*"' | cut -d'"' -f4)

  [ "$STATUS" = "ok" ]          && pass "status = ok"          || fail "status = '$STATUS' (expected 'ok')"
  [ "$DB" = "connected" ]       && pass "db = connected"       || fail "db = '$DB' (expected 'connected')"
  [ "$REDIS" = "connected" ]    && pass "redis = connected"    || fail "redis = '$REDIS' (expected 'connected')"
  [ "$DISCORD" = "connected" ]  && pass "discord = connected"  || fail "discord = '$DISCORD' (expected 'connected')"
fi

# ── 2. /alerts/recent ───────────────────────────────────────────────────────
header "2/5  GET /alerts/recent"
ALERTS=$(fetch_json "$BACKEND/alerts/recent") || { fail "/alerts/recent request failed"; ALERTS="null"; }

if [ -n "$ALERTS" ] && [ "$ALERTS" != "null" ]; then
  echo "     Response (first 200 chars): ${ALERTS:0:200}"
  # Must start with '[' (JSON array)
  if [[ "$ALERTS" == \[* ]]; then
    COUNT=$(echo "$ALERTS" | grep -o '"id"' | wc -l | tr -d ' ')
    pass "returns a JSON array ($COUNT alert(s) in DB)"
  else
    fail "response is not a JSON array — got: ${ALERTS:0:100}"
  fi
fi

# ── 3. /refiner/scores ──────────────────────────────────────────────────────
header "3/5  GET /refiner/scores"
SCORES=$(fetch_json "$BACKEND/refiner/scores") || { fail "/refiner/scores request failed"; SCORES="null"; }

if [ -n "$SCORES" ] && [ "$SCORES" != "null" ]; then
  echo "     Response (first 200 chars): ${SCORES:0:200}"
  if [[ "$SCORES" == \[* ]]; then
    COUNT=$(echo "$SCORES" | grep -o '"id"' | wc -l | tr -d ' ')
    pass "returns a JSON array ($COUNT score(s) in DB)"
  else
    fail "response is not a JSON array — got: ${SCORES:0:100}"
  fi
fi

# ── 4. /habitats (GeoJSON) ──────────────────────────────────────────────────
header "4/5  GET /habitats?minLng=-10&minLat=-10&maxLng=10&maxLat=10"
HABITATS=$(fetch_json "$BACKEND/habitats?minLng=-10&minLat=-10&maxLng=10&maxLat=10") || { fail "/habitats request failed"; HABITATS="null"; }

if [ -n "$HABITATS" ] && [ "$HABITATS" != "null" ]; then
  echo "     Response (first 200 chars): ${HABITATS:0:200}"
  TYPE=$(echo "$HABITATS" | grep -o '"type":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$TYPE" = "FeatureCollection" ]; then
    FEAT_COUNT=$(echo "$HABITATS" | grep -o '"Feature"' | wc -l | tr -d ' ')
    pass "returns GeoJSON FeatureCollection ($FEAT_COUNT feature(s))"
  else
    fail "expected FeatureCollection, got type='$TYPE'"
  fi
fi

# ── 5. SSE /agent-activity ──────────────────────────────────────────────────
header "5/5  SSE /agent-activity (3 second connection test)"
SSE_OUTPUT=$(curl -sf --max-time 3 -N \
  -H "Accept: text/event-stream" \
  "$BACKEND/agent-activity" 2>&1) || SSE_EXIT=$?

# curl exits non-zero on timeout (28) — that's actually what we want:
# it means the connection stayed open long enough to hit our 3s limit.
# A fast failure (connection refused, 404, etc.) returns a different code quickly.
if [ "${SSE_EXIT:-0}" -eq 28 ] || echo "$SSE_OUTPUT" | grep -q "data:"; then
  pass "SSE stream opened and stayed connected (timed out cleanly after 3s as expected)"
  if echo "$SSE_OUTPUT" | grep -q "data:"; then
    info "Received data on SSE stream: $(echo "$SSE_OUTPUT" | grep 'data:' | head -1)"
  fi
else
  fail "SSE stream did not stay open — exit code ${SSE_EXIT:-0}, output: ${SSE_OUTPUT:0:200}"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
TOTAL=$((PASS + FAIL))
echo -e "${BOLD}  Automated results: $PASS/$TOTAL passed${RESET}"
if [ $FAIL -gt 0 ]; then
  echo -e "  ${RED}$FAIL check(s) failed — see above${RESET}"
fi
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# ── Manual checks ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Manual checks (4 items — do these now and report back):${RESET}"
echo ""
echo -e "${BOLD}  A. Discord bot online?${RESET}"
echo "     Open Discord → your server → Members list (right sidebar)."
echo "     Look for 'Wildlife Sentinel' with a green dot. Report: online / offline."
echo ""
echo -e "${BOLD}  B. Frontend loads on mobile?${RESET}"
echo "     Open this URL in Chrome: $FRONTEND"
echo "     Open DevTools (F12) → Toggle Device Toolbar (Ctrl+Shift+M) → set to 375×812."
echo "     Report: loads OK / blank / error. Do you see the map, alerts feed, and agent activity panel?"
echo ""
echo -e "${BOLD}  C. Frontend loads on desktop?${RESET}"
echo "     Same URL but at full browser width (close DevTools or set viewport to 1280px+)."
echo "     Report: loads OK / blank / error. Do the map tiles render (actual map imagery visible)?"
echo ""
echo -e "${BOLD}  D. CORS check (no errors when frontend fetches the API)?${RESET}"
echo "     1. Open $FRONTEND in your browser."
echo "     2. Open DevTools → Console tab."
echo "     3. Paste this exactly and press Enter:"
echo ""
echo "        fetch('$BACKEND/alerts/recent').then(r => r.json()).then(d => console.log('CORS OK, alerts:', d.length)).catch(e => console.error('CORS FAIL:', e))"
echo ""
echo "     Report: does it log 'CORS OK, alerts: N' or 'CORS FAIL: ...'?"
echo ""
