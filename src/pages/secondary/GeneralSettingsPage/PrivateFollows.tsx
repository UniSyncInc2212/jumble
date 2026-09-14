import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { SettingsGroup, SettingsRow } from '@/components/ui/settings'
import { Switch } from '@/components/ui/switch'
import { useFollowList } from '@/providers/FollowListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { Loader } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function PrivateFollows() {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { followPrivatelyByDefault, updateFollowPrivatelyByDefault } = useUserPreferences()
  const { changing, followingSet, getFollowType, convertAllPublicFollowsToPrivate } =
    useFollowList()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [converting, setConverting] = useState(false)

  const publicFollowCount = useMemo(() => {
    let count = 0
    followingSet.forEach((followPubkey) => {
      if (getFollowType(followPubkey) === 'public') count += 1
    })
    return count
  }, [followingSet, getFollowType])

  if (!pubkey) return null

  const handleConvert = async () => {
    setConverting(true)
    try {
      const converted = await convertAllPublicFollowsToPrivate()
      if (converted > 0) {
        toast.success(t('Converted {{count}} public follows to private', { count: converted }))
      } else {
        toast.message(t('No public follows to convert'))
      }
    } finally {
      setConverting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <SettingsGroup title={t('Private follows')}>
        <SettingsRow
          htmlFor="follow-privately-by-default"
          title={t('Follow privately by default')}
          description={t('New follows will not appear on your public follow list')}
          control={
            <Switch
              id="follow-privately-by-default"
              checked={followPrivatelyByDefault}
              onCheckedChange={updateFollowPrivatelyByDefault}
            />
          }
        />
        <SettingsRow
          title={t('Convert public follows to private')}
          description={t(
            'Move everyone you follow publicly onto your encrypted private follow list'
          )}
          onClick={() => setConfirmOpen(true)}
          disabled={changing || converting || publicFollowCount === 0}
          chevron
        />
      </SettingsGroup>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Convert public follows to private?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This will hide your current public follow list from other people. You can switch individual follows back to public later.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={converting}>
              {converting ? <Loader className="animate-spin" /> : t('Convert')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
