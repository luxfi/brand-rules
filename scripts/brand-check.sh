#!/usr/bin/env bash
# brand-check.sh — local validator for brand sovereignty rules.
#
# Mirrors hanzoai/.github's brand-sovereignty.yml reusable workflow exactly,
# so a passing local run guarantees a passing CI run.
#
# Usage:
#
#   brand-check.sh <org> [<base-ref>]
#
#     <org>      one of: lux, hanzo, zoo, pars, liquidity
#     <base-ref> optional. Defaults to the merge-base with origin/main,
#                falling back to HEAD~ if no remote. Pass "all" to scan
#                the whole working tree (equivalent to `git ls-files`).
#
# Exit code: 0 = clean, 1 = violations, 2 = usage / config error.
#
# Looks up the rule file in this order:
#   1. $BRAND_RULES_DIR/<org>.yml                         (env override)
#   2. ./.github/brand-sovereignty.yml                    (vendored in-repo)
#   3. <package install dir>/rules/<org>.yml              (this package)
#   4. /tmp/brand-sovereignty/rules/<org>.yml             (legacy fallback)
#
# Requires: bash, python3, pyyaml (auto-installs into a tmp venv if
# missing — no system-level mutation).

set -euo pipefail

ORG="${1:-}"
BASE_REF="${2:-}"

if [ -z "${ORG}" ]; then
    echo "usage: brand-check.sh <org> [<base-ref>]" >&2
    echo "       <org> one of: lux hanzo zoo pars liquidity" >&2
    exit 2
fi

# Resolve repo root (must be inside a git tree).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${REPO_ROOT}" ]; then
    echo "brand-check: not in a git working tree" >&2
    exit 2
fi
cd "${REPO_ROOT}"

# Resolve this script's own dir so we can find ../rules/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_RULES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)/rules"

# Resolve rule file in priority order.
RULES_FILE=""
if [ -n "${BRAND_RULES_DIR:-}" ] && [ -f "${BRAND_RULES_DIR}/${ORG}.yml" ]; then
    RULES_FILE="${BRAND_RULES_DIR}/${ORG}.yml"
elif [ -f ".github/brand-sovereignty.yml" ]; then
    RULES_FILE=".github/brand-sovereignty.yml"
elif [ -f "${PKG_RULES_DIR}/${ORG}.yml" ]; then
    RULES_FILE="${PKG_RULES_DIR}/${ORG}.yml"
elif [ -f "/tmp/brand-sovereignty/rules/${ORG}.yml" ]; then
    RULES_FILE="/tmp/brand-sovereignty/rules/${ORG}.yml"
else
    echo "brand-check: no rule file found for org=${ORG}" >&2
    echo "  searched: \${BRAND_RULES_DIR}/${ORG}.yml, ./.github/brand-sovereignty.yml, ${PKG_RULES_DIR}/${ORG}.yml, /tmp/brand-sovereignty/rules/${ORG}.yml" >&2
    exit 2
fi
echo "brand-check: rules = ${RULES_FILE}"

# Build the file list.
CHANGED_FILE="$(mktemp -t brand-check.XXXXXX)"
trap 'rm -f "${CHANGED_FILE}"' EXIT

if [ "${BASE_REF}" = "all" ]; then
    git ls-files > "${CHANGED_FILE}"
    echo "brand-check: scanning full tree ($(wc -l < "${CHANGED_FILE}" | tr -d ' ') files)"
else
    if [ -z "${BASE_REF}" ]; then
        if git remote get-url origin >/dev/null 2>&1; then
            git fetch --no-tags --quiet --depth=64 origin main 2>/dev/null || true
            BASE_REF="$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~ 2>/dev/null || echo HEAD)"
        else
            BASE_REF="$(git rev-parse HEAD~ 2>/dev/null || echo HEAD)"
        fi
    fi
    if [ "${BASE_REF}" = "HEAD" ]; then
        git ls-files > "${CHANGED_FILE}"
        echo "brand-check: no diff target available; scanning full tree ($(wc -l < "${CHANGED_FILE}" | tr -d ' ') files)"
    else
        git diff --name-only --diff-filter=ACMR "${BASE_REF}"...HEAD > "${CHANGED_FILE}"
        echo "brand-check: diff ${BASE_REF}...HEAD ($(wc -l < "${CHANGED_FILE}" | tr -d ' ') files)"
    fi
fi

# Ensure pyyaml is importable. If not, drop into a one-shot venv.
PYTHON="python3"
if ! "${PYTHON}" -c "import yaml" 2>/dev/null; then
    VENV_DIR="$(mktemp -d -t brand-check-venv.XXXXXX)"
    "${PYTHON}" -m venv "${VENV_DIR}"
    # shellcheck disable=SC1091
    . "${VENV_DIR}/bin/activate"
    pip install --quiet 'pyyaml>=6'
    PYTHON="${VENV_DIR}/bin/python"
    # Clean it up when we exit.
    trap 'rm -f "${CHANGED_FILE}"; rm -rf "${VENV_DIR}"' EXIT
fi

RULES_FILE="${RULES_FILE}" CHANGED_FILE="${CHANGED_FILE}" "${PYTHON}" - <<'PY'
from __future__ import annotations
import fnmatch, os, pathlib, re, sys, yaml

rules_path = pathlib.Path(os.environ["RULES_FILE"])
changed_path = pathlib.Path(os.environ["CHANGED_FILE"])

rules = yaml.safe_load(rules_path.read_text())
org = rules.get("org") or "<unset>"
forbidden = list(rules.get("forbidden_in_source") or [])
exempt_paths = list(rules.get("exempt_paths") or [])
exempt_patterns = [re.compile(p) for p in (rules.get("exempt_patterns") or [])]

if not forbidden:
    print(f"brand-check: no forbidden_in_source declared for org={org}")
    sys.exit(0)

changed = [line.strip() for line in changed_path.read_text().splitlines() if line.strip()]

def is_exempt_path(rel: str) -> bool:
    base = os.path.basename(rel)
    for glob in exempt_paths:
        # Direct match against the full relative path.
        if fnmatch.fnmatch(rel, glob):
            return True
        # `**/foo` style globs must also match root-level files and any-
        # depth files. Python's fnmatch treats `**` as a single segment,
        # so strip it and re-test the full path and the basename.
        if glob.startswith("**/"):
            tail = glob[3:]
            if fnmatch.fnmatch(rel, tail) or fnmatch.fnmatch(base, tail):
                return True
    return False

forbidden_re = re.compile("|".join(re.escape(s) for s in forbidden))

violations: list[tuple[str, int, str, str]] = []
for rel in changed:
    if is_exempt_path(rel):
        continue
    p = pathlib.Path(rel)
    if not p.is_file():
        continue
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    for n, line in enumerate(text.splitlines(), 1):
        m = forbidden_re.search(line)
        if not m:
            continue
        if any(pat.search(line) for pat in exempt_patterns):
            continue
        violations.append((rel, n, m.group(0), line.strip()))

if not violations:
    print(f"brand-check: OK for org={org} ({len(changed)} files scanned, 0 violations)")
    sys.exit(0)

print(f"brand-check: FAILED for org={org} -- {len(violations)} violation(s)")
print()
for path, lineno, hit, line in violations:
    snippet = line if len(line) <= 160 else line[:157] + "..."
    print(f"  {path}:{lineno}: '{hit}'")
    print(f"    > {snippet}")
sys.exit(1)
PY
