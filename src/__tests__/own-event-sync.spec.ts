import { ApplicationDataKey, ExtendedKind } from '@/constants'
import { createOwnSignedEventFilter, ingestOwnSignedEvent } from '@/lib/own-event-sync'
import { Event, kinds } from 'nostr-tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addEventToCache: vi.fn(),
  updateRelayListCache: vi.fn(),
  updateFollowListCache: vi.fn(),
  updateBlossomServerListEventCache: vi.fn(),
  updateEncryptionKeyAnnouncementCache: vi.fn(),
  updateEmojiSetCache: vi.fn(),
  subscribe: vi.fn(),
  putReplaceableEvent: vi.fn(),
  getReplaceableEvent: vi.fn(),
  updateStuffStatsByEvents: vi.fn()
}))

vi.mock('@/services/client.service', () => ({
  default: {
    addEventToCache: mocks.addEventToCache,
    updateRelayListCache: mocks.updateRelayListCache,
    updateFollowListCache: mocks.updateFollowListCache,
    updateBlossomServerListEventCache: mocks.updateBlossomServerListEventCache,
    updateEncryptionKeyAnnouncementCache: mocks.updateEncryptionKeyAnnouncementCache,
    updateEmojiSetCache: mocks.updateEmojiSetCache,
    subscribe: mocks.subscribe
  }
}))

vi.mock('@/services/indexed-db.service', () => ({
  default: {
    putReplaceableEvent: mocks.putReplaceableEvent,
    getReplaceableEvent: mocks.getReplaceableEvent
  }
}))

vi.mock('@/services/stuff-stats.service', () => ({
  default: {
    updateStuffStatsByEvents: mocks.updateStuffStatsByEvents
  }
}))

const ACCOUNT = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: overrides.id ?? '1'.repeat(64),
    pubkey: overrides.pubkey ?? ACCOUNT,
    created_at: overrides.created_at ?? 1_700_000_000,
    kind: overrides.kind ?? kinds.Contacts,
    tags: overrides.tags ?? [['p', OTHER]],
    content: overrides.content ?? '',
    sig: overrides.sig ?? 'c'.repeat(128)
  }
}

describe('createOwnSignedEventFilter', () => {
  it('subscribes to every kind authored by the user', () => {
    const filter = createOwnSignedEventFilter(ACCOUNT, 1_700_000_100)

    expect(filter).toEqual({ authors: [ACCOUNT], since: 1_700_000_100 })
    expect(filter).not.toHaveProperty('kinds')
  })
})

describe('ingestOwnSignedEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.putReplaceableEvent.mockImplementation(async (event: Event) => event)
    mocks.getReplaceableEvent.mockResolvedValue(undefined)
    mocks.updateRelayListCache.mockImplementation(async (event: Event) => event)
  })

  it('ignores events signed by a different pubkey', async () => {
    const event = makeEvent({ pubkey: OTHER, kind: kinds.Contacts })

    await expect(ingestOwnSignedEvent(event, ACCOUNT)).resolves.toBeNull()
    expect(mocks.addEventToCache).not.toHaveBeenCalled()
    expect(mocks.putReplaceableEvent).not.toHaveBeenCalled()
  })

  it('applies a newer follow list and refreshes the follow cache', async () => {
    const event = makeEvent({
      kind: kinds.Contacts,
      tags: [
        ['p', OTHER],
        ['p', 'd'.repeat(64)]
      ]
    })

    await expect(ingestOwnSignedEvent(event, ACCOUNT)).resolves.toEqual({
      followListEvent: event
    })
    expect(mocks.addEventToCache).toHaveBeenCalledWith(event)
    expect(mocks.putReplaceableEvent).toHaveBeenCalledWith(event)
    expect(mocks.updateFollowListCache).toHaveBeenCalledWith(event)
  })

  it('ignores a follow list event that is already the stored version', async () => {
    const event = makeEvent({ kind: kinds.Contacts })
    mocks.getReplaceableEvent.mockResolvedValueOnce(event)

    await expect(ingestOwnSignedEvent(event, ACCOUNT)).resolves.toBeNull()
    expect(mocks.putReplaceableEvent).not.toHaveBeenCalled()
    expect(mocks.updateFollowListCache).not.toHaveBeenCalled()
  })

  it('does not move replaceable state backwards when a stale contacts event arrives', async () => {
    const incoming = makeEvent({ id: '2'.repeat(64), kind: kinds.Contacts, created_at: 10 })
    const stored = makeEvent({ id: '3'.repeat(64), kind: kinds.Contacts, created_at: 20 })
    mocks.putReplaceableEvent.mockResolvedValueOnce(stored)

    await expect(ingestOwnSignedEvent(incoming, ACCOUNT)).resolves.toBeNull()
    expect(mocks.updateFollowListCache).not.toHaveBeenCalled()
  })

  it('updates mute, bookmark, and profile lists from newer replaceable events', async () => {
    const mute = makeEvent({ id: '4'.repeat(64), kind: kinds.Mutelist })
    const bookmark = makeEvent({ id: '5'.repeat(64), kind: kinds.BookmarkList })
    const profile = makeEvent({ id: '6'.repeat(64), kind: kinds.Metadata, content: '{}' })

    await expect(ingestOwnSignedEvent(mute, ACCOUNT)).resolves.toEqual({ muteListEvent: mute })
    await expect(ingestOwnSignedEvent(bookmark, ACCOUNT)).resolves.toEqual({
      bookmarkListEvent: bookmark
    })
    await expect(ingestOwnSignedEvent(profile, ACCOUNT)).resolves.toEqual({
      profileEvent: profile
    })
  })

  it('syncs notification seen-at application data without requiring a dedicated store', async () => {
    const event = makeEvent({
      id: '7'.repeat(64),
      kind: kinds.Application,
      created_at: 1_700_000_555,
      tags: [['d', ApplicationDataKey.NOTIFICATIONS_SEEN_AT]]
    })

    await expect(ingestOwnSignedEvent(event, ACCOUNT)).resolves.toEqual({
      notificationsSeenAt: 1_700_000_555
    })
    expect(mocks.putReplaceableEvent).not.toHaveBeenCalled()
  })

  it('ignores unrelated application data', async () => {
    const event = makeEvent({
      kind: kinds.Application,
      tags: [['d', 'something_else']]
    })

    await expect(ingestOwnSignedEvent(event, ACCOUNT)).resolves.toBeNull()
  })

  it('collects deletion targets from e and a tags', async () => {
    const event = makeEvent({
      kind: kinds.EventDeletion,
      tags: [
        ['e', 'note-id'],
        ['a', '30023:pubkey:article'],
        ['k', '1']
      ]
    })

    await expect(ingestOwnSignedEvent(event, ACCOUNT)).resolves.toEqual({
      deletedEventKeys: ['note-id', '30023:pubkey:article']
    })
  })

  it('feeds reactions and reposts into stuff stats', async () => {
    const reaction = makeEvent({ kind: kinds.Reaction, tags: [['e', 'note-id']] })

    await expect(ingestOwnSignedEvent(reaction, ACCOUNT)).resolves.toBeNull()
    expect(mocks.updateStuffStatsByEvents).toHaveBeenCalledWith([reaction])
  })

  it('applies a newer relay list and refreshes the relay-list cache', async () => {
    const event = makeEvent({
      id: '8'.repeat(64),
      kind: kinds.RelayList,
      tags: [['r', 'wss://relay.example.com/', 'write']]
    })

    await expect(ingestOwnSignedEvent(event, ACCOUNT)).resolves.toEqual({
      relayListEvent: event
    })
    expect(mocks.updateRelayListCache).toHaveBeenCalledWith(event)
  })

  it('caches blossom and emoji-set replaceable events without a UI patch', async () => {
    const blossom = makeEvent({ kind: ExtendedKind.BLOSSOM_SERVER_LIST })
    const emojiSet = makeEvent({ kind: kinds.Emojisets, tags: [['d', 'pack']] })

    await expect(ingestOwnSignedEvent(blossom, ACCOUNT)).resolves.toBeNull()
    await expect(ingestOwnSignedEvent(emojiSet, ACCOUNT)).resolves.toBeNull()
    expect(mocks.updateBlossomServerListEventCache).toHaveBeenCalledWith(blossom)
    expect(mocks.updateEmojiSetCache).toHaveBeenCalledWith(emojiSet)
  })
})
