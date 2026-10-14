// API DTO types, inferred from the zod schemas so the two never drift.
import type { z } from 'zod';
import type * as s from './schemas.ts';

export type CreateRecording = z.input<typeof s.createRecordingSchema>;
export type RecordingCreated = z.infer<typeof s.recordingCreatedSchema>;
export type ChunkInfo = z.infer<typeof s.chunkInfoSchema>;
export type CompleteStream = z.infer<typeof s.completeStreamSchema>;
export type AnnotationInput = z.infer<typeof s.annotationInputSchema>;
export type FinalizeRecording = z.input<typeof s.finalizeRecordingSchema>;
export type RecordingSummary = z.infer<typeof s.recordingSummarySchema>;
export type CreateComment = z.infer<typeof s.createCommentSchema>;
export type CreateShareLink = z.input<typeof s.createShareLinkSchema>;
export type CreateFolder = z.infer<typeof s.createFolderSchema>;
export type ExtTokenExchange = z.infer<typeof s.extTokenExchangeSchema>;
export type CreateApiToken = z.infer<typeof s.createApiTokenSchema>;
export type Health = z.infer<typeof s.healthSchema>;
export type ApiError = z.infer<typeof s.apiErrorSchema>;

/** Result of PUT .../chunks/:seq. */
export type ChunkPutResult = { status: 201 | 200; seq: number } | { status: 409; seq: number; error: 'hash_mismatch' };
