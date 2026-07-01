// Публичный API модуля shared — платформенно-независимые утилиты: type-guards,
// парсинг LLM-JSON, числа, фильтры путей vault, нормализация пробелов.
// Внешние потребители импортируют `@shared`. Чистый leaf-утиль → `export *`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export * from "./guards";
export * from "./llmOutput";
export * from "./numbers";
export * from "./pathFilters";
export * from "./whitespace";
