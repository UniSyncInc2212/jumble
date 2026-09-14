import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_RESUME_DEBOUNCE_MS, observeDocumentResume } from './document-resume'

describe('observeDocumentResume', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not fire on the initial subscribe', () => {
    const { listeners } = installPageGlobals({ visibilityState: 'visible', online: true })
    const onResume = vi.fn()
    observeDocumentResume(onResume, { debounceMs: 0 })
    expect(onResume).not.toHaveBeenCalled()
    expect(listeners.size).toBeGreaterThan(0)
  })

  it('fires once when a hidden page becomes visible', async () => {
    vi.useFakeTimers()
    const { listeners, document } = installPageGlobals({
      visibilityState: 'hidden',
      online: true
    })
    const onResume = vi.fn()
    observeDocumentResume(onResume)

    listeners.get('visibilitychange')?.()
    await vi.advanceTimersByTimeAsync(DOCUMENT_RESUME_DEBOUNCE_MS)
    expect(onResume).not.toHaveBeenCalled()

    document.visibilityState = 'visible'
    listeners.get('visibilitychange')?.()
    await vi.advanceTimersByTimeAsync(DOCUMENT_RESUME_DEBOUNCE_MS)
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('coalesces visibility and online into a single resume', async () => {
    vi.useFakeTimers()
    const { listeners, document } = installPageGlobals({
      visibilityState: 'hidden',
      online: false
    })
    const onResume = vi.fn()
    observeDocumentResume(onResume)

    document.visibilityState = 'visible'
    listeners.get('visibilitychange')?.()
    listeners.get('online')?.()
    await vi.advanceTimersByTimeAsync(DOCUMENT_RESUME_DEBOUNCE_MS)
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('fires on pageshow from bfcache and on the page lifecycle resume event', async () => {
    vi.useFakeTimers()
    const { listeners } = installPageGlobals({ visibilityState: 'visible', online: true })
    const onResume = vi.fn()
    observeDocumentResume(onResume)

    listeners.get('pageshow')?.({ persisted: false } as PageTransitionEvent)
    await vi.advanceTimersByTimeAsync(DOCUMENT_RESUME_DEBOUNCE_MS)
    expect(onResume).not.toHaveBeenCalled()

    listeners.get('pageshow')?.({ persisted: true } as PageTransitionEvent)
    await vi.advanceTimersByTimeAsync(DOCUMENT_RESUME_DEBOUNCE_MS)
    expect(onResume).toHaveBeenCalledOnce()

    listeners.get('resume')?.()
    await vi.advanceTimersByTimeAsync(DOCUMENT_RESUME_DEBOUNCE_MS)
    expect(onResume).toHaveBeenCalledTimes(2)
  })
})

function installPageGlobals({
  visibilityState,
  online
}: {
  visibilityState: string
  online: boolean
}) {
  const listeners = new Map<string, (event?: Event) => void>()
  const addEventListener = (type: string, listener: (event?: Event) => void) => {
    listeners.set(type, listener)
  }
  const removeEventListener = (type: string) => {
    listeners.delete(type)
  }
  const document = { visibilityState, addEventListener, removeEventListener }
  vi.stubGlobal('navigator', { onLine: online })
  vi.stubGlobal('addEventListener', addEventListener)
  vi.stubGlobal('removeEventListener', removeEventListener)
  vi.stubGlobal('document', document)
  return { listeners, document }
}
