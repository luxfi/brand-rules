// @luxfi/brand-rules — programmatic loader for per-org brand sovereignty rules.
//
// One source of truth for the banlists used by:
//   * .github reusable workflow (CI lint)
//   * local validator (./scripts/brand-check.sh or ./src/cli.js)
//   * any future tooling that needs to know what's forbidden per org

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const RULES_DIR = resolve(__dirname, '..', 'rules')

export const SUPPORTED_ORGS = Object.freeze(['lux', 'hanzo', 'zoo', 'pars', 'liquidity'])

/**
 * @typedef {object} BrandRule
 * @property {string} org                  organisation id (e.g. "lux")
 * @property {string[]} forbidden_in_source   literal substrings to ban from source
 * @property {string[]} exempt_paths       fnmatch globs of files where forbidden strings are allowed
 * @property {string[]} exempt_patterns    regex sources; if a hit line also matches one, ignore it
 */

/**
 * Parse and return the rule object for the given org id.
 *
 * @param {string} orgId  one of SUPPORTED_ORGS
 * @returns {BrandRule}
 * @throws {Error} if orgId is unknown or the rule file is missing/invalid
 */
export function rulesFor(orgId) {
  if (typeof orgId !== 'string' || orgId.length === 0) {
    throw new Error('rulesFor: orgId must be a non-empty string')
  }
  if (!SUPPORTED_ORGS.includes(orgId)) {
    throw new Error(`rulesFor: unknown org "${orgId}". Valid: ${SUPPORTED_ORGS.join(', ')}`)
  }
  const path = resolve(RULES_DIR, `${orgId}.yml`)
  const text = readFileSync(path, 'utf8')
  const parsed = yaml.load(text)
  if (parsed == null || typeof parsed !== 'object') {
    throw new Error(`rulesFor: ${path} did not parse to an object`)
  }
  if (parsed.org !== orgId) {
    throw new Error(`rulesFor: ${path} has org="${parsed.org}", expected "${orgId}"`)
  }
  return {
    org: parsed.org,
    forbidden_in_source: Array.isArray(parsed.forbidden_in_source) ? parsed.forbidden_in_source : [],
    exempt_paths: Array.isArray(parsed.exempt_paths) ? parsed.exempt_paths : [],
    exempt_patterns: Array.isArray(parsed.exempt_patterns) ? parsed.exempt_patterns : [],
  }
}

/**
 * Filesystem path to the rule YAML for the given org. Useful when a
 * downstream tool wants to read the raw file (e.g. piping into python).
 *
 * @param {string} orgId
 * @returns {string} absolute path to the .yml file
 */
export function rulePath(orgId) {
  if (!SUPPORTED_ORGS.includes(orgId)) {
    throw new Error(`rulePath: unknown org "${orgId}". Valid: ${SUPPORTED_ORGS.join(', ')}`)
  }
  return resolve(RULES_DIR, `${orgId}.yml`)
}
