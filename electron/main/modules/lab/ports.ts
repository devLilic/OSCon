import type { BufferId, GraphicFields, GraphicItem, HeadlineBufferConfig, LabLogEntry, PlaybackCommand } from '../../../../src/shared/lab/contracts'
export interface LabLog { write(level: LabLogEntry['level'], event: string, details?: Record<string, unknown>): void }
export interface JsonDataSource { writeBuffer(item: GraphicItem, buffer: BufferId, operationId: string): Promise<void> }
export interface HeadlineTextDataSource { writePair(config: HeadlineBufferConfig, fields: GraphicFields, operationId: string, buffer: BufferId): Promise<void> }
export interface PersonTextDataSource { writePersonPair(namePath: string, rolePath: string, fields: GraphicFields, operationId: string): Promise<void> }
export interface GraphicsTransport { send(command: PlaybackCommand, contentName: string, operationId: string): Promise<void> }
export interface PropagationBarrier { wait(ms: number, operationId: string): Promise<void> }
