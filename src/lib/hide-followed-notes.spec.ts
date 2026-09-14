import { describe, expect, it } from 'vitest'
import {
  createHideFollowedFilterFn,
  isFollowedAuthorNote,
  shouldShowNoteWhenHidingFollowed
} from './hide-followed-notes'

const FOLLOWED = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('hide-followed-notes', () => {
  const followingSet = new Set([FOLLOWED])

  it('treats the event pubkey as the poster (including reposts)', () => {
    expect(isFollowedAuthorNote({ pubkey: FOLLOWED }, followingSet)).toBe(true)
    expect(isFollowedAuthorNote({ pubkey: OTHER }, followingSet)).toBe(false)
  })

  it('keeps every note when the follow list is empty', () => {
    expect(shouldShowNoteWhenHidingFollowed({ pubkey: FOLLOWED }, new Set())).toBe(true)
  })

  it('hides notes from followed pubkeys and keeps everyone else', () => {
    expect(shouldShowNoteWhenHidingFollowed({ pubkey: FOLLOWED }, followingSet)).toBe(false)
    expect(shouldShowNoteWhenHidingFollowed({ pubkey: OTHER }, followingSet)).toBe(true)
  })

  it('exposes a NoteList-compatible filterFn', () => {
    const filterFn = createHideFollowedFilterFn(followingSet)
    expect(filterFn({ pubkey: FOLLOWED })).toBe(false)
    expect(filterFn({ pubkey: OTHER })).toBe(true)
  })
})
