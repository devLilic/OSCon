import { useState } from 'react'
import { LabScreen } from '@/features/lab/LabScreen'

export type OperatorPage = 'status' | 'settings' | 'diagnostics'

export default function App() {
  const [page, setPage] = useState<OperatorPage>('status')
  return <LabScreen page={page} onPageChange={setPage} />
}
