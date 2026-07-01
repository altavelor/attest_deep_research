// Машинно-проверяемые архитектурные инварианты (AGENTS.md §1, §2).
// Заменяет grep-проверки из AGENTS.md §1 и добавляет детект циклов импортов.
// Запуск: npm run depcruise
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Рантайм-циклы импортов запрещены (AGENTS.md §2 — ацикличность). " +
        "viaOnly исключает циклы, замкнутые только через `import type` — они стираются компилятором и рантайм-цикла не образуют.",
      severity: "error",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "no-circular-type-only",
      comment:
        "Цикл по type-only импортам: рантайм-безопасен, но это двунаправленная связанность модулей. " +
        "Кандидат на вынос общего типа в leaf-модуль (AGENTS.md §2). Не блокирует сборку.",
      severity: "info",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypes: ["type-only"] } },
    },
    {
      name: "core-stays-inner",
      comment: "core → application/adapters/apps запрещено: внутренний слой не знает о внешних (AGENTS.md §1).",
      severity: "error",
      from: { path: "^src/core/" },
      to: { path: "^src/(application|adapters|apps)/" },
    },
    {
      name: "application-no-outer",
      comment: "application → adapters/apps запрещено: зависимости только внутрь, к core (AGENTS.md §1).",
      severity: "error",
      from: { path: "^src/application/" },
      to: { path: "^src/(adapters|apps)/" },
    },
    {
      name: "adapters-no-apps",
      comment: "adapters → apps запрещено (AGENTS.md §1).",
      severity: "error",
      from: { path: "^src/adapters/" },
      to: { path: "^src/apps/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Учитывать paths-алиасы (@core/* и т.п.) и type-only импорты при анализе.
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".js", ".json"],
    },
  },
};
