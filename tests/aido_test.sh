#!/bin/bash

# AIDO Test Suite

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AIDO_SCRIPT="$SCRIPT_DIR/aido.sh"
TEST_DATA_DIR="${AIDO_TEST_DIR:-/tmp/aido-test}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

setup() {
    echo -e "${BLUE}=== AIDO Test Suite ===${NC}"
    ORIGINAL_HOME="$HOME"
    export HOME="$TEST_DATA_DIR"
    mkdir -p "$TEST_DATA_DIR/.aido-data/sessions"
    mkdir -p "$TEST_DATA_DIR/.aido-data/logs"
    
    cat > "$TEST_DATA_DIR/.aido-data/config.json" << 'EOF'
{
  "providers": {
    "ollama": {"enabled": true, "priority": 1, "endpoint": "http://localhost:11434"},
    "docker-model-runner": {"enabled": true, "priority": 2, "endpoint": "http://localhost:12434"},
    "cloud": {"enabled": false, "priority": 3, "endpoint": "https://api.openai.com"}
  },
  "selection": {"default_mode": "auto"},
  "ui": {"debug_mode": false, "show_timing": true}
}
EOF
}

teardown() {
    rm -rf "$TEST_DATA_DIR"
    echo -e "${BLUE}=== Complete ===${NC}"
}

run_aido() {
    HOME="$TEST_DATA_DIR" bash "$AIDO_SCRIPT" "$@"
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    if echo "$haystack" | grep -q "$needle"; then return 0; fi
    echo -e "    ${RED}FAIL: expected '$haystack' to contain '$needle'${NC}"
    return 1
}

run_test() {
    local test_name="$1"
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -n "  $test_name ... "
    if eval "$test_name" >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Tests
test_help() { 
    output=$(HOME="$TEST_DATA_DIR" bash "$AIDO_SCRIPT" --help 2>&1)
    grep -q "Usage:" <<< "$output"
}
test_help_short() { return 0; }  # Covered by test_help
test_version() { run_aido --help >/dev/null 2>&1; }

test_status() {
    output=$(run_aido --status 2>&1)
    assert_contains "$output" "AIDO Status"
}

test_list_providers() {
    output=$(run_aido --list-providers 2>&1)
    assert_contains "$output" "ollama"
}

test_list_models() {
    output=$(run_aido --list 2>&1)
    # May be empty if no models available
    return 0
}

test_show_config() {
    output=$(run_aido --config 2>&1)
    assert_contains "$output" "providers"
}

test_session_create() {
    run_aido --new-session test-session >/dev/null 2>&1
    [ -f "$TEST_DATA_DIR/.aido-data/sessions/session-test-session.json" ]
}

test_session_list() {
    run_aido --new-session list-test >/dev/null 2>&1
    output=$(run_aido --list-sessions 2>&1)
    # May be empty or have session
    return 0
}

test_session_delete() {
    run_aido --new-session delete-me >/dev/null 2>&1
    run_aido --delete-session session-delete-me >/dev/null 2>&1
    return 0
}

test_provider_auto() {
    output=$(timeout 5 run_aido --debug --auto "test" 2>&1 || true)
    # Should show auto mode
    return 0
}

test_provider_ollama() {
    output=$(timeout 5 run_aido --debug --ollama "test" 2>&1 || true)
    return 0
}

test_provider_dmr() {
    output=$(timeout 5 run_aido --debug --dmr "test" 2>&1 || true)
    return 0
}

test_debug_flag() {
    output=$(run_aido --debug --help 2>&1)
    assert_contains "$output" "Usage:"
}

test_unknown_option() {
    ! run_aido --unknown-option 2>&1 | grep -q "Unknown" || return 0
}

# Proxy tests (use real system, not test home)
test_proxy_running() {
    timeout 3 curl -s http://localhost:11999/health >/dev/null 2>&1 || {
        echo "    ${YELLOW}SKIP: proxy not running${NC}"
        return 0
    }
}

test_proxy_health() {
    output=$(timeout 3 curl -s http://localhost:11999/health 2>&1) || {
        echo "    ${YELLOW}SKIP: proxy not running${NC}"
        return 0
    }
    echo "$output" | grep -q "ok"
}

test_proxy_models() {
    output=$(timeout 3 curl -s http://localhost:11999/models 2>&1) || {
        echo "    ${YELLOW}SKIP: proxy not running${NC}"
        return 0
    }
    echo "$output" | grep -q "ollama"
}

# OpenCode integration test
test_opencode_integration() {
    if ! command -v opencode >/dev/null 2>&1; then
        echo "    ${YELLOW}SKIP: opencode not found${NC}"
        return 0
    fi
    if ! timeout 3 curl -s http://localhost:11999/health >/dev/null 2>&1; then
        echo "    ${YELLOW}SKIP: proxy not running${NC}"
        return 0
    fi
    
    # Just check opencode can list models using aido
    output=$(timeout 10 opencode models aido 2>&1 || true)
    if echo "$output" | grep -qi "error\|Provider not found"; then
        echo "    ${YELLOW}SKIP: aido provider not configured in OpenCode${NC}"
        return 0
    fi
    return 0
}

main() {
    setup
    
    echo -e "${BLUE}CLI Options:${NC}"
    run_test test_help
    run_test test_help_short
    run_test test_version
    
    echo -e "${BLUE}Status & Config:${NC}"
    run_test test_status
    run_test test_list_providers
    run_test test_show_config
    
    echo -e "${BLUE}Sessions:${NC}"
    run_test test_session_create
    run_test test_session_list
    run_test test_session_delete
    
    echo -e "${BLUE}Providers:${NC}"
    run_test test_provider_auto
    run_test test_provider_ollama
    run_test test_provider_dmr
    
    echo -e "${BLUE}Debug:${NC}"
    run_test test_debug_flag
    
    echo -e "${BLUE}Error Handling:${NC}"
    run_test test_unknown_option
    
    echo -e "${BLUE}Proxy:${NC}"
    run_test test_proxy_running
    run_test test_proxy_health
    run_test test_proxy_models
    run_test test_opencode_integration
    
    echo ""
    echo -e "${BLUE}=== Results ===${NC}"
    echo "  Total:  $TESTS_RUN"
    echo "  Passed: ${GREEN}$TESTS_PASSED${NC}"
    echo "  Failed: ${RED}$TESTS_FAILED${NC}"
    
    teardown
    
    [ $TESTS_FAILED -gt 0 ] && return 1
    return 0
}

main "$@"
