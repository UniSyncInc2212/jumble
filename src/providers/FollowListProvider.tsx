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
import indexedDb from '@/services/indexed-db.service'
import dayjs from 'dayjs'
import { Event } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
    publish,
    updateFollowListEvent,
    nip04Decrypt,
    nip44Encrypt,
    nip44Decrypt
  } = useNostr()
  const [tags, setTags] = useState<string[][]>([])
  const [privateTags, setPrivateTags] = useState<string[][]>([])
  const publicFollowingSet = useMemo(() => new Set(getPubkeysFromPTags(tags)), [tags])
  const privateFollowingSet = useMemo(
    () => new Set(getPubkeysFromPTags(privateTags)),
    [privateTags]
  )
  const followingSet = useMemo(() => {
    return new Set([...Array.from(privateFollowingSet), ...Array.from(publicFollowingSet)])
  }, [publicFollowingSet, privateFollowingSet])
  const [changing, setChanging] = useState(false)

  const getPrivateTags = useCallback(
    async (event: Event): Promise<{ privateTags: string[][]; wasNip04: boolean }> => {
      if (!event.content || !canStorePrivateFollowsInContent(event.content)) {
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
        return { privateTags: [], wasNip04: false }
      }
    },
    [nip04Decrypt, nip44Decrypt]
  )

  const migrateToNip44 = useCallback(
    async (event: Event, nextPrivateTags: string[][]) => {
      if (!accountPubkey || !canStorePrivateFollowsInContent(event.content)) return
      try {
        const cipherText = await nip44Encrypt(accountPubkey, JSON.stringify(nextPrivateTags))
        const newFollowListDraftEvent = createFollowListDraftEvent(event.tags, cipherText)
        const published = await publish(newFollowListDraftEvent)
        await updateFollowListEvent(published, nextPrivateTags)
      } catch (error) {
        console.error('[FollowList] Failed to migrate to NIP-44', error)
      }
    },
    [accountPubkey, nip44Encrypt, publish, updateFollowListEvent]
  )

  useEffect(() => {
    const updateFollowTags = async () => {
      if (!followListEvent) {
        setTags([])
        setPrivateTags([])
        return
      }

      const { privateTags: nextPrivateTags, wasNip04 } = await getPrivateTags(
        followListEvent
      ).catch(() => ({
        privateTags: [] as string[][],
        wasNip04: false
      }))
      setPrivateTags(nextPrivateTags)
      setTags(followListEvent.tags)

      if (wasNip04 && nextPrivateTags.length > 0) {
        migrateToNip44(followListEvent, nextPrivateTags)
      }
    }
    updateFollowTags()
  }, [followListEvent, getPrivateTags, migrateToNip44])

  const getFollowPubkeys = () => {
    return Array.from(followingSet)
  }

  const getFollowType = useCallback(
    (pubkey: string): 'public' | 'private' | null => {
      return getFollowTypeFromSets(pubkey, publicFollowingSet, privateFollowingSet)
    },
    [publicFollowingSet, privateFollowingSet]
  )

  const publishNewFollowListEvent = async (nextTags: string[][], content?: string) => {
    if (dayjs().unix() === followListEvent?.created_at) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const newFollowListDraftEvent = createFollowListDraftEvent(nextTags, content)
    return publish(newFollowListDraftEvent)
  }

  const checkFollowListEvent = (event: Event | null) => {
    if (!event) {
      const result = confirm(t('FollowListNotFoundConfirmation'))
      if (!result) {
        throw new Error('Follow list not found')
      }
    }
  }

  const assertCanStorePrivateFollows = (content?: string) => {
    if (canStorePrivateFollowsInContent(content)) return
    throw new Error(
      t(
        'Private follows cannot be stored because this follow list still uses a legacy NIP-02 relay map in its content.'
      )
    )
  }

  const encryptPrivateTags = async (nextPrivateTags: string[][]) => {
    if (!accountPubkey) throw new Error('Not logged in')
    if (nextPrivateTags.length === 0) return ''
    return nip44Encrypt(accountPubkey, JSON.stringify(nextPrivateTags))
  }

  const followPublicly = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      checkFollowListEvent(event)
      if (event && hasPTag(event.tags, pubkey)) {
        return
      }

      const { privateTags: currentPrivateTags } = event
        ? await getPrivateTags(event)
        : { privateTags: [] as string[][] }
      const nextPrivateTags = filterPTags(currentPrivateTags, pubkey)
      const cipherText = canStorePrivateFollowsInContent(event?.content)
        ? await encryptPrivateTags(nextPrivateTags)
        : (event?.content ?? '')
      const newFollowListEvent = await publishNewFollowListEvent(
        (event?.tags ?? []).concat([['p', pubkey]]),
        cipherText
      )
      await updateFollowListEvent(newFollowListEvent, nextPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to follow publicly') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      setChanging(false)
    }
  }

  const followPrivately = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      checkFollowListEvent(event)
      assertCanStorePrivateFollows(event?.content)

      const { privateTags: currentPrivateTags } = event
        ? await getPrivateTags(event)
        : { privateTags: [] as string[][] }
      if (hasPTag(currentPrivateTags, pubkey)) {
        return
      }

      const nextPrivateTags = currentPrivateTags.concat([['p', pubkey]])
      const cipherText = await encryptPrivateTags(nextPrivateTags)
      const newFollowListEvent = await publishNewFollowListEvent(
        event ? filterPTags(event.tags, pubkey) : [],
        cipherText
      )
      await updateFollowListEvent(newFollowListEvent, nextPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to follow privately') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      setChanging(false)
    }
  }

  const follow = async (pubkey: string) => {
    await followPublicly(pubkey)
  }

  const unfollow = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      if (!event) return

      const { privateTags: currentPrivateTags } = await getPrivateTags(event)
      const nextPrivateTags = filterPTags(currentPrivateTags, pubkey)
      let cipherText = event.content
      if (
        canStorePrivateFollowsInContent(event.content) &&
        nextPrivateTags.length !== currentPrivateTags.length
      ) {
        cipherText = await encryptPrivateTags(nextPrivateTags)
      }

      const newFollowListEvent = await publishNewFollowListEvent(
        filterPTags(event.tags, pubkey),
        cipherText
      )
      await updateFollowListEvent(newFollowListEvent, nextPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to unfollow') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      setChanging(false)
    }
  }

  const switchToPublicFollow = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      if (!event) return

      const { privateTags: currentPrivateTags } = await getPrivateTags(event)
      const nextPrivateTags = filterPTags(currentPrivateTags, pubkey)
      if (nextPrivateTags.length === currentPrivateTags.length && hasPTag(event.tags, pubkey)) {
        return
      }

      const cipherText = canStorePrivateFollowsInContent(event.content)
        ? await encryptPrivateTags(nextPrivateTags)
        : event.content
      const newFollowListEvent = await publishNewFollowListEvent(
        filterPTags(event.tags, pubkey).concat([['p', pubkey]]),
        cipherText
      )
      await updateFollowListEvent(newFollowListEvent, nextPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to switch to public follow') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      setChanging(false)
    }
  }

  const switchToPrivateFollow = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      if (!event) return
      assertCanStorePrivateFollows(event.content)

      const { privateTags: currentPrivateTags } = await getPrivateTags(event)
      const nextPrivateTags = filterPTags(currentPrivateTags, pubkey).concat([['p', pubkey]])
      const cipherText = await encryptPrivateTags(nextPrivateTags)
      const newFollowListEvent = await publishNewFollowListEvent(
        filterPTags(event.tags, pubkey),
        cipherText
      )
      await updateFollowListEvent(newFollowListEvent, nextPrivateTags)
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to switch to private follow') + ': ' + err, { duration: 10_000 })
      })
    } finally {
      setChanging(false)
    }
  }

  const convertAllPublicFollowsToPrivate = async () => {
    if (!accountPubkey || changing) return 0

    setChanging(true)
    try {
      const event = await client.fetchFollowListEvent(accountPubkey)
      if (!event) return 0
      assertCanStorePrivateFollows(event.content)

      const publicPubkeys = getPubkeysFromPTags(event.tags)
      if (publicPubkeys.length === 0) return 0

      const { privateTags: currentPrivateTags } = await getPrivateTags(event)
      const existingPrivate = new Set(getPubkeysFromPTags(currentPrivateTags))
      const nextPrivateTags = [...currentPrivateTags]
      for (const pubkey of publicPubkeys) {
        if (!existingPrivate.has(pubkey)) {
          nextPrivateTags.push(['p', pubkey])
          existingPrivate.add(pubkey)
        }
      }

      const cipherText = await encryptPrivateTags(nextPrivateTags)
      const newFollowListEvent = await publishNewFollowListEvent(
        event.tags.filter(([tagName]) => tagName !== 'p'),
        cipherText
      )
      await updateFollowListEvent(newFollowListEvent, nextPrivateTags)
      return publicPubkeys.length
    } catch (error) {
      const errors = formatError(error)
      errors.forEach((err) => {
        toast.error(t('Failed to convert public follows to private') + ': ' + err, {
          duration: 10_000
        })
      })
      return 0
    } finally {
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
