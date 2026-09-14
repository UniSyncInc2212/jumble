import FollowButton from '@/components/FollowButton'
import Nip05 from '@/components/Nip05'
import ProfileList from '@/components/ProfileList'
import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useFetchFollowings, useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useFollowList } from '@/providers/FollowListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Loader, Lock, Unlock } from 'lucide-react'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const FollowingListPage = forwardRef(({ id, index }: { id?: string; index?: number }, ref) => {
  const { t } = useTranslation()
  const { profile } = useFetchProfile(id)
  const { pubkey: accountPubkey } = useNostr()
  const { followings } = useFetchFollowings(profile?.pubkey)
  const { followingSet } = useFollowList()
  const isSelf = !!accountPubkey && profile?.pubkey === accountPubkey
  const ownFollowPubkeys = useMemo(() => Array.from(followingSet), [followingSet])
  const pubkeys = isSelf ? ownFollowPubkeys : followings

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={
        profile?.username
          ? t("username's following", { username: profile.username })
          : t('Following')
      }
      displayScrollToTopButton
    >
      {isSelf ? <OwnFollowingList pubkeys={pubkeys} /> : <ProfileList pubkeys={pubkeys} />}
    </SecondaryPageLayout>
  )
})
FollowingListPage.displayName = 'FollowingListPage'
export default FollowingListPage

function OwnFollowingList({ pubkeys }: { pubkeys: string[] }) {
  const [visiblePubkeys, setVisiblePubkeys] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisiblePubkeys(pubkeys.slice(0, 10))
  }, [pubkeys])

  useEffect(() => {
    const observerInstance = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && pubkeys.length > visiblePubkeys.length) {
          setVisiblePubkeys((prev) => [...prev, ...pubkeys.slice(prev.length, prev.length + 10)])
        }
      },
      { root: null, rootMargin: '10px', threshold: 1 }
    )

    const currentBottomRef = bottomRef.current
    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [visiblePubkeys, pubkeys])

  return (
    <div className="space-y-2 px-4 pt-2">
      {visiblePubkeys.map((pubkey, index) => (
        <OwnFollowingItem key={`${index}-${pubkey}`} pubkey={pubkey} />
      ))}
      {pubkeys.length > visiblePubkeys.length && <div ref={bottomRef} />}
    </div>
  )
}

function OwnFollowingItem({ pubkey }: { pubkey: string }) {
  const { changing, getFollowType, switchToPrivateFollow, switchToPublicFollow } = useFollowList()
  const followType = useMemo(() => getFollowType(pubkey), [pubkey, getFollowType])
  const [switching, setSwitching] = useState(false)

  return (
    <div className="flex items-start gap-2">
      <UserAvatar userId={pubkey} className="shrink-0" />
      <div className="w-full overflow-hidden">
        <Username
          userId={pubkey}
          className="w-fit max-w-full truncate font-semibold"
          skeletonClassName="h-4"
        />
        <Nip05 pubkey={pubkey} />
      </div>
      <div className="flex items-center gap-2">
        {switching ? (
          <Button disabled variant="ghost" size="icon">
            <Loader className="animate-spin" />
          </Button>
        ) : followType === 'private' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (switching) return
              setSwitching(true)
              switchToPublicFollow(pubkey).finally(() => setSwitching(false))
            }}
            disabled={changing}
          >
            <Lock className="text-green-400" />
          </Button>
        ) : followType === 'public' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (switching) return
              setSwitching(true)
              switchToPrivateFollow(pubkey).finally(() => setSwitching(false))
            }}
            disabled={changing}
          >
            <Unlock className="text-muted-foreground" />
          </Button>
        ) : null}
        <FollowButton pubkey={pubkey} />
      </div>
    </div>
  )
}
