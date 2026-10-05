import { useCallback, useEffect, useState } from 'react'
import type { LabActionResult, LabSnapshot } from '@/shared/lab/contracts'

export function useLab() {
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const accept = useCallback((next: LabSnapshot) => setSnapshot(previous => !previous || next.revision >= previous.revision ? next : previous), [])
  useEffect(() => {
    let disposed = false
    const unsubscribe = window.labApi.onSnapshot(next => { if (!disposed) accept(next) })
    window.labApi.getSnapshot().then(next => { if (!disposed) accept(next) }).catch(e => { if (!disposed) setError(String(e)) })
    return () => { disposed = true; unsubscribe() }
  }, [accept])
  const action = async (call: () => Promise<LabActionResult>): Promise<LabActionResult | null> => {
    setError(null)
    try {
      const result = await call()
      accept(result.snapshot)
      if (!result.ok) setError(result.error)
      return result
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null }
  }
  return { snapshot, error, action }
}
