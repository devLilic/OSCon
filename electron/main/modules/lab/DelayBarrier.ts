import type { LabLog, PropagationBarrier } from './ports'
export class DelayBarrier implements PropagationBarrier {
  constructor(private readonly log: LabLog) {}
  async wait(ms: number, operationId: string) {
    const started = performance.now()
    this.log.write('info', 'DELAY_BEGIN', { operationId, requestedMs: ms })
    await new Promise<void>(resolve => setTimeout(resolve, ms))
    this.log.write('info', 'DELAY_END', { operationId, requestedMs: ms, elapsedMs: Math.round(performance.now() - started), reloadConfirmed: false })
  }
}
