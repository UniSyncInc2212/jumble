import { Event } from 'nostr-tools'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearFeedSnapshot,
  createFeedSnapshotKey,
  FEED_SNAPSHOT_MAX_EVENTS,
  loadFeedSnapshot,
  parseFeedSnapshot,
  saveFeedSnapshot,
  serializeFeedSnapshot,
  sinceFromFeedEvents,
  TFeedSnapshotStorage
} from './feed-snapshot'

describe('createFeedSnapshotKey', () => {
  it('is stable across relay URL order and kind order', () => {
    const left = createFeedSnapshotKey({
      subRequests: [{ urls: ['wss://b.example', 'wss://a.example'], filter: { authors: ['pk'] } }],
      showKinds: [1, 6]
    })
    const right = createFeedSnapshotKey({
      subRequests: [{ urls: ['wss://a.example', 'wss://b.example'], filter: { authors: ['pk'] } }],
      showKinds: [6, 1]
    })
    expect(left).toBe(right)
    expect(left).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the filter or variant changes', () => {
    const base = {
      subRequests: [{ urls: ['wss://relay.example'], filter: { authors: ['pk'] } }],
      showKinds: [1]
    }
    expect(createFeedSnapshotKey(base)).not.toBe(
      createFeedSnapshotKey({ ...base, showKinds: [1, 6] })
    )
    expect(createFeedSnapshotKey(base)).not.toBe(
      createFeedSnapshotKey({ ...base, variant: 'algo' })
    )
  })
})

describe('sinceFromFeedEvents', () => {
  it('prefers pending new notes, then the visible head', () => {
    const older = event({ id: 'older', created_at: 100 })
    const newer = event({ id: 'newer', created_at: 200 })
    expect(sinceFromFeedEvents([newer], [older])).toBe(201)
    expect(sinceFromFeedEvents([], [older])).toBe(101)
    expect(sinceFromFeedEvents([], [])).toBeUndefined()
  })
})

describe('parseFeedSnapshot / serializeFeedSnapshot', () => {
  it('round-trips valid notes and drops malformed ones', () => {
    const note = event({ id: 'ok', created_at: 10 })
    const serialized = serializeFeedSnapshot({
      events: [note, { id: 'bad' } as Event],
      newEvents: [event({ id: 'new', created_at: 11 })]
    })
    expect(serialized.events).toHaveLength(1)
    const parsed = parseFeedSnapshot(
      JSON.stringify({
        ...serialized,
        events: [...serialized.events, { kind: 1 }]
      })
    )
    expect(parsed?.events.map((item) => item.id)).toEqual(['ok'])
    expect(parsed?.newEvents.map((item) => item.id)).toEqual(['new'])
  })

  it('rejects missing, wrong-version, or empty payloads', () => {
    expect(parseFeedSnapshot(null)).toBeNull()
    expect(parseFeedSnapshot('{')).toBeNull()
    expect(parseFeedSnapshot(JSON.stringify({ version: 99, events: [], newEvents: [] }))).toBeNull()
    expect(parseFeedSnapshot(JSON.stringify({ version: 1, events: [], newEvents: [] }))).toBeNull()
  })

  it('caps stored events so a long session cannot blow the quota', () => {
    const events = Array.from({ length: FEED_SNAPSHOT_MAX_EVENTS + 20 }, (_, index) =>
      event({ id: `n${index}`, created_at: index })
    )
    expect(serializeFeedSnapshot({ events, newEvents: [] }).events).toHaveLength(
      FEED_SNAPSHOT_MAX_EVENTS
    )
  })
})

describe('feed snapshot storage', () => {
  const storage = createMemoryStorage()

  afterEach(() => {
    storage.clear()
  })

  it('saves, restores, and clears a feed without losing notes across wake', () => {
    const key = 'following'
    const events = [event({ id: 'a', created_at: 1 }), event({ id: 'b', created_at: 2 })]
    const newEvents = [event({ id: 'c', created_at: 3 })]

    expect(saveFeedSnapshot(key, { events, newEvents }, storage)).not.toBeNull()
    expect(loadFeedSnapshot(key, storage)).toMatchObject({
      events,
      newEvents
    })

    clearFeedSnapshot(key, storage)
    expect(loadFeedSnapshot(key, storage)).toBeNull()
  })

  it('does not persist an empty feed over a previous snapshot', () => {
    const key = 'relays'
    saveFeedSnapshot(
      key,
      { events: [event({ id: 'keep', created_at: 1 })], newEvents: [] },
      storage
    )
    expect(saveFeedSnapshot(key, { events: [], newEvents: [] }, storage)).toBeNull()
    expect(loadFeedSnapshot(key, storage)?.events[0].id).toBe('keep')
  })

  it('retries with a smaller payload when storage is full', () => {
    const full = createMemoryStorage({ failUntil: 1 })
    const events = Array.from({ length: 40 }, (_, index) =>
      event({ id: `n${index}`, created_at: index })
    )
    const saved = saveFeedSnapshot('quota', { events, newEvents: [] }, full)
    expect(saved?.events).toHaveLength(20)
    expect(loadFeedSnapshot('quota', full)?.events).toHaveLength(20)
  })
})

function event(overrides: Partial<Event> & Pick<Event, 'id'>): Event {
  return {
    pubkey: 'pk',
    created_at: 1,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: 'sig',
    ...overrides
  }
}

function createMemoryStorage({
  failUntil = 0
}: { failUntil?: number } = {}): TFeedSnapshotStorage & {
  clear: () => void
} {
  const data = new Map<string, string>()
  let remainingFailures = failUntil
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (remainingFailures > 0) {
        remainingFailures--
        throw new Error('QuotaExceededError')
      }
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
    clear: () => data.clear()
  }
}
