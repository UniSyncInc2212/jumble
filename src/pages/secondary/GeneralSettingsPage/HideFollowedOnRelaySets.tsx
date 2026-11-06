import { SettingsRow } from '@/components/ui/settings'
import { Switch } from '@/components/ui/switch'
import { toRelaySettings } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useTranslation } from 'react-i18next'

export default function HideFollowedOnRelaySets() {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { relaySets } = useFavoriteRelays()
  const { isHideFollowedOnRelaySet, setHideFollowedOnRelaySet } = useContentPolicy()

  return (
    <SettingsRow
      layout="stacked"
      title={t('Hide followed users on relay sets')}
      description={t(
        'Choose which relay sets hide notes from people you already follow. Useful for language or discovery feeds.'
      )}
    >
      {relaySets.length === 0 ? (
        <button
          type="button"
          className="text-muted-foreground text-start text-sm underline-offset-4 hover:underline"
          onClick={() => push(toRelaySettings())}
        >
          {t('Create a relay set in Relay settings to use this filter.')}
        </button>
      ) : (
        <div className="divide-border/60 divide-y overflow-hidden rounded-lg border">
          {relaySets.map((relaySet) => {
            const switchId = `hide-followed-relay-set-${relaySet.id}`
            return (
              <div key={relaySet.id} className="flex items-center gap-3 px-3 py-2.5">
                <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
                  <div className="truncate text-sm font-medium">{relaySet.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {t('n relays', { n: relaySet.relayUrls.length })}
                  </div>
                </label>
                <Switch
                  id={switchId}
                  className="shrink-0"
                  checked={isHideFollowedOnRelaySet(relaySet.id)}
                  onCheckedChange={(checked) => setHideFollowedOnRelaySet(relaySet.id, checked)}
                />
              </div>
            )
          })}
        </div>
      )}
    </SettingsRow>
  )
}
