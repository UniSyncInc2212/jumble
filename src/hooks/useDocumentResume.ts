import { observeDocumentResume } from '@/lib/document-resume'
import { useEffect, useState } from 'react'

/**
 * Increments when the document wakes from sleep, freeze, bfcache, or a
 * network drop so feed subscriptions can restart without a full refresh.
 */
export function useDocumentResume() {
  const [resumeCount, setResumeCount] = useState(0)

  useEffect(() => {
    return observeDocumentResume(() => {
      setResumeCount((count) => count + 1)
    })
  }, [])

  return resumeCount
}
