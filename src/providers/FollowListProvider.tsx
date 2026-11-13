import { createFollowListDraftEvent } from '@/lib/draft-event'
import { formatError } from '@/lib/error'
import {
  canStorePrivateFollowsInContent,
  filterPTags,
  getFollowTypeFromSets,
  hasPTag
} from '@/lib/follow-list'
import { getPubkeysFromPTags } from '@/lib/tag'
import client from '@/services/client.service'
import dialogService from '@/services/dialog.service'
import indexedDb from '@/services/indexed-db.service'
import { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { useNostr } from './NostrProvider'

type TFollowListContext = {
  followingSet: Set<string>
  changing: boolean
  getFollowPubkeys: () => string[]
  getFollowType: (pubkey: string) => 'public' | 'private' | null
  follow: (pubkey: string) => Promise<void>
  followPublicly: (pubkey: string) => Promise<void>
  followPrivately: (pubkey: string) => Promise<void>
  unfollow: (pubkey: string) => Promise<void>
  switchToPublicFollow: (pubkey: string) => Promise<void>
  switchToPrivateFollow: (pubkey: string) => Promise<void>
  convertAllPublicFollowsToPrivate: () => Promise<number>
}

const FollowListContext = createContext<TFollowListContext | undefined>(undefined)

export const useFollowList = () => {
  const context = useContext(FollowListContext)
  if (!context) {
    throw new Error('useFollowList must be used within a FollowListProvider')
  }
  return context
}

export function FollowListProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const {
    pubkey: accountPubkey,
    followListEvent,
    signEvent,
    updateFollowListEvent,
    nip04Decrypt,
    nip44Encrypt,
    nip44Decrypt
  } = useNostr()
  const currentAccountPubkey = useRef(accountPubkey)
  currentAccountPubkey.current = accountPubkey
  const [tags, setTags] = useState<string[][]>([])
  const [privateTags, setPrivateTags] = useState<string[][]>([])
  const [tagsAccount, setTagsAccount] = useState<string | null>(null)
  const publicFollowingSet = useMemo(
    () => new Set(tagsAccount === accountPubkey ? getPubkeysFromPTags(tags) : []),
    [tags, tagsAccount, accountPubkey]
  )
  const privateFollowingSet = useMemo(
    () => new Set(tagsAccount === accountPubkey ? getPubkeysFromPTags(privateTags) : []),
    [privateTags, tagsAccount, accountPubkey]
  )
  const followingSet = useMemo(() => {
    return new Set([...Array.from(privateFollowingSet), ...Array.from(publicFollowingSet)])
  }, [publicFollowingSet, privateFollowingSet])
  const [changing, setChanging] = useState(false)
  const mutationInFlight = useRef(false)

  const getPrivateTags = useCallback(
    async (event: Event): Promise<{ privateTags: string[][]; wasNip04: boolean }> => {
      if (event.pubkey !== accountPubkey) throw new Error('Account changed')
      if (!event.content || event.content.trim() === '{}' || !canStorePrivateFollowsInContent(event.content)) {
        return { privateTags: [], wasNip04: false }
      }

      try {
        const wasNip04 = event.content.includes('?iv=')
        const storedPlainText = await indexedDb.getDecryptedContent(event.id)

        let plainText: string
        if (storedPlainText) {
          plainText = storedPlainText
        } else {
          plainText = wasNip04
            ? await nip04Decrypt(event.pubkey, event.content)
            : await nip44Decrypt(event.pubkey, event.content)
          await indexedDb.putDecryptedContent(event.id, plainText)
        }

        const parsedPrivateTags = z.array(z.array(z.string())).parse(JSON.parse(plainText))
        return { privateTags: parsedPrivateTags, wasNip04 }
      } catch (error) {
        console.error('Failed to decrypt follow list content', error)
        throw error
      }
    },
    [accountPubkey, nip04Decrypt, nip44Decrypt]
  )

  const publishFollowList = useCallback(
    async (nextTags: string[][], nextPrivateTags: string[][], previousEvent?: Event | null) => {
      if (!accountPubkey) throw new Error('You need to login first')
      if (previousEvent && previousEvent.pubkey !== accountPubkey) throw new Error('Account changed')

      let content = previousEvent?.content ?? ''
      if (canStorePrivateFollowsInContent(previousEvent?.content)) {
        content =
          nextPrivateTags.length > 0
            ? await nip44Encrypt(accountPubkey, JSON.stringify(nextPrivateTags))
            : ''
      } else if (nextPrivateTags.length > 0) {
        throw new Error(
          t(
            'Private follows cannot be stored because this follow list still uses a legacy NIP-02 relay map in its content.'
          )
        )
      }

      if (nextPrivateTags.length > 0 && !content) throw new Error('Private follow encryption failed')
      if (currentAccountPubkey.current !== accountPubkey) throw new Error('Account changed')
      const draft = createFollowListDraftEvent(nextTags, content)
      draft.created_at = Math.max(draft.created_at, (previousEvent?.created_at ?? 0) + 1)
      const signedEvent = await signEvent(draft)
      if (currentAccountPubkey.current !== accountPubkey || signedEvent.pubkey !== accountPubkey) {
        throw new Error('Account changed')
      }
      const relays = await client.determineTargetRelays(signedEvent)
      if (currentAccountPubkey.current !== accountPubkey) throw new Error('Account changed')
      await client.publishEvent(relays, signedEvent)
      const event = signedEvent
      if (currentAccountPubkey.current !== accountPubkey) throw new Error('Account changed')
      await updateFollowListEvent(
        event,
        canStorePrivateFollowsInContent(content) ? nextPrivateTags : []
      )
      return event
    },
    [accountPubkey, nip44Encrypt, signEvent, t, updateFollowListEvent]
  )

  useEffect(() => {
    let cancelled = false
    const updateFollowTags = async () => {
      if (!followListEvent || followListEvent.pubkey !== accountPubkey) {
        setTagsAccount(null)
        setTags([])
        setPrivateTags([])
        return
      }

      const { privateTags: nextPrivateTags } = await getPrivateTags(
        followListEvent
      ).catch(() => ({
        privateTags: [] as string[][],
        wasNip04: false
      }))
      if (cancelled) return
      setTagsAccount(accountPubkey)
      setPrivateTags(nextPrivateTags)
      setTags(followListEvent.tags)

    }
    updateFollowTags()
    return () => {
      cancelled = true
    }
  }, [accountPubkey, followListEvent, getPrivateTags])

  const getFollowPubkeys = () => {
    return Array.from(followingSet)
  }

  const getFollowType = useCallback(
    (pubkey: string): 'public' | 'private' | null => {
      return getFollowTypeFromSets(pubkey, publicFollowingSet, privateFollowingSet)
    },
    [publicFollowingSet, privateFollowingSet]
  )

  const checkFollowListEvent = async (event: Event | null) => {
    if (!event) {
      const result = await dialogService.confirm(t('FollowListNotFoundConfirmation'))
      if (!result) {
        throw new Error('Follow list not found')
      }
    }
  }

  const followPublicly = async (pubkey: string) => {
    if (!accountPubkey || mutationInFlight.current) return

    mutationInFlight.current = true
    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      await checkFollowListEvent(event)
      if (currentAccountPubkey.current !== accountPubkey) return
      if (event && hasPTag(event.tags, pubkey)) {
        return
      }

      const { privateTags: currentPrivateTags } = event
        ? await getPrivateTags(event)
        : { privateTags: [] as string[][] }
      const nextPrivateTags = filterPTags(currentPrivateTags, pubkey)
      await publishFollowList((event?.tags ?? []).concat([['p', pubkey]]), nextPrivateTags, event)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to follow publicly') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      mutationInFlight.current = false
      setChanging(false)
    }
  }

  const followPrivately = async (pubkey: string) => {
    if (!accountPubkey || mutationInFlight.current) return

    mutationInFlight.current = true
    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      await checkFollowListEvent(event)
      if (currentAccountPubkey.current !== accountPubkey) return

      const { privateTags: currentPrivateTags } = event
        ? await getPrivateTags(event)
        : { privateTags: [] as string[][] }
      if (hasPTag(currentPrivateTags, pubkey)) {
        return
      }

      const nextPrivateTags = currentPrivateTags.concat([['p', pubkey]])
      await publishFollowList(event ? filterPTags(event.tags, pubkey) : [], nextPrivateTags, event)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to follow privately') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      mutationInFlight.current = false
      setChanging(false)
    }
  }

  const follow = async (pubkey: string) => {
    await followPublicly(pubkey)
  }

  const unfollow = async (pubkey: string) => {
    if (!accountPubkey || mutationInFlight.current) return

    mutationInFlight.current = true
    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      if (!event) return
      if (currentAccountPubkey.current !== accountPubkey) return

      const { privateTags: currentPrivateTags } = await getPrivateTags(event)
      const nextPrivateTags = filterPTags(currentPrivateTags, pubkey)
      await publishFollowList(filterPTags(event.tags, pubkey), nextPrivateTags, event)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to unfollow') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      mutationInFlight.current = false
      setChanging(false)
    }
  }

  const switchToPublicFollow = async (pubkey: string) => {
    if (!accountPubkey || mutationInFlight.current) return

    mutationInFlight.current = true
    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      if (!event) return
      if (currentAccountPubkey.current !== accountPubkey) return

      const { privateTags: currentPrivateTags } = await getPrivateTags(event)
      const nextPrivateTags = filterPTags(currentPrivateTags, pubkey)
      if (nextPrivateTags.length === currentPrivateTags.length && hasPTag(event.tags, pubkey)) {
        return
      }

      await publishFollowList(
        filterPTags(event.tags, pubkey).concat([
          currentPrivateTags.find(([name, value]) => name === 'p' && value === pubkey) ?? ['p', pubkey]
        ]),
        nextPrivateTags,
        event
      )
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to switch to public follow') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      mutationInFlight.current = false
      setChanging(false)
    }
  }

  const switchToPrivateFollow = async (pubkey: string) => {
    if (!accountPubkey || mutationInFlight.current) return

    mutationInFlight.current = true
    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      if (!event) return
      if (currentAccountPubkey.current !== accountPubkey) return

      const { privateTags: currentPrivateTags } = await getPrivateTags(event)
      const nextPrivateTags = filterPTags(currentPrivateTags, pubkey).concat([
        event.tags.find(([name, value]) => name === 'p' && value === pubkey) ?? ['p', pubkey]
      ])
      await publishFollowList(filterPTags(event.tags, pubkey), nextPrivateTags, event)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to switch to private follow') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      mutationInFlight.current = false
      setChanging(false)
    }
  }

  const convertAllPublicFollowsToPrivate = async () => {
    if (!accountPubkey || mutationInFlight.current) return 0

    mutationInFlight.current = true
    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      if (!event) return 0
      if (currentAccountPubkey.current !== accountPubkey) return 0

      const publicPubkeys = getPubkeysFromPTags(event.tags)
      if (publicPubkeys.length === 0) return 0

      const { privateTags: currentPrivateTags } = await getPrivateTags(event)
      const existingPrivate = new Set(getPubkeysFromPTags(currentPrivateTags))
      const nextPrivateTags = [...currentPrivateTags]
      for (const pubkey of publicPubkeys) {
        if (!existingPrivate.has(pubkey)) {
          nextPrivateTags.push(event.tags.find(([name, value]) => name === 'p' && value === pubkey)!)
          existingPrivate.add(pubkey)
        }
      }

      await publishFollowList(
        event.tags.filter(([tagName]) => tagName !== 'p'),
        nextPrivateTags,
        event
      )
      return publicPubkeys.length
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to convert public follows to private') + ': ' + err, {
          duration: 10_000
        })
      })
      return -1
    } finally {
      mutationInFlight.current = false
      setChanging(false)
    }
  }

  return (
    <FollowListContext.Provider
      value={{
        followingSet,
        changing,
        getFollowPubkeys,
        getFollowType,
        follow,
        followPublicly,
        followPrivately,
        unfollow,
        switchToPublicFollow,
        switchToPrivateFollow,
        convertAllPublicFollowsToPrivate
      }}
    >
      {children}
    </FollowListContext.Provider>
  )
}
