#!/usr/bin/env python3
"""
AIDO Proxy - Transparent proxy for intelligent model selection
OpenAI-compatible API that automatically selects the best model
"""

import os
import sys
import json
import signal
import socket
import threading
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import urllib.request
import urllib.error

# Configuration
DEFAULT_PORT = 11999
DATA_DIR = Path(os.path.expanduser("~/.aido-data"))
CONFIG_FILE = DATA_DIR / "config.json"
PID_FILE = DATA_DIR / "aido-proxy.pid"

# Check both DATA_DIR and SCRIPT_DIR for config
SCRIPT_DIR = Path(__file__).parent.resolve()
if not (DATA_DIR / "config.json").exists():
    # Use SCRIPT_DIR as fallback for config
    DATA_DIR = SCRIPT_DIR.parent

# Provider endpoints
OLLAMA_ENDPOINT = os.environ.get("OLLAMA_ENDPOINT", "http://localhost:11434")
DMR_ENDPOINT = os.environ.get("DMR_ENDPOINT", "http://localhost:12434")


def load_config():
    """Load AIDO configuration"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {
        "providers": {
            "ollama": {"enabled": True, "priority": 1, "endpoint": OLLAMA_ENDPOINT},
            "docker-model-runner": {
                "enabled": True,
                "priority": 2,
                "endpoint": DMR_ENDPOINT,
            },
            "cloud": {
                "enabled": False,
                "priority": 3,
                "endpoint": "https://api.openai.com",
            },
        },
        "proxy": {"enabled": True, "port": DEFAULT_PORT, "default_model": "auto"},
    }


def detect_providers():
    """Detect available providers"""
    config = load_config()
    providers = config.get("providers", {})

    available = {}

    # Check Ollama
    try:
        req = urllib.request.Request(f"{OLLAMA_ENDPOINT}/api/tags")
        with urllib.request.urlopen(req, timeout=2) as resp:
            models = json.load(resp).get("models", [])
            available["ollama"] = {
                "endpoint": OLLAMA_ENDPOINT,
                "models": [m["name"] for m in models],
                "status": "running",
            }
    except:
        available["ollama"] = {
            "status": "not running",
            "models": [],
            "endpoint": OLLAMA_ENDPOINT,
        }

    # Check Docker Model Runner
    try:
        req = urllib.request.Request(f"{DMR_ENDPOINT}/models")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.load(resp)
            models = data.get("data", [])
            available["docker-model-runner"] = {
                "endpoint": DMR_ENDPOINT,
                "models": [m.get("id") for m in models if m.get("id")],
                "status": "running",
            }
    except:
        available["docker-model-runner"] = {
            "status": "not running",
            "models": [],
            "endpoint": DMR_ENDPOINT,
        }

    return available


def analyze_prompt(prompt):
    """Analyze prompt to determine best model"""
    prompt_lower = prompt.lower()

    # Detect capabilities
    capabilities = []

    if any(
        w in prompt_lower
        for w in ["code", "programming", "debug", "fix", "function", "script"]
    ):
        capabilities.append("coding")

    if any(
        w in prompt_lower
        for w in ["image", "picture", "visual", "diagram", "photo", "wat zie"]
    ):
        capabilities.append("vision")

    if any(
        w in prompt_lower for w in ["explain", "analyze", "compare", "think", "reason"]
    ):
        capabilities.append("reasoning")

    if not capabilities:
        capabilities = ["general"]

    return capabilities


def select_model(prompt, provider_hint=None):
    """Select best model for the given prompt"""
    available = detect_providers()

    if not available or all(p.get("status") != "running" for p in available.values()):
        # Fallback to Ollama if available
        try:
            return "llama3.2", "ollama", OLLAMA_ENDPOINT
        except:
            return None, None, None

    # Get first available provider (sorted by priority)
    for name, info in available.items():
        if info.get("status") == "running" and info.get("models"):
            model = info["models"][0]
            return model, name, info["endpoint"]

    return None, None, None


def forward_request(endpoint, path, data, stream=False):
    """Forward request to provider"""
    url = f"{endpoint}{path}"

    headers = {"Content-Type": "application/json"}

    req = urllib.request.Request(
        url, data=data.encode() if data else None, headers=headers, method="POST"
    )

    try:
        if stream:
            return urllib.request.urlopen(req, timeout=300)
        else:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return resp.read().decode()
    except Exception as e:
        return json.dumps({"error": str(e)})


class AIDOProxyHandler(BaseHTTPRequestHandler):
    """HTTP handler for AIDO Proxy"""

    def log_message(self, format, *args):
        """Custom logging"""
        print(f"[AIDO Proxy] {args[0]}")

    def do_GET(self):
        """Handle GET requests"""
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/models" or path == "/v1/models":
            self.send_models_list()
        elif path == "/health":
            self.send_health()
        elif path == "/":
            self.send_welcome()
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        """Handle POST requests"""
        parsed = urlparse(self.path)
        path = parsed.path

        # Read request body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode() if content_length > 0 else ""

        if path == "/chat/completions" or path == "/v1/chat/completions":
            self.handle_chat_completions(body)
        elif path == "/completions" or path == "/v1/completions":
            self.handle_completions(body)
        else:
            self.send_error(404, "Not Found")

    def send_json(self, data, status=200):
        """Send JSON response"""
        response = json.dumps(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response.encode())

    def send_models_list(self):
        """Send available models list"""
        available = detect_providers()

        models = []
        for provider_name, info in available.items():
            if info.get("status") == "running":
                for model_name in info.get("models", []):
                    models.append(
                        {
                            "id": model_name,
                            "object": "model",
                            "created": 0,
                            "owned_by": provider_name,
                        }
                    )

        self.send_json({"object": "list", "data": models})

    def send_health(self):
        """Health check"""
        available = detect_providers()
        running = [k for k, v in available.items() if v.get("status") == "running"]
        self.send_json({"status": "ok", "providers": running})

    def send_welcome(self):
        """Welcome message"""
        self.send_json(
            {
                "name": "AIDO Proxy",
                "version": "1.0.0",
                "description": "Transparent AI model proxy with intelligent selection",
            }
        )

    def handle_chat_completions(self, body):
        """Handle chat completions request"""
        try:
            request_data = json.loads(body) if body else {}
        except:
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        # Get prompt from messages
        messages = request_data.get("messages", [])
        if not messages:
            # Try 'prompt' for non-chat format
            prompt = request_data.get("prompt", "")
        else:
            # Combine all messages into prompt
            prompt = "\n".join(
                [f"{m.get('role', 'user')}: {m.get('content', '')}" for m in messages]
            )

        # Get the user message
        user_message = next(
            (m["content"] for m in messages if m.get("role") == "user"), prompt
        )

        # Select best model
        model, provider, endpoint = select_model(user_message)

        if not model:
            self.send_json({"error": "No models available"}, 503)
            return

        print(f"[AIDO] Selected model: {model} (provider: {provider})")

        # Forward to provider (Ollama format)
        if provider == "ollama":
            # Convert OpenAI format to Ollama format
            ollama_data = {
                "model": model,
                "prompt": user_message,
                "stream": request_data.get("stream", False),
            }

            result = forward_request(endpoint, "/api/generate", json.dumps(ollama_data))

            # Convert back to OpenAI format
            try:
                ollama_result = json.loads(result)
                response = {
                    "id": "chatcmpl-" + os.urandom(8).hex(),
                    "object": "chat.completion",
                    "created": 0,
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": ollama_result.get("response", ""),
                            },
                            "finish_reason": "stop",
                        }
                    ],
                }
                self.send_json(response)
            except:
                self.send_json({"error": result}, 500)
        else:
            # Docker Model Runner - use OpenAI format
            result = forward_request(endpoint, "/v1/chat/completions", body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(result.encode())

    def handle_completions(self, body):
        """Handle completions request"""
        # Similar to chat_completions but for /completions endpoint
        self.handle_chat_completions(body)


def run_server(port=DEFAULT_PORT):
    """Run the proxy server"""
    server = HTTPServer(("0.0.0.0", port), AIDOProxyHandler)
    print(f"[AIDO] Proxy server starting on port {port}")
    print(f"[AIDO] OpenAI-compatible endpoint: http://localhost:{port}/v1")
    print(f"[AIDO] Press Ctrl+C to stop")

    # Save PID
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[AIDO] Shutting down...")
        server.shutdown()
        if PID_FILE.exists():
            PID_FILE.unlink()


def stop_server():
    """Stop the proxy server"""
    if PID_FILE.exists():
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        try:
            os.kill(pid, signal.SIGTERM)
            print("[AIDO] Proxy stopped")
            PID_FILE.unlink()
            return True
        except ProcessLookupError:
            print("[AIDO] Process not found, removing stale PID file")
            PID_FILE.unlink()
            return False
    else:
        print("[AIDO] No PID file found - is the proxy running?")
        return False


def check_status():
    """Check if proxy is running"""
    if PID_FILE.exists():
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        try:
            os.kill(pid, 0)
            print(f"[AIDO] Proxy is running (PID: {pid})")
            return True
        except ProcessLookupError:
            print("[AIDO] Proxy is not running (stale PID)")
            return False
    else:
        print("[AIDO] Proxy is not running")
        return False


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="AIDO Proxy")
    parser.add_argument(
        "command", choices=["start", "stop", "status"], help="Command to run"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to run on (default: {DEFAULT_PORT})",
    )

    args = parser.parse_args()

    if args.command == "start":
        run_server(args.port)
    elif args.command == "stop":
        stop_server()
    elif args.command == "status":
        check_status()


if __name__ == "__main__":
    main()
