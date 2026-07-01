// Публичный API модуля application/sources — доменные источники данных,
// снимки доказательств и политика веб-URL. DSL определения инструментов живёт в
// под-баррелe `@application/sources/tools`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { AttachmentSource } from "./AttachmentSource";
export type { AttachmentSourceOptions } from "./AttachmentSource";

export { SourceManager } from "./DataSource";
export type { DataSource, DataSourceDescriptor, SourceKind } from "./DataSource";

export type {
  EvidenceCallProvenance,
  EvidenceProvenance,
  EvidenceRegistry,
  RegisteredWebResult,
  ResearchEvidenceSnapshot,
  WebHandleEntry,
} from "./evidence";

export { validatePublicWebUrl } from "./WebUrlPolicy";
export type { WebUrlValidationResult } from "./WebUrlPolicy";
