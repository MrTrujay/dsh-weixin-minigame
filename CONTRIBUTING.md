# Contributing

## Setup

Node `^22.19.0 || >=24.0.0` and pnpm 11.

```sh
pnpm install      # also builds lib/ through the `prepare` script
pnpm run typecheck
pnpm test
pnpm run build    # lib/index.js (node half) and lib/client.js (browser half)
pnpm run watch    # rebuild the browser half while editing
```

## Trying a change against a real dsh

The two halves load at different times. The node half loads only when `dsh web`
boots; the browser half loads on every page load. A change to the node half
therefore needs a restart, while a change to the browser half needs a page
refresh (`pnpm run watch` keeps the bundle current).

Install this checkout into a throwaway profile and boot it:

```sh
dsh plugin --profile scratch add ./            # the checkout directory
dsh web --profile scratch --port 3099
```

`dsh plugin --profile <name> <args...>` forwards to pnpm inside the profile
directory, so `add` also takes a tarball from `pnpm pack` or a package name.
`dsh plugin --profile scratch remove @trujaycc/dsh-weixin-minigame` undoes it.

The plugin's own test suite does not need this. Reach for a real boot when the
change touches slot registration, the stylesheet, or the preview handshake —
the parts jsdom cannot answer for.

## Tests

`pnpm test` covers the node half's skill and route registration, the helper
state-file parsing, and the browser half's rendering, polling, and drag
behavior under jsdom. Tests stay keyless: no WeChat credentials, no real mini
game project, no network access, no WeChat DevTools.

A test that needs one of those is testing the upstream helper, not this plugin.

## Releasing

Tags drive the release. Push one matching the manifest version:

```sh
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/publish.yml` then installs, typechecks, tests, refuses a tag
that disagrees with `package.json`, and publishes with npm provenance. It needs
an `NPM_TOKEN` repository secret and nothing else.

Publish from CI rather than by hand. `npm config get registry` on a development
machine can point at a mirror, and a manual `npm publish` then targets that
mirror instead of the registry users install from. If you must publish locally,
name the registry explicitly:

```sh
npm publish --registry https://registry.npmjs.org --access public
```

## The upstream pin

`cordis.patch.yml` pins `@weadmin/weixin-minigame-helper-mcp` to an exact
version. Do not move it to `@latest`: that would execute whatever upstream had
published, in every user's environment, with no review step here. To bump it,
read the upstream release notes for renamed, removed, or re-typed tools, update
`assets/weixin-minigame-helper.md` if the tool set changed, and run this
package's tests before changing the pin.

## Documentation

`README.md` and `README.zh.md` are one document in two languages. Change both
in the same commit, and keep their headings, tables, and code fences aligned.
