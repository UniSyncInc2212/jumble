import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useFollowList } from '@/providers/FollowListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { Loader, Lock, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function FollowButton({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey: accountPubkey, checkLogin } = useNostr()
  const { followPrivatelyByDefault } = useUserPreferences()
  const { followingSet, changing, getFollowType, followPublicly, followPrivately, unfollow } =
    useFollowList()
  const [updating, setUpdating] = useState(false)
  const [hover, setHover] = useState(false)
  const isFollowing = useMemo(() => followingSet.has(pubkey), [followingSet, pubkey])
  const followType = useMemo(() => getFollowType(pubkey), [getFollowType, pubkey])

  if (!accountPubkey || (pubkey && pubkey === accountPubkey)) return null

  const handleFollow = async (e: React.MouseEvent, isPrivate = followPrivatelyByDefault) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (isFollowing) return

      setUpdating(true)
      try {
        if (isPrivate) {
          await followPrivately(pubkey)
        } else {
          await followPublicly(pubkey)
        }
      } catch (error) {
        toast.error(`${t('Follow failed')}: ${(error as Error).message}`)
      } finally {
        setUpdating(false)
      }
    })
  }

  const handleUnfollow = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (!isFollowing) return

      setUpdating(true)
      try {
        await unfollow(pubkey)
      } catch (error) {
        toast.error(`${t('Unfollow failed')}: ${(error as Error).message}`)
      } finally {
        setUpdating(false)
      }
    })
  }

  if (isFollowing) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              className="min-w-28 rounded-full"
              variant={hover ? 'destructive' : 'secondary'}
              disabled={updating || changing}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
            >
              {updating ? (
                <Loader className="animate-spin" />
              ) : hover ? (
                t('Unfollow')
              ) : (
                <span className="flex items-center gap-1">
                  {followType === 'private' && <Lock className="size-3.5" />}
                  {followType === 'private' ? t('Following privately') : t('buttonFollowing')}
                </span>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Unfollow')}?</AlertDialogTitle>
              <AlertDialogDescription>
                {t('Are you sure you want to unfollow this user?')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleUnfollow} variant="destructive">
                {t('Unfollow')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  const trigger = (
    <Button className="min-w-28 rounded-full" disabled={updating || changing}>
      {updating ? <Loader className="animate-spin" /> : t('Follow')}
    </Button>
  )

  const privateItem = {
    label: t('Follow user privately'),
    onClick: (e: React.MouseEvent) => handleFollow(e, true)
  }
  const publicItem = {
    label: t('Follow user publicly'),
    onClick: (e: React.MouseEvent) => handleFollow(e, false)
  }
  const items = followPrivatelyByDefault ? [privateItem, publicItem] : [publicItem, privateItem]

  if (isSmallScreen) {
    return (
      <Drawer>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <div className="py-2">
            {items.map((item) => (
              <Button
                key={item.label}
                className="w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                variant="ghost"
                onClick={item.onClick}
                disabled={updating || changing}
              >
                {updating ? <Loader className="animate-spin" /> : item.label}
              </Button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onClick={item.onClick}>
            {item.label === t('Follow user privately') ? <Lock /> : <UserPlus />}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
