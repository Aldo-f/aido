#!/bin/bash

# AIDO - Intelligent AI Assistant
# Multi-provider AI assistant with intelligent model selection
# Supports: Ollama, Docker Model Runner, Cloud

set -euo pipefail

# Auto-discover script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Data directory
DATA_DIR="$HOME/.aido-data"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Global variables
DEBUG_MODE=false
PROVIDER_MODE="auto"
SPECIFIC_MODEL=""
SPECIFIC_TYPE=""
LIST_MODELS=false
SHOW_STATUS=false
SHOW_CONFIG=false
INTERACTIVE_MODE=false
NEW_SESSION=""
LOAD_SESSION=""
LIST_SESSIONS=false
DELETE_SESSION=""
REFRESH_CACHE=false
QUERY=""
INSTALL_MODE=false
UNINSTALL_MODE=false
LIST_PROVIDERS=false

# Provider endpoints
OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://localhost:11434}"
DMR_ENDPOINT="${DMR_ENDPOINT:-http://localhost:12434}"
CLOUD_ENDPOINT="${CLOUD_ENDPOINT:-https://api.openai.com}"

# ==================== PROVIDER DETECTION ====================

detect_providers() {
    local providers_json="{}"
    
    # Detect Ollama
    if curl -f -s --connect-timeout 2 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
        local ollama_models
        ollama_models=$(curl -s "$OLLAMA_ENDPOINT/api/tags" | jq '[.models[].name]' 2>/dev/null || echo "[]")
        providers_json=$(echo "$providers_json" | jq \
            --argjson models "$ollama_models" \
            '. + {"ollama": {"enabled": true, "priority": 1, "endpoint": "'"$OLLAMA_ENDPOINT"'", "models": $models, "status": "running"}}')
    else
        providers_json=$(echo "$providers_json" | jq \
            '. + {"ollama": {"enabled": false, "priority": 1, "endpoint": "'"$OLLAMA_ENDPOINT"'", "models": [], "status": "not running"}}')
    fi
    
    # Detect Docker Model Runner
    if curl -f -s --connect-timeout 2 "$DMR_ENDPOINT/models" >/dev/null 2>&1; then
        local dmr_models
        dmr_models=$(curl -s "$DMR_ENDPOINT/models" 2>/dev/null | jq '[.data[].id]' 2>/dev/null || echo "[]")
        providers_json=$(echo "$providers_json" | jq \
            --argjson models "$dmr_models" \
            '. + {"docker-model-runner": {"enabled": true, "priority": 2, "endpoint": "'"$DMR_ENDPOINT"'", "models": $models, "status": "running"}}')
    else
        providers_json=$(echo "$providers_json" | jq \
            '. + {"docker-model-runner": {"enabled": false, "priority": 2, "endpoint": "'"$DMR_ENDPOINT"'", "models": [], "status": "not running"}}')
    fi
    
    # Cloud is always available (if configured)
    providers_json=$(echo "$providers_json" | jq \
        '. + {"cloud": {"enabled": false, "priority": 3, "endpoint": "'"$CLOUD_ENDPOINT"'", "models": [], "status": "disabled"}}')
    
    echo "$providers_json"
}

# ==================== INITIALIZATION ====================

init_data_dir() {
    mkdir -p "$DATA_DIR/sessions"
    mkdir -p "$DATA_DIR/logs"
    
    if [ ! -f "$DATA_DIR/config.json" ]; then
        cat > "$DATA_DIR/config.json" << 'EOFCONFIG'
{
  "providers": {
    "ollama": {"enabled": true, "priority": 1, "endpoint": "http://localhost:11434"},
    "docker-model-runner": {"enabled": true, "priority": 2, "endpoint": "http://localhost:12434"},
    "cloud": {"enabled": false, "priority": 3, "endpoint": "https://api.openai.com"}
  },
  "selection": {"default_mode": "auto", "fallback_enabled": true},
  "sessions": {"max_sessions": 50, "retention_days": 30},
  "cache": {"models_cache_hours": 168},
  "ui": {"debug_mode": false, "show_timing": true}
}
EOFCONFIG
    fi
}

# ==================== CONFIG ====================

load_config() {
    if [ -f "$DATA_DIR/config.json" ]; then
        CONFIG_JSON=$(cat "$DATA_DIR/config.json")
    else
        init_data_dir
        CONFIG_JSON=$(cat "$DATA_DIR/config.json")
    fi
    
    PROVIDER_MODE=$(echo "$CONFIG_JSON" | jq -r '.selection.default_mode // "auto"')
    DEBUG_MODE=$(echo "$CONFIG_JSON" | jq -r '.ui.debug_mode // false')
    SHOW_TIMING=$(echo "$CONFIG_JSON" | jq -r '.ui.show_timing // true')
}

log() { [ "$DEBUG_MODE" = true ] && echo -e "${BLUE}[DEBUG]${NC} $1" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
warning() { echo -e "${YELLOW}[WARNING]${NC} $1" >&2; }
success() { echo -e "${GREEN}[OK]${NC} $1" >&2; }
info() { echo -e "${CYAN}[INFO]${NC} $1" >&2; }

# ==================== INSTALL/UNINSTALL ====================

is_installed() {
    if command -v aido >/dev/null 2>&1; then
        local installed_path
        installed_path=$(readlink -f "$(command -v aido)" 2>/dev/null || echo "")
        local this_script=$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "")
        [ "$installed_path" = "$this_script" ] && [ -n "$installed_path" ]
    else
        return 1
    fi
}

install_aido() {
    local source_file
    source_file=$(readlink -f "${BASH_SOURCE[0]}")
    
    echo "Installing AIDO globally..."
    
    if [ -w "/usr/local/bin" ]; then
        ln -sf "$source_file" /usr/local/bin/aido
        success "Installed to /usr/local/bin/aido"
    elif [ -w "/usr/local" ]; then
        mkdir -p /usr/local/bin
        ln -sf "$source_file" /usr/local/bin/aido
        success "Installed to /usr/local/bin/aido"
    else
        mkdir -p "$HOME/.local/bin"
        ln -sf "$source_file" "$HOME/.local/bin/aido"
        
        if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
            echo "" >> "$HOME/.bashrc"
            echo '# AIDO PATH' >> "$HOME/.bashrc"
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
        fi
        
        success "Installed to $HOME/.local/bin/aido"
        echo "Run: source ~/.bashrc"
    fi
    
    echo ""
    echo "AIDO installation complete!"
}

uninstall_aido() {
    echo "Uninstalling AIDO..."
    
    if [ -L "/usr/local/bin/aido" ]; then
        rm /usr/local/bin/aido 2>/dev/null || echo "Remove manually: sudo rm /usr/local/bin/aido"
    fi
    
    if [ -L "$HOME/.local/bin/aido" ]; then
        rm "$HOME/.local/bin/aido"
    fi
    
    echo ""
    echo "Remove data? (y/n)"
    read -r response
    if [ "$response" = "y" ]; then
        rm -rf "$DATA_DIR"
        echo "Data removed."
    fi
}

# ==================== QUERY ANALYSIS ====================

analyze_query() {
    local query="$1"
    local complexity_score=0
    local capabilities="general"
    
    local word_count=$(echo "$query" | wc -w)
    
    if echo "$query" | grep -qi -E "code|programming|debug|fix|write"; then
        complexity_score=$((complexity_score + 2))
        capabilities="coding"
    fi
    
    if echo "$query" | grep -qi -E "image|picture|photo|visual|diagram|wat zie"; then
        complexity_score=$((complexity_score + 2))
        capabilities="vision"
    fi
    
    if echo "$query" | grep -qi -E "think|reason|why|how"; then
        complexity_score=$((complexity_score + 2))
        capabilities="reasoning"
    fi
    
    if [ "$word_count" -gt 50 ]; then
        complexity_score=$((complexity_score + 2))
    elif [ "$word_count" -gt 20 ]; then
        complexity_score=$((complexity_score + 1))
    fi
    
    echo "$complexity_score $capabilities"
}

# ==================== MODEL SELECTION ====================

get_all_available_models() {
    local providers
    providers=$(detect_providers)
    
    local all_models="[]"
    
    # Ollama models
    local ollama_status
    ollama_status=$(echo "$providers" | jq -r '.ollama.status')
    if [ "$ollama_status" = "running" ]; then
        local ollama_models
        ollama_models=$(echo "$providers" | jq '.ollama.models')
        if [ "$ollama_models" != "null" ] && [ -n "$ollama_models" ]; then
            all_models=$(echo "$all_models" | jq --argjson models "$ollama_models" \
                '. + $models | map({"name": ., "provider": "ollama"})' 2>/dev/null || echo "$all_models")
        fi
    fi
    
    # DMR models
    local dmr_status
    dmr_status=$(echo "$providers" | jq -r '.["docker-model-runner"].status')
    if [ "$dmr_status" = "running" ]; then
        local dmr_models
        dmr_models=$(echo "$providers" | jq '.["docker-model-runner"].models')
        if [ "$dmr_models" != "null" ] && [ -n "$dmr_models" ]; then
            all_models=$(echo "$all_models" | jq --argjson models "$dmr_models" \
                '. + $models | map({"name": ., "provider": "docker-model-runner"})' 2>/dev/null || echo "$all_models")
        fi
    fi
    
    echo "$all_models"
}

select_model_auto() {
    local query="$1"
    local analysis
    local complexity_score
    local capabilities
    
    analysis=$(analyze_query "$query")
    complexity_score=$(echo "$analysis" | cut -d' ' -f1)
    capabilities=$(echo "$analysis" | cut -d' ' -f2-)
    
    log "Query complexity: $complexity_score, capabilities: $capabilities"
    
    local all_models
    all_models=$(get_all_available_models)
    
    if [ "$(echo "$all_models" | jq 'length')" -eq 0 ]; then
        error "No models available"
        return 1
    fi
    
    # Pick first available model (sorted by provider priority)
    local selected
    selected=$(echo "$all_models" | jq -r '.[0].name')
    local selected_provider
    selected_provider=$(echo "$all_models" | jq -r '.[0].provider')
    
    log "Selected: $selected (provider: $selected_provider)"
    
    echo "$selected"
}

get_provider_for_model() {
    local model="$1"
    local all_models
    all_models=$(get_all_available_models)
    echo "$all_models" | jq -r ".[] | select(.name == \"$model\") | .provider" 2>/dev/null || echo "ollama"
}

select_model() {
    local query="$1"
    
    if [ -n "$SPECIFIC_MODEL" ]; then
        echo "$SPECIFIC_MODEL"
        return
    fi
    
    case "$PROVIDER_MODE" in
        auto)
            select_model_auto "$query"
            ;;
        ollama)
            curl -s "$OLLAMA_ENDPOINT/api/tags" | jq -r '.models[0].name' 2>/dev/null || { error "Ollama not available"; return 1; }
            ;;
        docker-model-runner|dmr)
            curl -s "$DMR_ENDPOINT/models" | jq -r '.data[0].id' 2>/dev/null || { error "DMR not available"; return 1; }
            ;;
        *)
            select_model_auto "$query"
            ;;
    esac
}

# ==================== SESSION MANAGEMENT ====================

create_session() {
    local name="${1:-}"
    local session_id="session-$(date +%Y-%m-%d-%H-%M-%S)"
    
    if [ -n "$name" ]; then
        session_id="session-$name"
    fi
    
    local session_file="$DATA_DIR/sessions/${session_id}.json"
    
    cat > "$session_file" << EOFSESSION
{
  "session_id": "$session_id",
  "name": "${name:-unnamed}",
  "created_at": "$(date -Iseconds)",
  "last_updated": "$(date -Iseconds)",
  "provider_mode": "$PROVIDER_MODE",
  "message_count": 0,
  "models_used": [],
  "messages": []
}
EOFSESSION
    
    echo "$session_id" > "$DATA_DIR/sessions/current-session.txt"
    cp "$session_file" "$DATA_DIR/sessions/current-session.json"
    
    echo "$session_id"
}

save_session() {
    local session_file="$DATA_DIR/sessions/current-session.json"
    local session_id
    session_id=$(cat "$DATA_DIR/sessions/current-session.txt" 2>/dev/null || echo "session-default")
    
    if [ -f "$session_file" ]; then
        local session_json
        session_json=$(cat "$session_file")
        session_json=$(echo "$session_json" | jq ".last_updated = \"$(date -Iseconds)\"")
        echo "$session_json" > "$session_file"
        cp "$session_file" "$DATA_DIR/sessions/${session_id}.json" 2>/dev/null || true
    fi
}

list_sessions() {
    if [ -f "$DATA_DIR/sessions/session-index.json" ]; then
        cat "$DATA_DIR/sessions/session-index.json" | jq -r '.sessions[].session_id' 2>/dev/null || echo "No sessions"
    else
        echo "No sessions found"
    fi
}

delete_session() {
    local session_id="$1"
    local session_file="$DATA_DIR/sessions/${session_id}.json"
    
    if [ -f "$session_file" ]; then
        rm "$session_file"
        success "Deleted: $session_id"
    else
        error "Not found: $session_id"
    fi
}

add_message_to_session() {
    local role="$1"
    local content="$2"
    local model="$3"
    
    local session_file="$DATA_DIR/sessions/current-session.json"
    
    if [ -f "$session_file" ]; then
        local session_json
        session_json=$(cat "$session_file")
        
        local message_json
        message_json=$(jq -n \
            --arg role "$role" \
            --arg content "$content" \
            --arg model "$model" \
            --arg timestamp "$(date -Iseconds)" \
            '{"role": $role, "content": $content, "model": $model, "timestamp": $timestamp}')
        
        session_json=$(echo "$session_json" | jq --argjson msg "$message_json" '.messages += [$msg]')
        session_json=$(echo "$session_json" | jq '.message_count += 1')
        
        echo "$session_json" > "$session_file"
    fi
}

# ==================== QUERY EXECUTION ====================

execute_query() {
    local query="$1"
    local start_time
    start_time=$(date +%s%N)
    
    local model
    model=$(select_model "$query")
    
    if [ -z "$model" ]; then
        error "No model selected"
        return 1
    fi
    
    local provider
    if [ "$PROVIDER_MODE" = "auto" ]; then
        provider=$(get_provider_for_model "$model")
    else
        provider="$PROVIDER_MODE"
    fi
    
    local endpoint
    case "$provider" in
        docker-model-runner) endpoint="$DMR_ENDPOINT" ;;
        *) endpoint="$OLLAMA_ENDPOINT" ;;
    esac
    
    local agent_name
    agent_name=$(echo "$model" | cut -d':' -f1 | sed 's/-cloud//')
    
    info "Using: $model (provider: $provider)"
    
    local response
    if [ "$provider" = "docker-model-runner" ]; then
        # DMR uses OpenAI-compatible API
        response=$(curl -s -X POST "$endpoint/chat/completions" \
            -H "Content-Type: application/json" \
            -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"$query\"}], \"stream\": false}" | \
            jq -r '.choices[0].message.content' 2>/dev/null) || true
    else
        # Ollama API
        response=$(curl -s -X POST "$endpoint/api/generate" \
            -d "{\"model\": \"$model\", \"prompt\": \"$query\", \"stream\": false}" | \
            jq -r '.response' 2>/dev/null) || true
    fi
    
    local end_time end_time_sec
    end_time=$(date +%s%N)
    end_time_sec=$(( (end_time - start_time) / 1000000 ))
    
    echo ""
    echo "[${CYAN}${agent_name}${NC}] $response"
    
    if [ "$SHOW_TIMING" = true ]; then
        info "Response time: ${end_time_sec}ms"
    fi
    
    add_message_to_session "user" "$query" "$model"
    add_message_to_session "assistant" "$response" "$model"
    save_session
}

# ==================== INTERACTIVE MODE ====================

interactive_mode() {
    if [ ! -f "$DATA_DIR/sessions/current-session.json" ]; then
        create_session "interactive"
    fi
    
    echo -e "${CYAN}AIDO Interactive Mode${NC}"
    echo "Type /help for commands, /exit to quit"
    echo ""
    
    while true; do
        echo -n -e "${BLUE}>${NC} "
        read -r input
        
        if [[ "$input" == /* ]]; then
            handle_command "$input"
            continue
        fi
        
        [ -z "$input" ] && continue
        execute_query "$input"
    done
}

handle_command() {
    local cmd="$1"
    local args="${cmd#* }"
    cmd="${cmd%% *}"
    
    case "$cmd" in
        /help|/h)
            echo "Commands:"
            echo "  /new [name]     Create new session"
            echo "  /list           List sessions"
            echo "  /load <id>      Load session"
            echo "  /save           Save session"
            echo "  /delete <id>    Delete session"
            echo "  /clear          Clear conversation"
            echo "  /provider <m>   Set provider (auto/ollama/dmr)"
            echo "  /debug on/off   Toggle debug"
            echo "  /models         List models"
            echo "  /providers      List providers"
            echo "  /status         Show status"
            echo "  /exit           Exit"
            ;;
        /new) create_session "$args"; success "Created" ;;
        /list|/sessions) list_sessions ;;
        /load)
            if [ -n "$args" ]; then
                cp "$DATA_DIR/sessions/${args}.json" "$DATA_DIR/sessions/current-session.json" 2>/dev/null && \
                    echo "$args" > "$DATA_DIR/sessions/current-session.txt" && success "Loaded" || error "Not found"
            fi
            ;;
        /save) save_session; success "Saved" ;;
        /delete) [ -n "$args" ] && delete_session "$args" ;;
        /clear) create_session "interactive"; success "Cleared" ;;
        /provider|/mode)
            if [ -n "$args" ]; then
                PROVIDER_MODE="$args"; success "Provider: $PROVIDER_MODE"
            else echo "Current: $PROVIDER_MODE"; fi
            ;;
        /debug)
            case "$args" in
                on) DEBUG_MODE=true; success "Debug on" ;;
                off) DEBUG_MODE=false; success "Debug off" ;;
                *) echo "Debug: $DEBUG_MODE" ;;
            esac
            ;;
        /models)
            echo "Available models:"
            get_all_available_models | jq -r '.[] | "  \(.name) [\(.provider)]"'
            ;;
        /providers)
            detect_providers | jq -r 'to_entries[] | "\(.key): \(.value.status) (priority: \(.value.priority))"'
            ;;
        /status)
            if [ -f "$DATA_DIR/sessions/current-session.json" ]; then
                jq -r '"\(.session_id): \(.message_count) messages"' "$DATA_DIR/sessions/current-session.json"
            fi
            ;;
        /exit|/quit)
            save_session; echo "Goodbye!"; exit 0
            ;;
        *) echo "Unknown: $cmd" ;;
    esac
}

# ==================== CLI PARSING ====================

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --debug|-d) DEBUG_MODE=true; shift ;;
            --provider|-p) PROVIDER_MODE="$2"; shift 2 ;;
            --model|-m) SPECIFIC_MODEL="$2"; shift 2 ;;
            --ollama) PROVIDER_MODE="ollama"; shift ;;
            --dmr) PROVIDER_MODE="docker-model-runner"; shift ;;
            --auto) PROVIDER_MODE="auto"; shift ;;
            --list|-l) LIST_MODELS=true; shift ;;
            --status|-s) SHOW_STATUS=true; shift ;;
            --config) SHOW_CONFIG=true; shift ;;
            --interactive|-i) INTERACTIVE_MODE=true; shift ;;
            --new-session) NEW_SESSION="${2:-}"; [ -n "$NEW_SESSION" ] && shift; shift ;;
            --load-session) LOAD_SESSION="$2"; shift 2 ;;
            --list-sessions) LIST_SESSIONS=true; shift ;;
            --delete-session) DELETE_SESSION="$2"; shift 2 ;;
            --list-providers) LIST_PROVIDERS=true; shift ;;
            --install) INSTALL_MODE=true; shift ;;
            --uninstall) UNINSTALL_MODE=true; shift ;;
            --help|-h) show_help; exit 0 ;;
            -*) error "Unknown: $1"; show_help; exit 1 ;;
            *) QUERY="$*"; break ;;
        esac
    done
}

show_help() {
    echo -e "${CYAN}AIDO - Intelligent AI Assistant${NC}"
    echo ""
    echo "Usage: aido [OPTIONS] query"
    echo ""
    echo "Options:"
    echo "  --debug, -d              Show debug info"
    echo "  --install                Install globally"
    echo "  --uninstall              Uninstall"
    echo "  --auto                  Auto-select (default)"
    echo "  --provider, -p <mode>   Provider mode"
    echo "  --ollama                 Ollama only"
    echo "  --dmr                    Docker Model Runner only"
    echo "  --model, -m <model>      Specific model"
    echo "  --list, -l               List models"
    echo "  --status, -s             Show status"
    echo "  --config                 Show config"
    echo "  --interactive, -i        Interactive mode"
    echo "  --list-providers         List providers"
    echo "  --help, -h              Help"
    echo ""
    echo "Providers:"
    echo "  auto (default), ollama, dmr"
}

show_status() {
    echo -e "${CYAN}=== AIDO Status ===${NC}"
    echo ""
    echo "Providers:"
    detect_providers | jq -r 'to_entries[] | "  \(.key): \(.value.status) (priority: \(.value.priority))"'
    echo ""
    echo "Models:"
    get_all_available_models | jq -r '.[] | "  \(.name) [\(.provider)]"'
}

show_providers() {
    echo -e "${CYAN}=== Providers ===${NC}"
    detect_providers | jq '.'
}

# ==================== MAIN ====================

main() {
    for arg in "$@"; do
        case "$arg" in
            --install|--install=yes) INSTALL_MODE=true ;;
            --uninstall|--uninstall=yes) UNINSTALL_MODE=true ;;
        esac
    done
    
    if [ "$INSTALL_MODE" = true ]; then install_aido; exit $?; fi
    if [ "$UNINSTALL_MODE" = true ]; then uninstall_aido; exit $?; fi
    
    init_data_dir
    load_config
    parse_arguments "$@"
    
    [ "$SHOW_CONFIG" = true ] && { cat "$DATA_DIR/config.json" | jq '.'; exit 0; }
    [ "$LIST_PROVIDERS" = true ] && { show_providers; exit 0; }
    [ "$SHOW_STATUS" = true ] && { show_status; exit 0; }
    [ "$LIST_MODELS" = true ] && { get_all_available_models | jq -r '.[] | "  \(.name) [\(.provider)]"'; exit 0; }
    [ "$LIST_SESSIONS" = true ] && { list_sessions; exit 0; }
    [ -n "$DELETE_SESSION" ] && { delete_session "$DELETE_SESSION"; exit 0; }
    
    if [ "$INTERACTIVE_MODE" = true ] || [ -z "${QUERY:-}" ]; then
        INTERACTIVE_MODE=true
        [ -n "$LOAD_SESSION" ] && cp "$DATA_DIR/sessions/${LOAD_SESSION}.json" "$DATA_DIR/sessions/current-session.json" 2>/dev/null
        [ -n "$NEW_SESSION" ] && create_session "$NEW_SESSION"
        [ ! -f "$DATA_DIR/sessions/current-session.json" ] && create_session "default"
        interactive_mode
        exit 0
    fi
    
    [ -z "${QUERY:-}" ] && { error "No query"; show_help; exit 1; }
    
    execute_query "$QUERY"
}

main "$@"
