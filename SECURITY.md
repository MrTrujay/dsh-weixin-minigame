# Security

## Reporting a vulnerability

Report it privately through this repository's
[Security Advisories](https://github.com/MrTrujay/dsh-weixin-minigame/security/advisories/new)
rather than in a public issue. Please include the dsh version, the Node.js
version, and what an attacker would gain.

## What this plugin exposes

- **A loopback-only HTTP route**, `GET /minigame/status`, registered on the dsh
  Web server. It reports whether a preview server is running and the local
  address it listens on. Callers whose peer address is not loopback receive
  `403`. There is no other authentication, and nothing here writes user data.
- **A third-party MCP server**, `@weadmin/weixin-minigame-helper-mcp`, fetched
  by `npx` at boot and pinned to an exact version in `cordis.patch.yml`. It runs
  with the same privileges as dsh and receives WeChat upload credentials from
  its own configuration, not from this plugin. Vulnerabilities in that package
  belong upstream; report them there, and report a pin here that should change.

## Credentials

This plugin never reads, stores, or forwards WeChat credentials. Uploading a
version requires a WeChat AppID and an upload private key, which the official
helper service resolves on its own.
