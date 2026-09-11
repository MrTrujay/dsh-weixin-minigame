# Changelog

All notable changes to this package are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.1.0

First release.

### Added

- A `weixin-minigame-helper` skill that routes mini game work through the
  official helper service, including the preview → read logs → fix → preview
  loop, real-device preview, and version upload.
- A floating preview window in the dsh Web GUI embedding the local preview
  server, with refresh, open-in-new-tab, hide, and end-preview controls.
- A session-header trigger carrying the same live preview state as the window
  (running, not running, or plugin not mounted).
- A bundle patch mounting `@deepseek-ai/dsh-mcp-client` against
  `@weadmin/weixin-minigame-helper-mcp`, pinned to an exact upstream version.
