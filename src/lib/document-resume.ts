type PageGlobal = typeof globalThis & {
  addEventListener?: (type: string, listener: (event?: Event) => void) => void
  removeEventListener?: (type: string, listener: (event?: Event) => void) => void
  document?: {
    visibilityState?: string
    addEventListener: (type: string, listener: (event?: Event) => void) => void
    removeEventListener?: (type: string, listener: (event?: Event) => void) => void
  }
}

export const DOCUMENT_RESUME_DEBOUNCE_MS = 200

/**
 * Fires after the page comes back from sleep, tab discard, bfcache, or a
 * network drop. Visibility + online often arrive together, so callers are
 * debounced to one resume.
 */
export function observeDocumentResume(
  onResume: () => void,
  {
    debounceMs = DOCUMENT_RESUME_DEBOUNCE_MS,
    page = globalThis as PageGlobal
  }: { debounceMs?: number; page?: PageGlobal } = {}
): () => void {
  let hidden = page.document?.visibilityState === 'hidden'
  let timer: ReturnType<typeof setTimeout> | undefined

  const bump = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      onResume()
    }, debounceMs)
  }

  const onVisibilityChange = () => {
    if (page.document?.visibilityState === 'hidden') {
      hidden = true
      return
    }
    if (hidden && page.document?.visibilityState === 'visible') {
      hidden = false
      bump()
    }
  }

  const onPageShow = (event?: Event) => {
    if (event && 'persisted' in event && (event as PageTransitionEvent).persisted) {
      bump()
    }
  }

  page.document?.addEventListener('visibilitychange', onVisibilityChange)
  page.document?.addEventListener('resume', bump)
  page.addEventListener?.('online', bump)
  page.addEventListener?.('pageshow', onPageShow)

  return () => {
    if (timer) clearTimeout(timer)
    page.document?.removeEventListener?.('visibilitychange', onVisibilityChange)
    page.document?.removeEventListener?.('resume', bump)
    page.removeEventListener?.('online', bump)
    page.removeEventListener?.('pageshow', onPageShow)
  }
}
