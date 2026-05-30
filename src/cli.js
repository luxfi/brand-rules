#!/usr/bin/env node
// brand-check — local validator for brand sovereignty rules.
//
// Mirrors hanzoai/.github's brand-sovereignty.yml reusable workflow so that
// a passing local run guarantees a passing CI run.
//
// Usage:
//
//   brand-check <org> [<base-ref>]
//
//     <org>      one of: lux, hanzo, zoo, pars, liquidity
//     <base-ref> optional. Defaults to the merge-base with origin/main,
//                falling back to HEAD~. Pass "all" to scan the whole tree.
//
// Exit code: 0 = clean, 1 = violations, 2 = usage / config error.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { rulesFor, SUPPORTED_ORGS } from './index.js'

const ORG = process.argv[2]
const BASE_REF = process.argv[3] ?? ''

if (!ORG || ORG === '-h' || ORG === '--help') {
  process.stderr.write('usage: brand-check <org> [<base-ref>]\n')
  process.stderr.write(`       <org> one of: ${SUPPORTED_ORGS.join(' ')}\n`)
  process.exit(2)
}

if (!SUPPORTED_ORGS.includes(ORG)) {
  process.stderr.write(`brand-check: unknown org "${ORG}". Valid: ${SUPPORTED_ORGS.join(', ')}\n`)
  process.exit(2)
}

// 1. Resolve git repo root.
const topLevel = git(['rev-parse', '--show-toplevel'])
if (topLevel.status !== 0 || !topLevel.stdout.trim()) {
  process.stderr.write('brand-check: not in a git working tree\n')
  process.exit(2)
}
const repoRoot = topLevel.stdout.trim()
process.chdir(repoRoot)

// 2. Load the rule.
let rule
try {
  rule = rulesFor(ORG)
} catch (err) {
  process.stderr.write(`brand-check: failed to load rule for org=${ORG}: ${err.message}\n`)
  process.exit(2)
}
process.stdout.write(`brand-check: rules = @luxfi/brand-rules/rules/${ORG}.yml\n`)

const forbidden = rule.forbidden_in_source
const exemptPaths = rule.exempt_paths
const exemptPatterns = rule.exempt_patterns.map((p) => new RegExp(p))

if (forbidden.length === 0) {
  process.stdout.write(`brand-check: no forbidden_in_source declared for org=${ORG}\n`)
  process.exit(0)
}

// 3. Enumerate files in scope.
const files = enumerateFiles(BASE_REF)
process.stdout.write(`brand-check: ${files.length} file(s) in scope\n`)

// 4. Build the forbidden alternation regex (literal-escape each entry).
const forbiddenRe = new RegExp(forbidden.map(escapeRegExp).join('|'))

// 5. Scan.
const violations = []
for (const rel of files) {
  if (isExemptPath(rel, exemptPaths)) continue
  const abs = resolve(repoRoot, rel)
  let st
  try {
    st = statSync(abs)
  } catch {
    continue
  }
  if (!st.isFile()) continue
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    continue
  }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = forbiddenRe.exec(line)
    if (!m) continue
    if (exemptPatterns.some((pat) => pat.test(line))) continue
    violations.push({ path: rel, line: i + 1, hit: m[0], text: line.trim() })
  }
}

// 6. Report.
if (violations.length === 0) {
  process.stdout.write(`brand-check: OK for org=${ORG} (${files.length} files scanned, 0 violations)\n`)
  process.exit(0)
}

process.stdout.write(`brand-check: FAILED for org=${ORG} -- ${violations.length} violation(s)\n\n`)
for (const v of violations) {
  const snippet = v.text.length <= 160 ? v.text : v.text.slice(0, 157) + '...'
  process.stdout.write(`  ${v.path}:${v.line}: '${v.hit}'\n`)
  process.stdout.write(`    > ${snippet}\n`)
}
process.exit(1)

// ---------------------------------------------------------------------------

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' })
}

function enumerateFiles(baseRef) {
  // "all" or HEAD: scan the whole index.
  if (baseRef === 'all' || baseRef === 'HEAD') {
    return lsFiles()
  }

  let ref = baseRef
  if (!ref) {
    // Default: merge-base with origin/main, falling back to HEAD~.
    if (git(['remote', 'get-url', 'origin']).status === 0) {
      git(['fetch', '--no-tags', '--quiet', '--depth=64', 'origin', 'main'])
      const mb = git(['merge-base', 'HEAD', 'origin/main'])
      if (mb.status === 0 && mb.stdout.trim()) {
        ref = mb.stdout.trim()
      }
    }
    if (!ref) {
      const parent = git(['rev-parse', 'HEAD~'])
      ref = parent.status === 0 && parent.stdout.trim() ? parent.stdout.trim() : 'HEAD'
    }
  }

  if (ref === 'HEAD') {
    return lsFiles()
  }

  const diff = git(['diff', '--name-only', '--diff-filter=ACMR', `${ref}...HEAD`])
  if (diff.status !== 0) {
    process.stderr.write(`brand-check: git diff failed; falling back to ls-files\n`)
    return lsFiles()
  }
  return diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

function lsFiles() {
  const r = git(['ls-files'])
  if (r.status !== 0) {
    process.stderr.write('brand-check: git ls-files failed\n')
    process.exit(2)
  }
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

function isExemptPath(rel, globs) {
  const base = basename(rel)
  for (const g of globs) {
    if (fnmatch(rel, g)) return true
    // **/foo style: match against both full path and basename.
    if (g.startsWith('**/')) {
      const tail = g.slice(3)
      if (fnmatch(rel, tail) || fnmatch(base, tail)) return true
    }
  }
  return false
}

// fnmatch glob: ** = any chars (incl. /), * = any chars except /, ? = one char,
// [...] = char class. Mirrors python's fnmatch.fnmatch (which treats ** as a
// single segment but our recursion through is-exempt-path normalises that).
function fnmatch(path, glob) {
  const re = new RegExp('^' + globToRegex(glob) + '$')
  return re.test(path)
}

function globToRegex(glob) {
  let out = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      // Collapse ** into a single greedy any-char run (matches across path
      // segments — equivalent to python fnmatch's `*` which also matches /).
      if (glob[i + 1] === '*') {
        out += '.*'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (c === '?') {
      out += '.'
      i += 1
    } else if (c === '[') {
      // Char class: copy until matching ].
      let end = glob.indexOf(']', i + 1)
      if (end < 0) {
        out += '\\['
        i += 1
      } else {
        out += glob.slice(i, end + 1)
        i = end + 1
      }
    } else {
      // Escape regex metachars except those handled above.
      if ('\\^$.|+(){}'.includes(c)) {
        out += '\\' + c
      } else {
        out += c
      }
      i += 1
    }
  }
  return out
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
