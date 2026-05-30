# @luxfi/brand-rules

Per-org brand sovereignty banlists for **LP-0010 / HIP-0303 / ZIP-0031 / PIP-0006 / LIP-0006** enforcement. One source of truth, consumed by:

- The reusable CI workflow at `hanzoai/.github/.github/workflows/brand-sovereignty.yml`
- The local pre-push validator (`brand-check` CLI shipped with this package)
- Any future tooling that needs the canonical banlist per org

## Why

Each org's repos must never advertise the brand identity of a sibling org or downstream tenant. Cross-org **tooling** references (Go module imports, npm packages, container image refs) are legitimate; cross-org **brand** strings are not. This package codifies the line between the two for each org.

## Install

```sh
pnpm add -D @luxfi/brand-rules   # or: npm i -D, bun add -D
```

## Use — programmatic

```js
import { rulesFor, SUPPORTED_ORGS } from '@luxfi/brand-rules'

console.log(SUPPORTED_ORGS) // ['lux', 'hanzo', 'zoo', 'pars', 'liquidity']

const lux = rulesFor('lux')
console.log(lux.forbidden_in_source) // ['Liquidity.io', 'Liquidity LLC', ...]
console.log(lux.exempt_paths)        // ['**/go.mod', '**/go.sum', ...]
console.log(lux.exempt_patterns)     // ['github\\.com/luxfi/', ...]
```

## Use — CLI

```sh
# inside any git repo
npx brand-check lux             # diff merge-base..HEAD vs lux rules
npx brand-check hanzo all       # full-tree scan vs hanzo rules
npx brand-check liquidity main  # diff main..HEAD vs liquidity rules
```

Exit codes: `0` clean, `1` violations, `2` usage / config error.

## Use — CI workflow (consumer side)

In any repo's `.github/workflows/brand-sovereignty.yml`:

```yaml
name: Brand Sovereignty
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm i -g @luxfi/brand-rules@^0.1.0
      - run: brand-check <org>   # one of: lux hanzo zoo pars liquidity
```

## Rule file shape

```yaml
org: <org-id>
forbidden_in_source:
  - "<literal substring>"      # banned anywhere in source
  - ...
exempt_paths:
  - "**/<glob>"                 # files where forbidden strings are OK
  - ...
exempt_patterns:
  - '<regex>'                   # if a hit line also matches, ignore
  - ...
```

See [`rules/`](./rules/) for the per-org files.

## Specs

- **LP-0010** — Lux brand discovery + sovereignty (canonical)
- **HIP-0303** — Hanzo brand discovery (pointer to LP-0010)
- **ZIP-0031** — Zoo brand discovery + academic-collab exception (pointer to LP-0010)
- **PIP-0006** — Pars brand discovery (pointer to LP-0010)
- **LIP-0006** — Liquidity brand discovery (pointer to LP-0010 §7)

## Per-org notes

| Org       | Bans                                                      | Tightest rule         |
|-----------|-----------------------------------------------------------|-----------------------|
| lux       | Liquidity, Hanzo, Zoo, Pars brand strings                  | "Liquidity.io" string |
| hanzo     | Lux, Zoo, Pars, Liquidity brand strings                    | symmetric to lux      |
| zoo       | Lux, Hanzo, Pars, Liquidity. Plus academic-collab exempt.  | model_card*, *.bib    |
| pars      | Lux, Hanzo, Zoo, Liquidity brand strings                   | symmetric to lux      |
| liquidity | **Everything upstream**: Lux/luxfi, Hanzo, Zoo, Pars       | regulatory isolation  |

Liquidity is the broadest because it has US-jurisdiction regulatory isolation requirements per LP-0010 §7 and LIP-0006. Tooling imports survive via `exempt_patterns`.

## License

BSD-3-Clause. See [`LICENSE`](./LICENSE).
