import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { Event } from 'nostr-tools'
import { TFeedSubRequest } from '@/types'

export const FEED_SNAPSHOT_VERSION = 1
export const FEED_SNAPSHOT_MAX_EVENTS = 80
export const FEED_SNAPSHOT_KEY_PREFIX = 'jumble:feed-snapshot:v1:'

export type TFeedSnapshot = {
  version: typeof FEED_SNAPSHOT_VERSION
  events: Event[]
  newEvents: Event[]
  savedAt: number
}

export type TFeedSnapshotStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const memoryStorage = new Map<string, string>()

export function createFeedSnapshotKey({
  subRequests,
  showKinds,
  variant
}: {
  subRequests: TFeedSubRequest[]
  showKinds?: number[]
  variant?: string
}): string {
  const normalized = {
    subRequests: subRequests.map(({ urls, filter }) => ({
      urls: [...urls].sort(),
      filter
    })),
    showKinds: showKinds ? [...showKinds].sort((a, b) => a - b) : undefined,
    variant
  }
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(normalized))))
}

export function sinceFromFeedEvents(newEvents: Event[], events: Event[]): number | undefined {
  if (newEvents.length) return newEvents[0].created_at + 1
  if (events.length) return events[0].created_at + 1
  return undefined
}

export function serializeFeedSnapshot(snapshot: {
  events: Event[]
  newEvents: Event[]
  savedAt?: number
}): TFeedSnapshot {
  return {
    version: FEED_SNAPSHOT_VERSION,
    events: snapshot.events.filter(isStoredNostrEvent).slice(0, FEED_SNAPSHOT_MAX_EVENTS),
    newEvents: snapshot.newEvents.filter(isStoredNostrEvent).slice(0, FEED_SNAPSHOT_MAX_EVENTS),
    savedAt: snapshot.savedAt ?? Date.now()
  }
}

export function parseFeedSnapshot(raw: string | null | undefined): TFeedSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TFeedSnapshot>
    if (parsed.version !== FEED_SNAPSHOT_VERSION) return null
    if (!Array.isArray(parsed.events) || !Array.isArray(parsed.newEvents)) return null
    const events = parsed.events.filter(isStoredNostrEvent)
    const newEvents = parsed.newEvents.filter(isStoredNostrEvent)
    if (!events.length && !newEvents.length) return null
    return {
      version: FEED_SNAPSHOT_VERSION,
      events,
      newEvents,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0
    }
  } catch {
    return null
  }
}

export function getFeedSnapshotStorage(): TFeedSnapshotStorage {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage
  } catch {
    // Private mode and some embedded webviews throw on sessionStorage access.
  }
  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value)
    },
    removeItem: (key) => {
      memoryStorage.delete(key)
    }
  }
}

export function loadFeedSnapshot(
  key: string,
  storage: TFeedSnapshotStorage = getFeedSnapshotStorage()
): TFeedSnapshot | null {
  try {
    return parseFeedSnapshot(storage.getItem(snapshotStorageKey(key)))
  } catch {
    return null
  }
}

export function saveFeedSnapshot(
  key: string,
  snapshot: { events: Event[]; newEvents: Event[] },
  storage: TFeedSnapshotStorage = getFeedSnapshotStorage()
): TFeedSnapshot | null {
  if (!snapshot.events.length && !snapshot.newEvents.length) return null
  const serialized = serializeFeedSnapshot(snapshot)
  const value = JSON.stringify(serialized)
  try {
    storage.setItem(snapshotStorageKey(key), value)
    return serialized
  } catch {
    try {
      const reduced = serializeFeedSnapshot({
        events: snapshot.events.slice(0, 20),
        newEvents: snapshot.newEvents.slice(0, 10)
      })
      storage.setItem(snapshotStorageKey(key), JSON.stringify(reduced))
      return reduced
    } catch {
      return null
    }
  }
}

export function clearFeedSnapshot(
  key: string,
  storage: TFeedSnapshotStorage = getFeedSnapshotStorage()
): void {
  try {
    storage.removeItem(snapshotStorageKey(key))
  } catch {
    // Best-effort; a missing snapshot just means a cold subscribe.
  }
}

function snapshotStorageKey(key: string) {
  return `${FEED_SNAPSHOT_KEY_PREFIX}${key}`
}

function isStoredNostrEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false
  const event = value as Event
  return (
    typeof event.id === 'string' &&
    typeof event.pubkey === 'string' &&
    typeof event.created_at === 'number' &&
    typeof event.kind === 'number' &&
    typeof event.content === 'string' &&
    Array.isArray(event.tags) &&
    typeof event.sig === 'string'
  )
}
