import { ApplicationDataKey, ExtendedKind } from '@/constants'
import { getReplaceableEventIdentifier, isReplaceableEvent } from '@/lib/event'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import stuffStatsService from '@/services/stuff-stats.service'
import dayjs from 'dayjs'
import { Event, Filter, kinds } from 'nostr-tools'

/** Overlap with the login fetch so events published during init are not missed. */
export const OWN_EVENT_SYNC_LOOKBACK_SECONDS = 120

export type TOwnEventSyncPatch = {
  profileEvent?: Event
  relayListEvent?: Event
  followListEvent?: Event
  muteListEvent?: Event
  bookmarkListEvent?: Event
  favoriteRelaysEvent?: Event
  userEmojiListEvent?: Event
  pinListEvent?: Event
  pinnedUsersEvent?: Event
  notificationsSeenAt?: number
  deletedEventKeys?: string[]
}

/**
 * Live filter for every event signed by the logged-in user.
 * Intentionally kind-agnostic: one subscription, handled holistically.
 */
export function createOwnSignedEventFilter(pubkey: string, since: number): Filter {
  return { authors: [pubkey], since }
}

export function subscribeOwnSignedEvents(
  pubkey: string,
  relayUrls: string[],
  onEvent: (event: Event) => void
) {
  return client.subscribe(
    relayUrls,
    createOwnSignedEventFilter(pubkey, dayjs().unix() - OWN_EVENT_SYNC_LOOKBACK_SECONDS),
    { onevent: onEvent }
  )
}

async function storeReplaceableIfNewer(event: Event): Promise<Event | null> {
  const identifier = getReplaceableEventIdentifier(event)
  const existing = await indexedDb.getReplaceableEvent(
    event.pubkey,
    event.kind,
    identifier || undefined
  )
  if (existing?.id === event.id) return null
  const stored = await indexedDb.putReplaceableEvent(event)
  return stored.id === event.id ? stored : null
}

/**
 * Persist a newly seen self-authored event and describe the React-state patch
 * NostrProvider should apply. Older replaceable events are ignored.
 */
export async function ingestOwnSignedEvent(
  event: Event,
  accountPubkey: string
): Promise<TOwnEventSyncPatch | null> {
  if (event.pubkey !== accountPubkey) return null

  client.addEventToCache(event)

  try {
    switch (event.kind) {
      case kinds.Metadata: {
        const stored = await storeReplaceableIfNewer(event)
        return stored ? { profileEvent: stored } : null
      }
      case kinds.RelayList: {
        const stored = await storeReplaceableIfNewer(event)
        if (!stored) return null
        await client.updateRelayListCache(stored)
        return { relayListEvent: stored }
      }
      case kinds.Contacts: {
        const stored = await storeReplaceableIfNewer(event)
        if (!stored) return null
        await client.updateFollowListCache(stored)
        return { followListEvent: stored }
      }
      case kinds.Mutelist: {
        const stored = await storeReplaceableIfNewer(event)
        return stored ? { muteListEvent: stored } : null
      }
      case kinds.BookmarkList: {
        const stored = await storeReplaceableIfNewer(event)
        return stored ? { bookmarkListEvent: stored } : null
      }
      case ExtendedKind.FAVORITE_RELAYS: {
        const stored = await storeReplaceableIfNewer(event)
        return stored ? { favoriteRelaysEvent: stored } : null
      }
      case kinds.UserEmojiList: {
        const stored = await storeReplaceableIfNewer(event)
        return stored ? { userEmojiListEvent: stored } : null
      }
      case kinds.Pinlist: {
        const stored = await storeReplaceableIfNewer(event)
        return stored ? { pinListEvent: stored } : null
      }
      case ExtendedKind.PINNED_USERS: {
        const stored = await storeReplaceableIfNewer(event)
        return stored ? { pinnedUsersEvent: stored } : null
      }
      case ExtendedKind.BLOSSOM_SERVER_LIST: {
        await client.updateBlossomServerListEventCache(event)
        return null
      }
      case ExtendedKind.ENCRYPTION_KEY_ANNOUNCEMENT: {
        await client.updateEncryptionKeyAnnouncementCache(event)
        return null
      }
      case kinds.Emojisets: {
        await client.updateEmojiSetCache(event)
        return null
      }
      case kinds.Application: {
        if (getReplaceableEventIdentifier(event) !== ApplicationDataKey.NOTIFICATIONS_SEEN_AT) {
          return null
        }
        return { notificationsSeenAt: event.created_at }
      }
      case kinds.Reaction:
      case kinds.Repost:
      case kinds.GenericRepost:
      case ExtendedKind.EXTERNAL_CONTENT_REACTION: {
        stuffStatsService.updateStuffStatsByEvents([event])
        return null
      }
      case kinds.EventDeletion: {
        const deletedEventKeys = event.tags
          .filter(([tagName, tagValue]) => (tagName === 'e' || tagName === 'a') && !!tagValue)
          .map(([, tagValue]) => tagValue)
        return deletedEventKeys.length > 0 ? { deletedEventKeys } : null
      }
      default: {
        if (isReplaceableEvent(event.kind)) {
          try {
            await indexedDb.putReplaceableEvent(event)
          } catch {
            // Some replaceable kinds (e.g. application data) have no IndexedDB store.
          }
        }
        return null
      }
    }
  } catch (error) {
    console.error('Failed to ingest own signed event', error)
    return null
  }
}
