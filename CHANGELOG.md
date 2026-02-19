# Changelog

All notable changes to this project will be documented in this file.

## [1.1.1] - 2026-02-19

### Fixed
- **GitHub Release workflow**: Updated to use ncipollo/release-action for reliable release creation

## [1.1.0] - 2026-02-19

### Added
- **Cross-platform CLI**: Converted from shell script (aido.sh) to Python (aido.py) for Linux, macOS, and Windows support
- **Streaming by default**: CLI now streams responses by default
- **MkDocs documentation**: Converted docs to MkDocs with Material theme
- **Bilingual support**: Full documentation in English and Dutch
- **pipx installation**: Added recommended installation via pipx
- **pip install -e support**: Added editable install for development
- **GitHub Actions CI/CD**: Automated binary builds for all platforms

### Fixed
- **Streaming with key rotation**: Fixed key validation before streaming starts
- **Cloud provider streaming**: Fixed peer closed connection errors with Zen, OpenAI, and Gemini providers
- **Key rotation during streaming**: 401/403/429 errors now properly trigger key rotation
- **Fallback to local**: Falls back to Ollama when cloud keys fail

### Changed
- **DRY architecture**: All API logic centralized in FastAPI proxy server

## [1.0.0] - 2026-02-19

### Added
- Initial release
- Multi-provider support (Ollama, DMR, Zen, Gemini, OpenAI)
- Key rotation with SQLite persistence
- FastAPI proxy server
