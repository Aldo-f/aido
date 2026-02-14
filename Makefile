# AIDO Makefile
# Provides: lint, format, test, install-tools targets

SHELL := /bin/bash
PROJECT_DIR := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

.PHONY: help lint format test install-tools check-tools

help:
	@echo "AIDO Development Commands"
	@echo ""
	@echo "  make install-tools  # Install required formatters (shfmt, ruff)"
	@echo "  make lint          # Run linters (shfmt --check, ruff check)"
	@echo "  make format        # Auto-format code (shfmt, ruff format)"
	@echo "  make test          # Run test suite"
	@echo "  make all           # lint + test"
	@echo ""
	@echo "Formatters needed:"
	@echo "  - shfmt (for Bash)"
	@echo "  - ruff (for Python)"

check-tools:
	@echo "Checking required tools..."
	@which shfmt >/dev/null 2>&1 && echo "  shfmt: OK" || echo "  shfmt: MISSING (run: make install-tools or brew install shfmt)"
	@which ruff >/dev/null 2>&1 && echo "  ruff: OK" || echo "  ruff: MISSING (run: make install-tools or pip install ruff)"

install-tools:
	@echo "Installing formatters..."
	@if command -v brew >/dev/null 2>&1; then \
		brew install shfmt; \
	elif command -v apt-get >/dev/null 2>&1; then \
		sudo apt-get install -y shfmt; \
	fi
	@pip install ruff --quiet 2>/dev/null || pip3 install ruff --quiet
	@echo "Formatters installed!"

lint: check-tools
	@echo "Running linters..."
	@echo "  Checking Bash (shfmt)..."
	@shfmt -d $(PROJECT_DIR)/aido.sh 2>/dev/null || (echo "Bash lint failed" && exit 1)
	@echo "  Checking Python (ruff)..."
	@ruff check $(PROJECT_DIR)/proxy/ 2>/dev/null || (echo "Python lint failed" && exit 1)
	@echo "Lint passed!"

format:
	@echo "Formatting code..."
	@echo "  Formatting Bash..."
	@shfmt -w $(PROJECT_DIR)/aido.sh
	@echo "  Formatting Python..."
	@ruff format $(PROJECT_DIR)/proxy/
	@echo "Format complete!"

test:
	@echo "Running tests..."
	@cd $(PROJECT_DIR) && ./tests/aido_test.sh

all: lint test

.DEFAULT_GOAL := help
