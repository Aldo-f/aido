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
PROXY_PORT=""
SPECIFIC_MODEL=""
SHOW_CONFIG=false
QUERY=""
INSTALL_MODE=false
UNINSTALL_MODE=false

# ==================== OLLAMA DETECTION ====================

detect_ollama_install() {
    # Check for Docker container first
    if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^ollama$"; then
        echo "docker"
    elif command -v ollama >/dev/null 2>&1; then
        echo "cli"
    elif [ -f "/usr/local/bin/ollama" ]; then
        echo "binary"
    elif [ -f "$HOME/ollama" ]; then
        echo "home"
    else
        echo "service"
    fi
}

install_model() {
    local model="$1"
    local install_type
    install_type=$(detect_ollama_install)
    
    case "$install_type" in
        cli)
            info "Installing $model via ollama pull..."
            if command -v ollama >/dev/null 2>&1; then
                ollama pull "$model"
                success "Installed: $model"
            else
                error "Ollama CLI not found"
                return 1
            fi
            ;;
        docker)
            info "Installing $model via Docker..."
            if docker exec ollama ollama pull "$model" 2>/dev/null; then
                success "Installed: $model"
            else
                error "Failed to install $model"
                return 1
            fi
            ;;
        binary|home)
            info "Ollama binary found at $HOME/ollama or /usr/local/bin"
            info "Run 'ollama pull $model' to install models"
            return 1
            ;;
        service)
            error "Ollama appears to be running as a service"
            info "Install Ollama CLI to download models:"
            echo "  macOS: https://ollama.com/download/mac"
            echo "  Windows: https://ollama.com/download/windows"
            echo "  Linux: curl -fsSL https://ollama.com/install.sh | sh"
            return 1
            ;;
    esac
}

install_recommended_models() {
    local install_type
    install_type=$(detect_ollama_install)
    
    if [ "$install_type" = "service" ]; then
        error "Ollama CLI not available"
        info "To install models, install Ollama from: https://ollama.com"
        echo ""
        echo "Or browse models at: https://ollama.com/search?q=cloud"
        return 1
    fi
    
    if [ "$install_type" = "docker" ]; then
        info "Ollama detected in Docker"
    fi
    
    local cli_cmd=""
    local models=("llama3.2:latest" "codellama:latest" "mistral:latest")
    
    case "$install_type" in
        cli)
            cli_cmd="ollama"
            ;;
        docker)
            cli_cmd="docker exec ollama ollama"
            ;;
        binary|home)
            info "Ollama binary found locally"
            info "Run 'ollama pull <model>' to install models"
            return 1
            ;;
    esac
    
    echo -e "${CYAN}Installing recommended models...${NC}"
    echo ""
    
    for model in "${models[@]}"; do
        info "Installing $model..."
        if eval "$cli_cmd pull $model" 2>/dev/null; then
            success "$model installed"
        else
            warning "Failed to install $model (may already be installed or unavailable)"
        fi
        echo ""
    done
    
    success "Done! Run 'aido --list' to see available models"
}

list_installable_models() {
    echo -e "${CYAN}Recommended models to install:${NC}"
    echo ""
    echo "  llama3.2:latest     General purpose (recommended)"
    echo "  codellama:latest    Code generation"
    echo "  mistral:latest      Fast/lightweight"
    echo ""
    echo "Browse more: https://ollama.com/search?q=cloud"
    echo ""
    echo "Usage:"
    echo "  aido models install                    # Install recommended"
    echo "  aido models install llama3.2:latest   # Install specific"
}

# Provider endpoints
OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://localhost:11434}"
DMR_ENDPOINT="${DMR_ENDPOINT:-http://localhost:12434}"
OPENCODE_ZEN_ENDPOINT="${OPENCODE_ZEN_ENDPOINT:-https://opencode.ai/zen}"
GEMINI_ENDPOINT="${GEMINI_ENDPOINT:-https://generativelanguage.googleapis.com/v1beta}"
CLOUD_ENDPOINT="${CLOUD_ENDPOINT:-https://api.openai.com}"

# OpenCode Zen models (free models first)
OPENCODE_ZEN_MODELS='["big-pickle", "minimax-m2.5-free", "kimi-k2.5-free", "gpt-5-nano", "gpt-5.2-codex", "gpt-5.2", "claude-sonnet-4-5", "claude-opus-4-6", "gemini-3-pro", "gemini-3-flash", "glm-5", "kimi-k2.5", "qwen3-coder"]'

# ==================== PROVIDER DETECTION ====================

detect_providers() {
    local providers_json="{}"
    local config
    config=$(cat "$DATA_DIR/config.json" 2>/dev/null || echo '{}')
    
    # Detect Ollama
    if curl -f -s --connect-timeout 2 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
        local ollama_models
        ollama_models=$(curl -s "$OLLAMA_ENDPOINT/api/tags" | jq '[.models[].name]' 2>/dev/null || echo "[]")
        providers_json=$(echo "$providers_json" | jq \
            --argjson models "$ollama_models" \
            '. + {"ollama": {"enabled": true, "priority": 1, "endpoint": "'"$OLLAMA_ENDPOINT"'", "models": $models, "status": "running", "keys": []}}')
    else
        providers_json=$(echo "$providers_json" | jq \
            '. + {"ollama": {"enabled": false, "priority": 1, "endpoint": "'"$OLLAMA_ENDPOINT"'", "models": [], "status": "not running", "keys": []}}')
    fi
    
    # Detect Docker Model Runner
    if curl -f -s --connect-timeout 2 "$DMR_ENDPOINT/models" >/dev/null 2>&1; then
        local dmr_models
        dmr_models=$(curl -s "$DMR_ENDPOINT/models" 2>/dev/null | jq '[.data[].id]' 2>/dev/null || echo "[]")
        providers_json=$(echo "$providers_json" | jq \
            --argjson models "$dmr_models" \
            '. + {"docker-model-runner": {"enabled": true, "priority": 2, "endpoint": "'"$DMR_ENDPOINT"'", "models": $models, "status": "running", "keys": []}}')
    else
        providers_json=$(echo "$providers_json" | jq \
            '. + {"docker-model-runner": {"enabled": false, "priority": 2, "endpoint": "'"$DMR_ENDPOINT"'", "models": [], "status": "not running", "keys": []}}')
    fi
    
    # Detect OpenCode Zen (cloud provider with keys)
    local zen_enabled
    zen_enabled=$(echo "$config" | jq -r '.providers."opencode-zen".enabled // true')
    local zen_keys
    zen_keys=$(echo "$config" | jq -r '.providers."opencode-zen".keys // []')
    local zen_key_count
    zen_key_count=$(echo "$zen_keys" | jq 'length')
    
    if [ "$zen_enabled" = "true" ] && [ "$zen_key_count" -gt 0 ]; then
        providers_json=$(echo "$providers_json" | jq \
            --argjson models "$OPENCODE_ZEN_MODELS" \
            --argjson keys "$zen_keys" \
            '. + {"opencode-zen": {"enabled": true, "priority": 1, "endpoint": "'"$OPENCODE_ZEN_ENDPOINT"'", "models": $models, "status": "running", "keys": $keys}}')
    else
        providers_json=$(echo "$providers_json" | jq \
            '. + {"opencode-zen": {"enabled": false, "priority": 1, "endpoint": "'"$OPENCODE_ZEN_ENDPOINT"'", "models": [], "status": "no keys", "keys": []}}')
    fi
    
    # Detect Gemini (cloud provider with keys)
    local gemini_enabled
    gemini_enabled=$(echo "$config" | jq -r '.providers.gemini.enabled // true')
    local gemini_keys
    gemini_keys=$(echo "$config" | jq -r '.providers.gemini.keys // []')
    local gemini_key_count
    gemini_key_count=$(echo "$gemini_keys" | jq 'length')
    
    if [ "$gemini_enabled" = "true" ] && [ "$gemini_key_count" -gt 0 ]; then
        local gemini_models='["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"]'
        providers_json=$(echo "$providers_json" | jq \
            --argjson models "$gemini_models" \
            --argjson keys "$gemini_keys" \
            '. + {"gemini": {"enabled": true, "priority": 1, "endpoint": "'"$GEMINI_ENDPOINT"'", "models": $models, "status": "running", "keys": $keys}}')
    else
        providers_json=$(echo "$providers_json" | jq \
            '. + {"gemini": {"enabled": false, "priority": 1, "endpoint": "'"$GEMINI_ENDPOINT"'", "models": [], "status": "no keys", "keys": []}}')
    fi
    
    # Cloud (OpenAI) - disabled by default
    providers_json=$(echo "$providers_json" | jq \
        '. + {"cloud": {"enabled": false, "priority": 3, "endpoint": "'"$CLOUD_ENDPOINT"'", "models": [], "status": "disabled", "keys": []}}')
    
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
    "ollama": {
      "enabled": true,
      "endpoint": "http://localhost:11434",
      "keys": []
    },
    "docker-model-runner": {
      "enabled": true,
      "endpoint": "http://localhost:12434",
      "keys": []
    },
    "opencode-zen": {
      "enabled": true,
      "endpoint": "https://api.opencode.ai",
      "keys": []
    },
    "gemini": {
      "enabled": true,
      "endpoint": "https://generativelanguage.googleapis.com",
      "keys": []
    },
    "cloud": {
      "enabled": false,
      "endpoint": "https://api.openai.com",
      "keys": []
    }
  },
  "selection": {"default_mode": "cloud_first"},
  "ui": {"debug_mode": false}
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
    
    # Get actual script directory (resolve symlinks)
    local actual_dir
    actual_dir=$(dirname "$source_file")
    
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
    
    # Copy proxy to DATA_DIR for portability (always)
    if [ -d "$actual_dir/proxy" ]; then
        mkdir -p "$DATA_DIR/proxy"
        cp -r "$actual_dir/proxy/"* "$DATA_DIR/proxy/" 2>/dev/null || true
        success "Installed proxy to $DATA_DIR/proxy"
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

# ==================== OPENCODE INTEGRATION ====================

generate_opencode_config() {
    local output_file="${1:-opencode.jsonc}"
    local proxy_port="${2:-11999}"
    
    cat > "$output_file" << EOF
{
  // AIDO - OpenCode Configuration
  // Run "aido proxy start" before using OpenCode
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "aido": {
      "name": "AIDO",
      "options": {
        "baseURL": "http://localhost:${proxy_port}",
        "apiKey": "dummy" // Not required for local proxy
      }
    }
  },
  "model": "aido"
}
EOF
    
    echo -e "${GREEN}Generated: $output_file${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Start the proxy: ./aido.sh serve"
    echo "  2. Move config to OpenCode: mv $output_file ~/.config/opencode/"
    echo "  3. Restart OpenCode"
    echo ""
    echo "Available models will be automatically detected from your configured providers."
}

open_url() {
    local url="$1"
    echo "Opening: $url"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url"
    elif command -v open >/dev/null 2>&1; then
        open "$url"
    else
        echo "Please visit: $url"
    fi
}

show_auth_providers() {
    echo -e "${CYAN}AIDO Auth Providers${NC}"
    echo "====================="
    echo ""
    printf "  %-12s %-20s %s\n" "zen" "OpenCode Zen" "https://opencode.ai/auth"
    printf "  %-12s %-20s %s\n" "gemini" "Google Gemini" "https://aistudio.google.com/app/apikey"
    printf "  %-12s %-20s %s\n" "openai" "OpenAI" "https://platform.openai.com/settings/organization/api-keys"
    echo ""
    echo "Usage: aido auth <provider>"
}

normalize_provider_name() {
    local provider="$1"
    case "$provider" in
        zen) echo "opencode-zen" ;;
        ollama) echo "ollama" ;;
        dmr|docker-model-runner) echo "docker-model-runner" ;;
        openai|cloud) echo "cloud" ;;
        opencode-zen|gemini) echo "$provider" ;;
        *) echo "$provider" ;;
    esac
}

handle_key_command() {
    local action="${2:-list}"
    local provider="${3:-}"
    local key="${4:-}"
    local key_name="${5:-}"
    
    init_data_dir
    load_config
    
    case "$action" in
        list)
            show_keys
            ;;
        add)
            if [ -z "$provider" ] || [ -z "$key" ]; then
                echo "Usage: aido key add <provider> <key> [name]"
                echo ""
                echo "Providers: ollama, docker-model-runner, opencode-zen, gemini, cloud"
                exit 1
            fi
            add_key "$provider" "$key" "$key_name"
            ;;
        delete)
            if [ -z "$provider" ] || [ -z "$key" ]; then
                echo "Usage: aido key delete <provider> <index>"
                echo ""
                show_keys
                exit 1
            fi
            delete_key "$provider" "$key"
            ;;
        delete-all)
            if [ -z "$provider" ]; then
                echo "Usage: aido key delete-all <provider>"
                exit 1
            fi
            delete_all_keys "$provider"
            ;;
        test)
            if [ -z "$provider" ]; then
                echo "Usage: aido key test <provider>"
                exit 1
            fi
            test_keys "$provider"
            ;;
        *)
            echo "Usage: aido key [list|add|delete|delete-all|test]"
            exit 1
            ;;
    esac
}

show_keys() {
    echo -e "${CYAN}API Keys${NC}"
    echo "========"
    echo ""
    
    local config
    config=$(cat "$DATA_DIR/config.json")
    
    local providers
    providers=$(echo "$config" | jq -r '.providers | keys[]')
    
    for prov in $providers; do
        # Skip deprecated provider names
        if [ "$prov" = "zen" ]; then
            continue
        fi
        
        local keys
        keys=$(echo "$config" | jq -r ".providers.\"$prov\".keys // []")
        local key_count
        key_count=$(echo "$keys" | jq 'length')
        
        printf "${GREEN}%s${NC}: " "$prov"
        if [ "$key_count" -eq 0 ]; then
            echo "no keys"
        else
            echo "$key_count key(s)"
            local idx=0
            for key_entry in $(echo "$keys" | jq -r '.[] | @base64'); do
                local key_obj
                key_obj=$(echo "$key_entry" | base64 -d)
                local key_value
                key_value=$(echo "$key_obj" | jq -r '.key')
                local key_name
                key_name=$(echo "$key_obj" | jq -r '.name // "default"')
                local masked
                masked="**${key_value: -4}"
                printf "  [%d] %s (%s)\n" "$idx" "$masked" "$key_name"
                idx=$((idx + 1))
            done
        fi
        echo ""
    done
}

add_key() {
    local provider="$1"
    local key="$2"
    local name="${3:-default}"
    
    provider=$(normalize_provider_name "$provider")
    
    local config
    config=$(cat "$DATA_DIR/config.json")
    
    local existing_keys
    existing_keys=$(echo "$config" | jq ".providers.\"$provider\".keys // []")
    
    local new_key
    new_key=$(jq -n --arg key "$key" --arg name "$name" '{key: $key, name: $name}')
    
    local updated_keys
    updated_keys=$(echo "$existing_keys" | jq ". + [$new_key]")
    
    config=$(echo "$config" | jq ".providers.\"$provider\".keys = $updated_keys")
    
    echo "$config" > "$DATA_DIR/config.json"
    
    echo -e "${GREEN}Added key for $provider${NC}"
}

delete_key() {
    local provider="$1"
    local index="$2"
    
    provider=$(normalize_provider_name "$provider")
    
    local config
    config=$(cat "$DATA_DIR/config.json")
    
    local keys
    keys=$(echo "$config" | jq ".providers.\"$provider\".keys // []")
    local count
    count=$(echo "$keys" | jq 'length')
    
    if [ "$index" -ge "$count" ]; then
        echo -e "${RED}Invalid index $index (provider has $count keys)${NC}"
        exit 1
    fi
    
    local updated_keys
    updated_keys=$(echo "$keys" | jq "del(.[$index])")
    
    config=$(echo "$config" | jq ".providers.\"$provider\".keys = $updated_keys")
    
    echo "$config" > "$DATA_DIR/config.json"
    
    echo -e "${GREEN}Deleted key $index from $provider${NC}"
}

delete_all_keys() {
    local provider="$1"
    
    local config
    config=$(cat "$DATA_DIR/config.json")
    
    config=$(echo "$config" | jq ".providers.\"$provider\".keys = []")
    
    echo "$config" > "$DATA_DIR/config.json"
    
    echo -e "${GREEN}Deleted all keys from $provider${NC}"
}

test_keys() {
    local provider="$1"
    
    provider=$(normalize_provider_name "$provider")
    
    echo -e "${CYAN}Testing keys for $provider...${NC}"
    echo ""
    
    local config
    config=$(cat "$DATA_DIR/config.json")
    
    local keys
    keys=$(echo "$config" | jq -r ".providers.\"$provider\".keys // []")
    local count
    count=$(echo "$keys" | jq 'length')
    
    if [ "$count" -eq 0 ]; then
        echo -e "${RED}No keys configured for $provider${NC}"
        exit 1
    fi
    
    local idx=0
    for key_entry in $(echo "$keys" | jq -r '.[] | @base64'); do
        local key_obj
        key_obj=$(echo "$key_entry" | base64 -d)
        local key_value
        key_value=$(echo "$key_obj" | jq -r '.key')
        local key_name
        key_name=$(echo "$key_obj" | jq -r '.name // "default"')
        
        printf "[%d] Testing %s... " "$idx" "$key_name"
        
        local result
        result=$(test_provider_key "$provider" "$key_value")
        
        if [ "$result" = "ok" ]; then
            echo -e "${GREEN}OK${NC}"
        else
            echo -e "${RED}FAILED: $result${NC}"
        fi
        
        idx=$((idx + 1))
    done
}

test_provider_key() {
    local provider="$1"
    local key="$2"
    local result
    
    case "$provider" in
        opencode-zen)
            result=$(curl -s -w "\n%{http_code}" -o /tmp/key_test_$$ \
                -H "Authorization: Bearer $key" \
                "$OPENCODE_ZEN_ENDPOINT/v1/models" 2>/dev/null)
            # Check for error codes in response
            if echo "$result" | grep -q "401\|403"; then
                echo "Auth failed (401/403) - check key"
            elif echo "$result" | grep -q "429"; then
                echo "Rate limited (429) - try later"
            elif echo "$result" | grep -q "500\|502\|503"; then
                echo "Server error - try later"
            elif echo "$result" | grep -q "200"; then
                echo "ok"
            else
                # Check response body for error
                if grep -q "error" /tmp/key_test_$$ 2>/dev/null; then
                    cat /tmp/key_test_$$ | jq -r '.error.message' 2>/dev/null || echo "Error"
                else
                    echo "ok"
                fi
            fi
            rm -f /tmp/key_test_$$
            ;;
        gemini)
            result=$(curl -s -w "%{http_code}" -o /dev/null \
                "https://generativelanguage.googleapis.com/v1/models?key=$key" 2>/dev/null)
            if [ "$result" = "200" ]; then
                echo "ok"
            elif echo "$result" | grep -q "401\|403"; then
                echo "Auth failed - check key"
            elif echo "$result" | grep -q "429"; then
                echo "Rate limited"
            else
                echo "Error ($result)"
            fi
            ;;
        cloud)
            result=$(curl -s -w "%{http_code}" -o /dev/null \
                -H "Authorization: Bearer $key" \
                "https://api.openai.com/v1/models" 2>/dev/null)
            if [ "$result" = "200" ]; then
                echo "ok"
            elif echo "$result" | grep -q "401\|403"; then
                echo "Auth failed - check key"
            elif echo "$result" | grep -q "429"; then
                echo "Rate limited"
            else
                echo "Error ($result)"
            fi
            ;;
        *)
            echo "unsupported"
            ;;
    esac
}

get_first_provider_key() {
    local provider="$1"
    local config
    config=$(cat "$DATA_DIR/config.json")
    
    local keys
    keys=$(echo "$config" | jq -r ".providers.\"$provider\".keys // []")
    
    local first_key
    first_key=$(echo "$keys" | jq -r '.[0].key' 2>/dev/null)
    
    if [ -z "$first_key" ] || [ "$first_key" = "null" ]; then
        echo ""
        return 1
    fi
    
    echo "$first_key"
}

run_init() {
    echo -e "${CYAN}AIDO Init${NC}"
    echo "========="
    echo ""
    
    init_data_dir
    load_config
    
    echo -e "${CYAN}Checking providers...${NC}"
    echo ""
    
    local config
    config=$(cat "$DATA_DIR/config.json")
    
    local providers
    providers=$(echo "$config" | jq -r '.providers | keys[]')
    
    for prov in $providers; do
        local enabled
        enabled=$(echo "$config" | jq -r ".providers.\"$prov\".enabled")
        local endpoint
        endpoint=$(echo "$config" | jq -r ".providers.\"$prov\".endpoint")
        local keys
        keys=$(echo "$config" | jq -r ".providers.\"$prov\".keys // []")
        local key_count
        key_count=$(echo "$keys" | jq 'length')
        
        printf "%-24s " "$prov:"
        
        if [ "$enabled" != "true" ]; then
            echo -e "${YELLOW}Disabled${NC}"
            continue
        fi
        
        case "$prov" in
            ollama|docker-model-runner)
                if curl -f -s --connect-timeout 2 "$endpoint/api/tags" >/dev/null 2>&1; then
                    echo -e "${GREEN}Running${NC}"
                else
                    echo -e "${RED}Not running${NC}"
                fi
                ;;
            opencode-zen|gemini|cloud)
                if [ "$key_count" -gt 0 ]; then
                    # Test the first key
                    local first_key
                    first_key=$(echo "$keys" | jq -r '.[0].key')
                    local test_result
                    test_result=$(test_provider_key "$prov" "$first_key" 2>/dev/null)
                    
                    if [ "$test_result" = "ok" ]; then
                        echo -e "${GREEN}Ready ($key_count key(s))${NC}"
                    else
                        echo -e "${YELLOW}Key issue: $test_result${NC}"
                    fi
                else
                    echo -e "${YELLOW}No keys - run 'aido auth $prov'${NC}"
                fi
                ;;
            *)
                echo -e "${YELLOW}Unknown${NC}"
                ;;
        esac
    done
    
    echo ""
    echo "Use 'aido status' for detailed info"
    echo "Use 'aido key add <provider> <key>' to add API keys"
    echo "Use 'aido auth <provider>' to open auth page"
}

handle_pull_command() {
    local model="${2:-}"
    
    if [ -z "$model" ]; then
        echo "Usage: aido pull [model]"
        echo ""
        echo "Download models from providers"
        echo ""
        echo "Examples:"
        echo "  aido pull llama3.2:latest    # Download from Ollama"
        echo "  aido pull --all             # Download all recommended models"
        exit 1
    fi
    
    if [ "$model" = "--all" ]; then
        install_recommended_models
        exit $?
    fi
    
    install_model "$model"
}

handle_run_command() {
    local query="$*"
    local continue_session=false
    local session_id=""
    
    for arg in "$@"; do
        case "$arg" in
            -c|--continue)
                continue_session=true
                ;;
            -s|--session)
                session_id="$arg"
                ;;
        esac
    done
    
    if [ "$continue_session" = true ] || [ -n "$session_id" ]; then
        echo "Session continue not yet implemented"
    fi
    
    if [ -z "$query" ]; then
        INTERACTIVE_MODE=true
    else
        QUERY="$query"
    fi
}

handle_session_command() {
    local action="${2:-list}"
    local session_name="${3:-}"
    
    init_data_dir
    
    case "$action" in
        list)
            list_sessions
            ;;
        new)
            if [ -z "$session_name" ]; then
                echo "Usage: aido session new <name>"
                exit 1
            fi
            create_session "$session_name"
            ;;
        delete)
            if [ -z "$session_name" ]; then
                echo "Usage: aido session delete <name>"
                exit 1
            fi
            delete_session "$session_name"
            ;;
        *)
            echo "Usage: aido session [list|new|delete]"
            exit 1
            ;;
    esac
}

auth_zen() {
    open_url "https://opencode.ai/auth"
}

connect_opencode() {
    local config_dir="${HOME}/.config/opencode"
    local config_file="$config_dir/opencode.jsonc"
    
    echo -e "${CYAN}Connecting to OpenCode...${NC}"
    echo ""
    
    # Create config directory if needed
    if [ ! -d "$config_dir" ]; then
        mkdir -p "$config_dir"
    fi
    
    # Generate aido provider config as jq-parseable single line
    local aido_config
    aido_config='{"aido":{"name":"AIDO","options":{"baseURL":"http://localhost:11999","apiKey":"dummy"}}}'
    
    # Merge with existing config or create new
    if [ -f "$config_file" ]; then
        echo "Updating existing OpenCode config..."
        
        # Read existing config and merge
        local existing_config
        existing_config=$(cat "$config_file")
        
        # Use jq to merge (add aido provider to existing providers)
        local merged
        merged=$(echo "$existing_config" | jq --argjson aido "$aido_config" '
            if has("provider") then
                .provider += $aido
            else
                . + {provider: $aido}
            end
        ')
        
        echo "$merged" > "$config_file"
    else
        echo "Creating new OpenCode config..."
        cat > "$config_file" << EOF
{
  "provider": $aido_config,
  "model": "auto"
}
EOF
    fi
    
    echo -e "${GREEN}OpenCode configured successfully!${NC}"
    echo ""
    echo "Config written to: $config_file"
    echo ""
    echo "To use AIDO in OpenCode:"
    echo "  1. Restart OpenCode"
    echo "  2. Run 'aido serve' to start the proxy"
    echo ""
    echo "To add Zen API keys to AIDO (so AIDO can use Zen models):"
    echo "  aido auth zen"
    echo ""
    echo "Then add the key with:"
    echo "  aido key add opencode-zen <your-api-key>"
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
            all_models=$(jq -n --argjson current "$all_models" --argjson new "$ollama_models" \
                '$current + ($new | map({"name": ., "provider": "ollama"}))' 2>/dev/null || echo "$all_models")
        fi
    fi
    
    # DMR models
    local dmr_status
    dmr_status=$(echo "$providers" | jq -r '.["docker-model-runner"].status')
    if [ "$dmr_status" = "running" ]; then
        local dmr_models
        dmr_models=$(echo "$providers" | jq '.["docker-model-runner"].models')
        if [ "$dmr_models" != "null" ] && [ -n "$dmr_models" ]; then
            all_models=$(jq -n --argjson current "$all_models" --argjson new "$dmr_models" \
                '$current + ($new | map({"name": ., "provider": "docker-model-runner"}))' 2>/dev/null || echo "$all_models")
        fi
    fi
    
    # OpenCode Zen models (cloud - has keys)
    local zen_status
    zen_status=$(echo "$providers" | jq -r '.["opencode-zen"].status')
    if [ "$zen_status" = "running" ]; then
        local zen_models
        zen_models=$(echo "$providers" | jq '.["opencode-zen"].models')
        if [ "$zen_models" != "null" ] && [ -n "$zen_models" ]; then
            all_models=$(jq -n --argjson current "$all_models" --argjson new "$zen_models" \
                '$current + ($new | map({"name": ., "provider": "opencode-zen"}))' 2>/dev/null || echo "$all_models")
        fi
    fi
    
    # Gemini models (cloud - has keys)
    local gemini_status
    gemini_status=$(echo "$providers" | jq -r '.gemini.status')
    if [ "$gemini_status" = "running" ]; then
        local gemini_models
        gemini_models=$(echo "$providers" | jq '.gemini.models')
        if [ "$gemini_models" != "null" ] && [ -n "$gemini_models" ]; then
            all_models=$(jq -n --argjson current "$all_models" --argjson new "$gemini_models" \
                '$current + ($new | map({"name": ., "provider": "gemini"}))' 2>/dev/null || echo "$all_models")
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
        echo ""
        info "To install models, run:"
        echo "  aido models install              # Install recommended models"
        echo "  aido models install <model>     # Install specific model"
        echo ""
        info "Or browse available models at:"
        echo "  https://ollama.com/search?q=cloud"
        echo ""
        return 1
    fi
    
    # Get preference from config
    local preference
    preference=$(echo "$CONFIG_JSON" | jq -r '.selection.default_mode // "cloud_first"')
    log "Model preference: $preference"
    
    # Separate cloud and local models
    local cloud_models
    local local_models
    
    cloud_models=$(echo "$all_models" | jq '[.[] | select(.provider == "opencode-zen" or .provider == "gemini" or .provider == "cloud")]')
    local_models=$(echo "$all_models" | jq '[.[] | select(.provider == "ollama" or .provider == "docker-model-runner")]')
    
    # Select based on preference
    local selected
    local selected_provider
    
    if [ "$preference" = "cloud_first" ]; then
        if [ "$(echo "$cloud_models" | jq 'length')" -gt 0 ]; then
            selected=$(echo "$cloud_models" | jq -r '.[0].name')
            selected_provider=$(echo "$cloud_models" | jq -r '.[0].provider')
            log "Selected (cloud): $selected (provider: $selected_provider)"
        elif [ "$(echo "$local_models" | jq 'length')" -gt 0 ]; then
            selected=$(echo "$local_models" | jq -r '.[0].name')
            selected_provider=$(echo "$local_models" | jq -r '.[0].provider')
            log "Selected (local fallback): $selected (provider: $selected_provider)"
        else
            selected=$(echo "$all_models" | jq -r '.[0].name')
            selected_provider=$(echo "$all_models" | jq -r '.[0].provider')
            log "Selected: $selected (provider: $selected_provider)"
        fi
    elif [ "$preference" = "local_first" ]; then
        if [ "$(echo "$local_models" | jq 'length')" -gt 0 ]; then
            selected=$(echo "$local_models" | jq -r '.[0].name')
            selected_provider=$(echo "$local_models" | jq -r '.[0].provider')
            log "Selected (local): $selected (provider: $selected_provider)"
        elif [ "$(echo "$cloud_models" | jq 'length')" -gt 0 ]; then
            selected=$(echo "$cloud_models" | jq -r '.[0].name')
            selected_provider=$(echo "$cloud_models" | jq -r '.[0].provider')
            log "Selected (cloud fallback): $selected (provider: $selected_provider)"
        else
            selected=$(echo "$all_models" | jq -r '.[0].name')
            selected_provider=$(echo "$all_models" | jq -r '.[0].provider')
            log "Selected: $selected (provider: $selected_provider)"
        fi
    else
        # "auto" - use cloud if available, else local
        if [ "$(echo "$cloud_models" | jq 'length')" -gt 0 ]; then
            selected=$(echo "$cloud_models" | jq -r '.[0].name')
            selected_provider=$(echo "$cloud_models" | jq -r '.[0].provider')
            log "Selected (auto - cloud): $selected (provider: $selected_provider)"
        else
            selected=$(echo "$local_models" | jq -r '.[0].name')
            selected_provider=$(echo "$local_models" | jq -r '.[0].provider')
            log "Selected (auto - local): $selected (provider: $selected_provider)"
        fi
    fi
    
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
    
    # Always get provider from model (model selection already respects preference)
    local provider
    provider=$(get_provider_for_model "$model")
    
    local endpoint
    case "$provider" in
        docker-model-runner) endpoint="$DMR_ENDPOINT" ;;
        opencode-zen) endpoint="$OPENCODE_ZEN_ENDPOINT" ;;
        gemini) endpoint="$GEMINI_ENDPOINT" ;;
        cloud) endpoint="$CLOUD_ENDPOINT" ;;
        *) endpoint="$OLLAMA_ENDPOINT" ;;
    esac
    
    local agent_name
    agent_name=$(echo "$model" | cut -d':' -f1 | sed 's/-cloud//')
    
    info "Using: $model (provider: $provider)"
    
    local response
    local api_key
    
    case "$provider" in
        docker-model-runner)
            # DMR uses OpenAI-compatible API
            response=$(curl -s -X POST "$endpoint/chat/completions" \
                -H "Content-Type: application/json" \
                -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"$query\"}], \"stream\": false}" | \
                jq -r '.choices[0].message.content' 2>/dev/null) || true
            ;;
        opencode-zen)
            # OpenCode Zen API
            api_key=$(get_first_provider_key "opencode-zen")
            response=$(curl -s -X POST "$endpoint/v1/chat/completions" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $api_key" \
                -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"$query\"}], \"stream\": false}" | \
                jq -r '.choices[0].message.content' 2>/dev/null) || true
            ;;
        gemini)
            # Gemini API
            api_key=$(get_first_provider_key "gemini")
            response=$(curl -s -X POST "$endpoint/models/$model:generateContent" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $api_key" \
                -d "{\"contents\": [{\"parts\": [{\"text\": \"$query\"}]}]}" | \
                jq -r '.candidates[0].content.parts[0].text' 2>/dev/null) || true
            ;;
        cloud)
            # OpenAI API
            api_key=$(get_first_provider_key "cloud")
            response=$(curl -s -X POST "$endpoint/v1/chat/completions" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $api_key" \
                -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"$query\"}], \"stream\": false}" | \
                jq -r '.choices[0].message.content' 2>/dev/null) || true
            ;;
        *)
            # Ollama API
            response=$(curl -s -X POST "$endpoint/api/generate" \
                -d "{\"model\": \"$model\", \"prompt\": \"$query\", \"stream\": false}" | \
                jq -r '.response' 2>/dev/null) || true
            ;;
    esac
    
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

# ==================== PROXY COMMANDS ====================

proxy_start() {
    local port="${1:-11999}"
    echo "Starting AIDO Proxy on port $port..."
    
    # Check DATA_DIR first, then SCRIPT_DIR
    local proxy_dir="$DATA_DIR/proxy"
    if [ ! -d "$proxy_dir" ]; then
        proxy_dir="$SCRIPT_DIR/proxy"
    fi
    
    python3 "$proxy_dir/server.py" start --port "$port"
}

proxy_stop() {
    # Check DATA_DIR first, then SCRIPT_DIR
    local proxy_dir="$DATA_DIR/proxy"
    if [ ! -d "$proxy_dir" ]; then
        proxy_dir="$SCRIPT_DIR/proxy"
    fi
    
    python3 "$proxy_dir/server.py" stop
}

proxy_status() {
    # Check DATA_DIR first, then SCRIPT_DIR
    local proxy_dir="$DATA_DIR/proxy"
    if [ ! -d "$proxy_dir" ]; then
        proxy_dir="$SCRIPT_DIR/proxy"
    fi
    
    python3 "$proxy_dir/server.py" status
}

# ==================== CLI PARSING ====================

is_known_command() {
    local cmd="$1"
    case "$cmd" in
        serve|stop|status|list|providers|run|pull|session|init|connect|auth|key)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

show_unknown_command() {
    local cmd="$1"
    echo -e "${RED}Error: Unknown command: $cmd${NC}"
    echo ""
    echo "Did you mean:"
    echo "  aido serve        # Start proxy server"
    echo "  aido run <query> # Run a query"
    echo ""
    echo "Use 'aido --help' to see available commands"
    exit 1
}

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --debug|-d) DEBUG_MODE=true; shift ;;
            --install) INSTALL_MODE=true; shift ;;
            --uninstall) UNINSTALL_MODE=true; shift ;;
            --version|-v)
                echo "AIDO version 1.0.0"
                exit 0
                ;;
            --config) SHOW_CONFIG=true; shift ;;
            --help|-h) show_help; exit 0 ;;
            *)
                show_unknown_command "$1"
                ;;
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
    echo "  --version, -v           Show version"
    echo "  --config                 Show config"
    echo ""
    echo "Commands:"
    echo "  aido serve [port]        Start proxy server"
    echo "  aido stop                Stop proxy server"
    echo "  aido status              Show status"
    echo "  aido list                List models"
    echo "  aido providers           List providers"
    echo "  aido run [query]         Run query or interactive mode"
    echo "  aido pull [model]        Download model"
    echo "  aido session [cmd]       Manage sessions"
    echo ""
    echo "Configuration:"
    echo "  aido init                Initialize and check providers"
    echo "  aido connect opencode    Configure OpenCode to use AIDO provider"
    echo "  aido auth [provider]     Open auth page (zen|gemini|openai)"
    echo "  aido key [cmd]           Manage API keys"
    echo ""
    echo "Examples:"
    echo "  aido run 'Hello'             # Query"
    echo "  aido serve                   # Start proxy"
    echo "  aido connect opencode        # Configure OpenCode"
    echo "  aido auth zen                # Open OpenCode Zen auth"
    echo "  aido key add gemini <key>    # Add Gemini key"
    echo "  aido key list                # List all keys"
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
    # Initialize all option flags
    DEBUG_MODE=false
    INSTALL_MODE=false
    UNINSTALL_MODE=false
    SHOW_CONFIG=false
    LIST_PROVIDERS=false
    SHOW_STATUS=false
    LIST_MODELS=false
    LIST_SESSIONS=false
    INTERACTIVE_MODE=false
    RUN_MODE=false
    DELETE_SESSION=""
    LOAD_SESSION=""
    NEW_SESSION=""
    QUERY=""
    
    # Handle proxy commands first (before any other args)
    for i in "$@"; do
        case "$i" in
            proxy|proxy\ *)
                PROXY_MODE="start"
                ;;
        esac
    done
    
    # Check for connect subcommand
    if [ "$1" = "connect" ]; then
        local connect_target="${2:-}"
        
        case "$connect_target" in
            opencode|zen|"")
                connect_opencode
                exit $?
                ;;
            *)
                echo "Usage: aido connect [opencode]"
                echo ""
                echo "  opencode  Configure OpenCode to use AIDO provider"
                exit 1
                ;;
        esac
    fi
    
    # Check for auth subcommand
    if [ "$1" = "auth" ]; then
        auth_provider="${2:-}"
        
        case "$auth_provider" in
            zen)
                open_url "https://opencode.ai/auth"
                exit $?
                ;;
            gemini)
                open_url "https://aistudio.google.com/app/apikey"
                exit $?
                ;;
            openai)
                open_url "https://platform.openai.com/settings/organization/api-keys"
                exit $?
                ;;
            "")
                show_auth_providers
                exit $?
                ;;
            *)
                echo "Usage: aido auth <provider>"
                echo ""
                show_auth_providers
                exit 1
                ;;
        esac
    fi
    
    # Check for key subcommand
    if [ "$1" = "key" ]; then
        handle_key_command "$@"
        exit $?
    fi
    
    # Check for init subcommand
    if [ "$1" = "init" ]; then
        run_init "$@"
        exit $?
    fi
    
    # Check for serve subcommand
    if [ "$1" = "serve" ]; then
        local port="${2:-11999}"
        proxy_start "$port"
        exit $?
    fi
    
    # Check for stop subcommand
    if [ "$1" = "stop" ]; then
        proxy_stop
        exit $?
    fi
    
    # Check for status subcommand (standalone)
    if [ "$1" = "status" ]; then
        if [ -z "${2:-}" ]; then
            show_status
            exit $?
        fi
    fi
    
    # Check for list subcommand
    if [ "$1" = "list" ]; then
        get_all_available_models | jq -r '.[] | "  \(.name) [\(.provider)]"'
        exit $?
    fi
    
    # Check for providers subcommand
    if [ "$1" = "providers" ]; then
        show_providers
        exit $?
    fi
    
    # Check for pull subcommand
    if [ "$1" = "pull" ]; then
        handle_pull_command "$@"
        exit $?
    fi
    
    RUN_MODE=false

    # Check for run subcommand
    if [ "$1" = "run" ]; then
        RUN_MODE=true
        shift
        handle_run_command "$@"
    fi

    # Check for session subcommand
    if [[ $# -gt 0 ]] && [ "$1" = "session" ]; then
        handle_session_command "$@"
        exit $?
    fi
    
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

    if [ "$RUN_MODE" = false ]; then
        parse_arguments "$@"
    fi
    
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
