import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './errors'

type State<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Basit veri çekme yardımcısı: bağımlılıklar değişince yeniden çalışır,
 * `reload()` ile elle tetiklenir. Yarışan isteklerde son sonuç kazanır.
 */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const runId = useRef(0)

  const run = useCallback(async () => {
    const id = ++runId.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const data = await fetcherRef.current()
      if (id === runId.current) setState({ data, loading: false, error: null })
    } catch (err) {
      if (id === runId.current) {
        setState({ data: null, loading: false, error: errorMessage(err) })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { ...state, reload: run }
}
