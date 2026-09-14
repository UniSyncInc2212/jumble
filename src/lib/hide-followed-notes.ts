import { Event } from 'nostr-tools'

/**
 * Local exclusion of followed authors from a relay-set discovery feed.
 *
 * Nostr REQ filters cannot express "authors NOT IN follow list", so this
 * must run after events arrive. Following / pinned feeds are unchanged —
 * callers should only attach the filter when browsing a relay set.
 */
export function isFollowedAuthorNote(
  event: Pick<Event, 'pubkey'>,
  followingSet: ReadonlySet<string>
): boolean {
  return followingSet.has(event.pubkey)
}

/** NoteList filterFn contract: return true to keep the note. */
export function shouldShowNoteWhenHidingFollowed(
  event: Pick<Event, 'pubkey'>,
  followingSet: ReadonlySet<string>
): boolean {
  return !isFollowedAuthorNote(event, followingSet)
}

export function createHideFollowedFilterFn(
  followingSet: ReadonlySet<string>
): (event: Pick<Event, 'pubkey'>) => boolean {
  return (event) => shouldShowNoteWhenHidingFollowed(event, followingSet)
}
