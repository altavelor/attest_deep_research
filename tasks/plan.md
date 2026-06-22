# Plan: Agentic Skills и роли инструментов

Spec: SPEC-agentic-skills-and-tool-roles.md

## Tasks

### Task 1 — `agenticPrompts.ts`: новый `ActiveSkills` API + встроенные скилы + fix `sanitize()` [ ]

Files: `src/research/agenticPrompts.ts`, `src/research/ResearchService.ts` (только call site в `answerAgentically`), `tests/unit/agentic-prompts.test.ts`

Acceptance:
- `ActiveSkills` interface экспортирован: `coreVariant`, `index`, `web`, `indexDescription?`, `noteMutationAccess`
- `BuildAgenticResearchMessagesOptions` заменяет `skillCatalog`/`noteMutationAccess`/`indexDescription` на `activeSkills: ActiveSkills`
- Core-Vault skill появляется в system prompt когда `coreVariant === "vault"`
- Core-Research skill появляется когда `coreVariant === "research"`
- Index skill с `indexDescription` появляется когда `activeSkills.index === true && indexDescription`
- Index skill НЕ появляется когда `indexDescription` отсутствует
- Web skill появляется когда `activeSkills.web === true`
- Mutation rules секция появляется только когда `noteMutationAccess === true`
- `sanitize()` использует HTML entities (`&lt;` / `&gt;` / `&amp;`)
- `requiredTools` и `explicitEvidence` работают как прежде
- `ResearchService.answerAgentically` строит `activeSkills` и передаёт в `buildAgenticResearchMessages`
- Все тесты в `agentic-prompts.test.ts` обновлены и проходят

---

### Task 2 — `search_notes`: убрать retriever, добавить `editingOnly` [ ]

Files: `src/research/tools/NoteTools.ts`, `tests/unit/note-tools.test.ts`

Dependencies: Task 1

Acceptance:
- `searchWithRetriever` метод удалён из `NoteToolService`
- `retriever` больше не используется в `searchNotes`
- Результат содержит `editingOnly: true`
- Результат содержит `source: "path"` (всегда)
- Описание инструмента обновлено: "Find vault notes by keyword match... Results are NOT evidence..."
- `NoteToolServiceOptions.retriever` НЕ используется в `searchNotes` (может оставаться для будущего использования другими методами)
- Тесты обновлены

---

### Task 3 — `read_note` + editing tools: убрать `readSkill`, обновить descriptions, прекратить регистрацию evidence [ ]

Files: `src/research/tools/NoteTools.ts`, `src/research/tools/ResearchToolRegistry.ts`

Dependencies: Task 2

Acceptance:
- `readSkill` метод удалён из `NoteToolService`
- `SKILL_ROOT` импорт и использование удалены из `NoteTools.ts`
- `SkillRegistry` удалён из `NoteToolServiceOptions` и `NoteToolService`
- `read_note` description обновлён: "For editing only — returned text is NOT citable evidence..."
- `list_notes` description обновлён: "For editing navigation only — results are not evidence."
- `get_active_note` description обновлён: "For editing only — not citable evidence. Active note content is already provided as attached context..."
- `NoteToolHandlerAdapter.execute` НЕ вызывает `registerNoteEvidence` для `read_note` и `get_active_note`
- `isEvidenceResult` и связанная логика регистрации chunks удалены из `ResearchToolRegistry.ts`
- `tests/unit/note-tools.test.ts`: удалены skill-related тесты

---

### Task 4 — `ResearchToolRegistry`: убрать `skillAccess`, `skillOnly` [ ]

Files: `src/research/tools/ResearchToolRegistry.ts`, `src/research/tools/createResearchToolRegistry.ts`

Dependencies: Task 3

Acceptance:
- `skillAccess: boolean` удалён из `ResearchToolAvailability` и `NoteToolAvailability`
- `skillOnly` поле удалено из `NoteToolHandlerAdapter`
- `parseInput` в `NoteToolHandlerAdapter` не содержит skill-path проверку
- `adaptNoteToolHandlers` не принимает `skillAccess`
- `isInternalSkillPath` импорт удалён из `ResearchToolRegistry.ts`
- `createResearchToolRegistry.ts` не передаёт `skillAccess`
- `DEFAULT_AVAILABILITY` не содержит `skillAccess`

---

### Task 5 — `ResearchExecutionPolicy` + active note prefetch [ ]

Files: `src/research/ResearchExecutionPolicy.ts`, `src/research/ResearchService.ts`

Dependencies: Task 4

Acceptance:
- `includeActiveFile` убран из `mandatoryTools` в `ResearchExecutionPolicy`
- `mandatoryTools` принимает только `searchMode` (не `includeActiveFile`)
- `get_active_note` НЕ входит в `requiredTools` ни при каких условиях
- В `ResearchService.answerAgentically`: если `includeActiveFile && activeFilePath && noteTools` — читает активный файл через `noteTools.execute(get_active_note)` перед запуском runner
- Результат активного файла добавляется в `explicitEvidence` (не регистрируется в evidence registry отдельно)
- При ошибке чтения активного файла — игнорируется (не падает весь запрос)

---

### Task 6 — Удалить skill system из `ResearchService.ts` и `AnswerSynthesisService.ts` [ ]

Files: `src/research/ResearchService.ts`, `src/research/AnswerSynthesisService.ts`

Dependencies: Task 5

Acceptance:
- `skillRegistry`, `skillSnapshot`, `selectedSkill`, `inlineSkill`, `skillSelectionMode`, `selectorWarning` удалены из `ResearchService`
- `SkillRegistry`, `SkillSelectionService`, `buildSkillCatalogPrompt`, `resolveExplicitSkill` импорты удалены
- `validSkillCalls` функция удалена
- `skill-contract-violation` удалён из `AgenticFallbackReason`
- `diagnostics.skills` не заполняется
- `ResearchServiceOptions.skillRegistry` удалён
- `AnswerSynthesisService`: удалены `skillCatalog`, `selectedSkill`, `inlineSkill`, `toolsEnabled`, `skillToolResultChars` параметры
- Core-Vault skill инжектируется в system prompt `AnswerSynthesisService` когда `searchMode === "none"` и есть tool loop

---

### Task 7 — Удалить старые skill файлы + `isInternalSkillPath` [ ]

Files: `src/skills/SkillRegistry.ts` (delete), `src/skills/SkillSelectionService.ts` (delete), `src/skills/ObsidianSkillFileStore.ts` (delete), `src/skills/defaultSkills.ts` (delete), `src/shared/pathFilters.ts`, `src/research/tools/IndexResearchTool.ts`, `src/research/ContextAssembler.ts`, `src/main.ts`

Dependencies: Task 6

Acceptance:
- Файлы в `src/skills/` удалены (все четыре)
- `isInternalSkillPath` удалена из `pathFilters.ts`
- `isInternalSkillPath` импорт и использование удалены из `IndexResearchTool.ts`
- `isInternalSkillPath` импорт и использование удалены из `ContextAssembler.ts`
- `SkillRegistry` импорт и использование удалены из `main.ts`
- `isInternalSkillPath` импорт удалён из `main.ts`
- Проект компилируется без ошибок

---

### Task 8 — Удалить `SkillContextDiagnostics` из types + diagnostic formatting [ ]

Files: `src/shared/types.ts`, `src/ui/diagnosticFormatting.ts`

Dependencies: Task 7

Acceptance:
- `SkillContextDiagnostics` интерфейс удалён из `types.ts`
- `skills?: SkillContextDiagnostics` поле удалено из `ContextDiagnostics`
- `diagnosticFormatting.ts` не обращается к `diagnostics.skills`
- Проект компилируется без ошибок

---

### Task 9 — Vault migration: удалить `.ixplorer/skills/` при upgrade [ ]

Files: `src/main.ts`

Dependencies: Task 8

Acceptance:
- В `onload` плагина: если `.ixplorer/skills/` существует — перемещается в trash через `app.vault.adapter` или `vault.trash`
- Миграция выполняется тихо (нет уведомлений пользователю если папки нет)
- При ошибке trash — логируется в console, не бросает исключение
