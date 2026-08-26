export const FILE_STATUSES = {
  PENDING: 'pending',
  UPLOADED: 'uploaded',
  FAILED: 'failed',
} as const;

export type FileStatus = (typeof FILE_STATUSES)[keyof typeof FILE_STATUSES];
