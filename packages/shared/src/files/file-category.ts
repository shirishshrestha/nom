export const FILE_CATEGORIES = {
  DOCUMENT: 'document',
} as const;

export type FileCategory = 
| 'document'

export const DOCUMENT_TYPES={
  SOURCE:"source",
  TRANSACTION:"transaction",
} as const;

export type DocumentType = 
| "source"
| "transaction";