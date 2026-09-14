import { describe, expect, it } from 'vitest'
import {
  canStorePrivateFollowsInContent,
  filterPTags,
  getFollowTypeFromSets,
  hasPTag,
  isNip02RelayMap
} from './follow-list'

describe('isNip02RelayMap', () => {
  it('detects a classic NIP-02 relay map', () => {
    expect(
      isNip02RelayMap(
        JSON.stringify({
          'wss://relay.damus.io': { read: true, write: true },
          'ws://127.0.0.1:4869': { read: true, write: false }
        })
      )
    ).toBe(true)
  })

  it('rejects empty objects, arrays, and encrypted-looking content', () => {
    expect(isNip02RelayMap('')).toBe(false)
    expect(isNip02RelayMap('{}')).toBe(false)
    expect(isNip02RelayMap('[]')).toBe(false)
    expect(isNip02RelayMap('not-json')).toBe(false)
    expect(isNip02RelayMap(JSON.stringify({ hello: 'world' }))).toBe(false)
    expect(isNip02RelayMap(JSON.stringify([['p', 'abc']]))).toBe(false)
  })
})

describe('canStorePrivateFollowsInContent', () => {
  it('allows empty or already-encrypted content', () => {
    expect(canStorePrivateFollowsInContent()).toBe(true)
    expect(canStorePrivateFollowsInContent('')).toBe(true)
    expect(canStorePrivateFollowsInContent('{}')).toBe(true)
    expect(canStorePrivateFollowsInContent('Ayq1encryptedPayload')).toBe(true)
  })

  it('refuses to overwrite a NIP-02 relay map', () => {
    expect(
      canStorePrivateFollowsInContent(
        JSON.stringify({
          'wss://relay.example.com': { read: true, write: true }
        })
      )
    ).toBe(false)
  })
})

describe('p-tag helpers', () => {
  const tags = [
    ['p', 'alice'],
    ['client', 'jumble'],
    ['p', 'bob']
  ]

  it('detects and filters p tags', () => {
    expect(hasPTag(tags, 'alice')).toBe(true)
    expect(hasPTag(tags, 'carol')).toBe(false)
    expect(filterPTags(tags, 'alice')).toEqual([
      ['client', 'jumble'],
      ['p', 'bob']
    ])
  })

  it('prefers public follow type when a pubkey is in both sets', () => {
    expect(getFollowTypeFromSets('alice', new Set(['alice']), new Set(['alice']))).toBe('public')
    expect(getFollowTypeFromSets('bob', new Set(), new Set(['bob']))).toBe('private')
    expect(getFollowTypeFromSets('carol', new Set(), new Set())).toBeNull()
  })
})
