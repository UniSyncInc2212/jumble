import NormalFeed from '@/components/NormalFeed'
import { createHideFollowedFilterFn } from '@/lib/hide-followed-notes'
import { checkAlgoRelay } from '@/lib/relay'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useFollowList } from '@/providers/FollowListProvider'
import relayInfoService from '@/services/relay-info.service'
import { useEffect, useMemo, useState } from 'react'

export default function RelaysFeed() {
  const { relayUrls, feedInfo } = useFeed()
  const { followingSet } = useFollowList()
  const { isHideFollowedOnRelaySet } = useContentPolicy()
  const [isReady, setIsReady] = useState(false)
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)
  const feedId = useMemo(() => {
    if (feedInfo?.feedType === 'relay' && feedInfo.id) {
      return `relay-${feedInfo.id}`
    } else if (feedInfo?.feedType === 'relays' && feedInfo.id) {
      return `relays-${feedInfo.id}`
    }
    return 'relays-default'
  }, [feedInfo])

  const hideFollowed =
    feedInfo?.feedType === 'relays' && !!feedInfo.id && isHideFollowedOnRelaySet(feedInfo.id)

  const filterFn = useMemo(() => {
    if (!hideFollowed) return undefined
    return createHideFollowedFilterFn(followingSet)
  }, [hideFollowed, followingSet])

  useEffect(() => {
    const init = async () => {
      const relayInfos = await relayInfoService.getRelayInfos(relayUrls)
      setAreAlgoRelays(relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo)))
      setIsReady(true)
    }
    init()
  }, [relayUrls])

  if (!isReady) {
    return null
  }

  return (
    <NormalFeed
      feedId={feedId}
      subRequests={[{ urls: relayUrls, filter: {} }]}
      areAlgoRelays={areAlgoRelays}
      showRelayCloseReason
      filterFn={filterFn}
    />
  )
}
