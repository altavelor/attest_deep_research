// Публичный API DSL определения research-инструментов (application/sources/tools).
// Потребители (адаптеры инструментов) импортируют `@application/sources/tools`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export {
  bool,
  defineInventoryTool,
  defineTool,
  diagnostics,
  enumOf,
  int,
  num,
  okPage,
  str,
  strArray,
  text,
  toolDefinition,
} from "./toolFactory";
export type { FieldSchema, FieldSpec, InventoryToolSpec, ToolSpec } from "./toolFactory";
