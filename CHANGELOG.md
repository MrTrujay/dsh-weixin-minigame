# Changelog

All notable changes to this package are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- The mini game preview now opens in dsh's built-in right-sidebar browser tab
  instead of the plugin's own floating window. The tab opens automatically the
  first time a packaged game is served; the session-header trigger opens or
  reopens it. dsh's browser provides back/forward/reload and the address bar.
- The bundle patch enables the `ui-sidebar-browser` row, which Web profiles
  ship disabled by default. Desktop already has it on, so that override is a
  no-op there.

### Removed

- The floating preview window and its overlay registration, drag/hide/end
  controls, and embedded iframe.

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
