import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { describe, it } from 'node:test'
import { rulePath, rulesFor, SUPPORTED_ORGS } from '../src/index.js'

describe('SUPPORTED_ORGS', () => {
  it('lists exactly the 5 orgs', () => {
    assert.deepEqual([...SUPPORTED_ORGS], ['lux', 'hanzo', 'zoo', 'pars', 'liquidity'])
  })
  it('is frozen', () => {
    assert.equal(Object.isFrozen(SUPPORTED_ORGS), true)
  })
})

describe('rulePath', () => {
  for (const org of SUPPORTED_ORGS) {
    it(`returns an existing absolute path for ${org}`, () => {
      const p = rulePath(org)
      assert.ok(p.startsWith('/'), `expected absolute, got ${p}`)
      assert.ok(existsSync(p), `missing file: ${p}`)
    })
  }
  it('throws on unknown org', () => {
    assert.throws(() => rulePath('bogus'), /unknown org/)
  })
})

describe('rulesFor', () => {
  for (const org of SUPPORTED_ORGS) {
    it(`loads rule for ${org} with the right shape`, () => {
      const r = rulesFor(org)
      assert.equal(r.org, org)
      assert.ok(Array.isArray(r.forbidden_in_source))
      assert.ok(r.forbidden_in_source.length > 0, 'forbidden_in_source must be non-empty')
      assert.ok(Array.isArray(r.exempt_paths))
      assert.ok(r.exempt_paths.length > 0, 'exempt_paths must be non-empty')
      assert.ok(Array.isArray(r.exempt_patterns))
      assert.ok(r.exempt_patterns.length > 0, 'exempt_patterns must be non-empty')
    })
  }

  it('throws on empty orgId', () => {
    assert.throws(() => rulesFor(''), /non-empty string/)
  })

  it('throws on unknown org', () => {
    assert.throws(() => rulesFor('mystery'), /unknown org/)
  })

  it('lux bans Liquidity.io and Hanzo AI Inc.', () => {
    const r = rulesFor('lux')
    assert.ok(r.forbidden_in_source.includes('Liquidity.io'))
    assert.ok(r.forbidden_in_source.includes('Hanzo AI Inc.'))
  })

  it('liquidity bans @luxfi/ as brand identity', () => {
    const r = rulesFor('liquidity')
    assert.ok(r.forbidden_in_source.includes('@luxfi/'))
    assert.ok(r.forbidden_in_source.includes('Lux Industries'))
  })

  it('liquidity exempts github.com/luxfi/ tooling refs', () => {
    const r = rulesFor('liquidity')
    assert.ok(r.exempt_patterns.some((p) => /luxfi/.test(p)))
  })

  it('zoo exempts model_card and bib paths (academic-collab)', () => {
    const r = rulesFor('zoo')
    assert.ok(r.exempt_paths.includes('**/model_card*'))
    assert.ok(r.exempt_paths.includes('**/*.bib'))
    assert.ok(r.exempt_paths.includes('**/papers/**'))
  })

  it('exempt_patterns are valid regex', () => {
    for (const org of SUPPORTED_ORGS) {
      const r = rulesFor(org)
      for (const p of r.exempt_patterns) {
        assert.doesNotThrow(() => new RegExp(p), `bad regex in ${org}: ${p}`)
      }
    }
  })
})
