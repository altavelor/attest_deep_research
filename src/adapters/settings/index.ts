// Публичный API модуля adapters/settings — типы настроек, дефолты, нормализация,
// парсеры, запросы к профилям, пробы возможностей моделей, connection-тесты,
// персистентность и логгер. Внешние потребители импортируют `@adapters/settings`.
//
// Это плоский пакет настроек: каждый файл независимо потребляется снаружи (нет
// внутреннего оркестратора и приватного подмножества), поэтому здесь уместен
// пофайловый `export *`. Коллизий имён между файлами нет (проверяет `tsc`).
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export * from "./capabilityMetadataResolver";
export * from "./capabilityPresentation";
export * from "./chatProfileProbes";
export * from "./connectionTests";
export * from "./constants";
export * from "./debugLogger";
export * from "./defaults";
export * from "./modelCapabilityCache";
export * from "./modelContext";
export * from "./normalization";
export * from "./parsers";
export * from "./persistence";
export * from "./privacyCopy";
export * from "./profileQueries";
export * from "./reasoningVisibilityProbe";
export * from "./responsesCapabilityProbe";
export * from "./toolCapabilities";
export * from "./toolCapabilityProbe";
export * from "./types";
export * from "./webSourceQueries";
