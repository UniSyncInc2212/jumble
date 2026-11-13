/**
 * NIP-51 private follow helpers for kind 3 contact lists.
 *
 * Kind 3 historically stored a NIP-02 relay map in `content`. Private follows
 * use NIP-44 encrypted tags in that same field (NIP-51), so we must not
 * overwrite a legacy relay map.
 */

export function isNip02RelayMap(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false

    const keys = Object.keys(parsed)
    if (keys.length === 0) return false

    return keys.every((key) => {
      if (!key.startsWith('wss://') && !key.startsWith('ws://')) return false
      const value = (parsed as Record<string, unknown>)[key]
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    })
  } catch {
    return false
  }
}

export function canStorePrivateFollowsInContent(content?: string): boolean {
  if (!content) return true
  return !isNip02RelayMap(content)
}

export function hasPTag(tags: string[][], pubkey: string): boolean {
  return tags.some(([tagName, tagValue]) => tagName === 'p' && tagValue === pubkey)
}

export function filterPTags(tags: string[][], pubkey: string): string[][] {
  return tags.filter(([tagName, tagValue]) => tagName !== 'p' || tagValue !== pubkey)
}

export function getFollowTypeFromSets(
  pubkey: string,
  publicSet: Set<string>,
  privateSet: Set<string>
): 'public' | 'private' | null {
  if (publicSet.has(pubkey)) return 'public'
  if (privateSet.has(pubkey)) return 'private'
  return null
}
