// Публичный API модуля research-tools.
//
// Внешние потребители (composition root, тесты контракта) импортируют ТОЛЬКО
// отсюда: `import { … } from "@adapters/research-tools"`. Всё, чего здесь нет,
// — внутренняя реализация модуля (конкретные классы-инструменты, реестр
// доказательств, источники), она подключается относительными путями и снаружи
// не видна.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе образуется цикл (ловит `npm run depcruise`).

export { createResearchToolRegistry } from "./createResearchToolRegistry";
export type { CreatedResearchToolRegistry } from "./createResearchToolRegistry";

export { runToolLoop } from "./ToolLoopRunner";
export type { ToolLoopEvent, ToolLoopResult, ToolLoopRunnerOptions } from "./ToolLoopRunner";

export { AUTO_CONFIRM, NoteToolService, validateMutablePath } from "./note/NoteTools";
export type {
  NoteActionConfirmation,
  NoteActionRequest,
  NoteActionType,
  NoteToolExecution,
  NoteToolServiceOptions,
} from "./note/NoteTools";
