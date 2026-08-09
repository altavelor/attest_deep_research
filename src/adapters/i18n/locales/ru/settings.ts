import type { EnSettingsMessages } from "../en/settings";

export const settings: EnSettingsMessages = {
  "settings.language.heading": "Язык",
  "settings.language.name": "Язык интерфейса",
  "settings.language.desc": "Язык интерфейса Ixplorer. Применяется без перезапуска Obsidian.",
  "settings.language.auto": "Автоматически (как в Obsidian)",

  "settings.tab.heading": "Ixplorer",
  "settings.tab.quickStart.title": "Быстрый старт",
  "settings.tab.quickStart.steps":
    "1. Добавьте сервер → 2. Добавьте чат-модель → 3. (необязательно) Добавьте индекс",
  "settings.tab.gateHint": "Сначала добавьте профиль чат-модели",

  "settings.advanced.debugMode.name": "Режим отладки",
  "settings.advanced.debugMode.desc":
    "Записывать в журнал детали запросов и ответов плагина. Ключи API скрываются.",

  "settings.retrieval.heading": "Поиск свидетельств",
  "settings.retrieval.desc":
    "Определяет, как Ixplorer ищет свидетельства в заметках, графе, индексе, документах и вебе перед ответом.",
  "settings.retrieval.graph.heading": "Граф Obsidian",
  "settings.retrieval.useLinkedNotes.name": "Использовать связанные заметки",
  "settings.retrieval.useLinkedNotes.desc":
    "Находить связанные заметки по @упоминаниям, активным файлам и вложениям до поиска свидетельств.",
  "settings.retrieval.includeBacklinks.name": "Учитывать обратные ссылки",
  "settings.retrieval.includeBacklinks.desc":
    "Использовать обратные ссылки на один шаг как кандидатов графа. Дальше такие заметки не обходятся.",
  "settings.retrieval.expandFilteredContextThroughLinks.name":
    "Расширять отфильтрованные файлы по ссылкам",
  "settings.retrieval.expandFilteredContextThroughLinks.desc":
    "Когда прикреплённые файлы в режиме фильтра, искать также по их соседям в графе ссылок.",
  "settings.retrieval.graphDepth.name": "Глубина графа",
  "settings.retrieval.graphDepth.desc":
    "Глубина 1 идёт по прямым ссылкам, встраиваниям и обратным ссылкам. Глубина 2 предназначена для продвинутой отладки.",
  "settings.retrieval.search.heading": "Поиск",
  "settings.retrieval.expandSearchQuery.name": "Расширять поисковый запрос",
  "settings.retrieval.expandSearchQuery.desc":
    "Создавать межъязыковые варианты запроса до поиска, чтобы находить заметки на других языках. Требует дополнительного обращения к чат-модели на каждый поиск.",
  "settings.retrieval.web.heading": "Веб",
  "settings.retrieval.useWebWhenFreshnessNeeded.name":
    "Использовать веб для вопросов об актуальном",
  "settings.retrieval.useWebWhenFreshnessNeeded.desc":
    "Выделять веб-свидетельствам больше бюджета, когда вопрос касается текущих, последних, ценовых или релизных сведений.",

  "settings.newChatDefaults.heading": "Настройки нового чата",
  "settings.newChatDefaults.desc":
    "Начальная конфигурация каждого нового чата. Сохранённые чаты сохраняют свои настройки.",
  "settings.newChatDefaults.source.name": "Источник по умолчанию",
  "settings.newChatDefaults.source.desc": "Источники свидетельств, с которых начинается новый чат.",
  "settings.newChatDefaults.source.none": "Нет",
  "settings.newChatDefaults.source.indexOnly": "Индекс",
  "settings.newChatDefaults.source.webOnly": "Веб",
  "settings.newChatDefaults.source.indexAndWeb": "Индекс + веб",
  "settings.newChatDefaults.index.name": "Индекс по умолчанию",
  "settings.newChatDefaults.index.desc":
    "Профиль индекса, с которого начинается новый чат; используется, когда источник включает индекс.",
  "settings.newChatDefaults.index.empty": "Нет доступных профилей индекса",
  "settings.newChatDefaults.mode.name": "Режим по умолчанию",
  "settings.newChatDefaults.mode.desc": "Режим исследования, с которого начинается новый чат.",
  "settings.newChatDefaults.mode.descBlocked":
    "Режим исследования, с которого начинается новый чат. {hint}",
  "settings.newChatDefaults.mode.thinkingUnavailable":
    "Для режима «Размышление» нужна чат-модель с подтверждённой возможностью агента. Проверьте возможности модели, чтобы включить его.",
  "settings.newChatDefaults.mode.instant": "Мгновенный",
  "settings.newChatDefaults.mode.thinking": "Размышление",
  "settings.newChatDefaults.model.name": "Модель по умолчанию",
  "settings.newChatDefaults.model.desc": "Профиль чат-модели, с которого начинается новый чат.",
  "settings.newChatDefaults.model.empty": "Нет доступных профилей чат-модели",
  "settings.newChatDefaults.activeFile.name": "Добавлять активный файл в контекст",
  "settings.newChatDefaults.activeFile.desc":
    "Автоматически добавлять открытый поддерживаемый файл как явный контекст чата.",

  "settings.webSources.heading": "Внешние источники",
  "settings.webSources.desc":
    "Внешний веб-поиск по включённым источникам, запускаемый пользователем. Ixplorer отправляет только введённый вопрос и никогда — содержимое хранилища.",
  "settings.webSources.count": "включено {enabled} из {total}",
  "settings.webSources.column.source": "Источник",
  "settings.webSources.column.actions": "Действия",
  "settings.webSources.column.state": "Состояние",
  "settings.webSources.categoryCount": "{category} · {enabled}/{total}",
  "settings.webSources.category.serp": "Общий веб-поиск",
  "settings.webSources.category.neural": "ИИ-поиск",
  "settings.webSources.category.academic": "Академические",
  "settings.webSources.category.encyclopedia": "Энциклопедии",
  "settings.webSources.category.community": "Разработка и сообщества",
  "settings.webSources.category.news": "Новости",
  "settings.webSources.category.fetch": "Запасная загрузка страницы",
  "settings.webSources.category.image": "Поиск изображений",
  "settings.webSources.activation.off": "Выключен",
  "settings.webSources.activation.auto": "Авто — используется, когда его выберет планировщик",
  "settings.webSources.activation.always": "Всегда — опрашивается при каждом веб-поиске",
  "settings.webSources.issue.unauthorized": "Учётные данные отклонены — проверьте ключ API",
  "settings.webSources.issue.rateLimited": "Превышен лимит запросов — повтор произойдёт позже",
  "settings.webSources.setUp": "Настроить…",
  "settings.webSources.setUpAria": "Настроить {source}",
  "settings.webSources.configure": "Настроить {source}",
  "settings.webSources.lampIssueTitle": "{issue} — нажмите, чтобы переключить на «{next}»",
  "settings.webSources.lampTitle": "{source}: {current} — нажмите, чтобы переключить на «{next}»",
  "settings.webSources.meta.required": "требуется: {fields}",
  "settings.webSources.meta.configured": "настроено",

  "settings.webSourceModal.title": "Настройка {source}",
  "settings.webSourceModal.info": "{note}. ",
  "settings.webSourceModal.providerDocs": "Документация провайдера",
  "settings.webSourceModal.field.optional": "Необязательно.",
  "settings.webSourceModal.field.required": "Обязательно для включения этого источника.",
  "settings.webSourceModal.imageSearch.name": "Использовать для поиска изображений",
  "settings.webSourceModal.imageSearch.desc":
    "По умолчанию выключено. Если включить, search_images сможет обращаться к поиску изображений этого движка, расходуя ту же квоту, что и текстовый поиск.",
  "settings.webSourceModal.disabledNotice":
    "{source} отключён: не хватает обязательных учётных данных.",
};
