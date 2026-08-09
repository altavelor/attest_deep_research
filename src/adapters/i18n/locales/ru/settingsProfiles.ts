import type { EnSettingsProfilesMessages } from "../en/settingsProfiles";

export const settingsProfiles: EnSettingsProfilesMessages = {
  "settings.status.suspended": "Приостановлен",

  "settings.profileList.addAction": "Добавить {title}",
  "settings.profileList.column.profile": "Профиль",
  "settings.profileList.column.status": "Статус",
  "settings.profileList.column.actions": "Действия",
  "settings.profileList.editAction": "Изменить профиль",
  "settings.profileList.tag.agent": "Агент",
  "settings.profileList.tag.tools": "Инструменты",
  "settings.profileList.tag.instant": "Мгновенный",

  "settings.capability.status": "{tools} · {agent}",
  "settings.capability.entry": "{subject}: {phase}",
  "settings.capability.subject.tools": "поддержка инструментов",
  "settings.capability.subject.agent": "поддержка режима агента",
  "settings.capability.phase.testing": "Проверка…",
  "settings.capability.phase.verified": "Подтверждено",
  "settings.capability.phase.notVerified": "Не подтверждено",
  "settings.capability.phase.failed": "Ошибка",
  "settings.capability.phase.notTested": "Не проверялось",

  "settings.models.heading": "Профили моделей",
  "settings.models.desc":
    "Настройте адреса провайдеров и использующие их чат-модели или модели эмбеддингов.",
  "settings.models.server.title": "Профили серверов",
  "settings.models.server.deleteTooltip": "Удалить профиль сервера",
  "settings.models.server.deleteBlockedTooltip": "Сначала удалите зависимые профили моделей",
  "settings.models.server.deleteBlockedNotice": "Сначала удалите зависимые профили моделей.",
  "settings.models.chat.title": "Профили чат-моделей",
  "settings.models.chat.deleteTooltip": "Удалить профиль чат-модели",
  "settings.models.chat.testingLabel": "Проверка возможностей…",
  "settings.models.chat.testingNotice": "Проверка возможностей профиля {profile}.",
  "settings.models.embedding.title": "Профили моделей эмбеддингов",
  "settings.models.embedding.deleteTooltip": "Удалить профиль модели эмбеддингов",
  "settings.models.embedding.deleteBlockedTooltip":
    "Эта модель эмбеддингов используется профилем индекса",
  "settings.models.embedding.deleteBlockedNotice":
    "Эта модель эмбеддингов используется профилем индекса.",
  "settings.models.embedding.defaultBadge": "По умолчанию",
  "settings.models.embedding.defaultBadgeTitle": "Модель эмбеддингов по умолчанию",
  "settings.models.embedding.defaultAction": "Модель по умолчанию",
  "settings.models.embedding.setDefaultAction": "Сделать моделью по умолчанию",

  "settings.prober.capabilityDetectionFailed":
    "Не удалось определить возможности профиля {profile}.",
  "settings.prober.toolCapabilityDetectionFailed":
    "Не удалось определить поддержку инструментов у профиля {profile}.",
  "settings.prober.agentCapabilityDetectionFailed":
    "Не удалось определить поддержку режима агента у профиля {profile}.",

  "settings.profileModal.error.requiredFields": "Заполните все обязательные поля.",
  "settings.profileModal.error.nameLength": "Имя должно содержать от 1 до {max} символов.",
  "settings.profileModal.error.nameUnique": "Имя должно быть уникальным.",

  "settings.serverModal.editTitle": "Изменить профиль сервера",
  "settings.serverModal.addTitle": "Добавить профиль сервера",
  "settings.serverModal.name.name": "Имя",
  "settings.serverModal.name.desc":
    "Понятное имя, которое показывается в настройках и списках моделей. Не более {max} символов.",
  "settings.serverModal.apiFormat.name": "Формат API",
  "settings.serverModal.apiFormat.desc": "Формат запросов и ответов этого провайдера.",
  "settings.serverModal.apiFormat.openaiCompatible": "Совместимый с OpenAI",
  "settings.serverModal.apiFormat.ollama": "Ollama",
  "settings.serverModal.apiFormat.anthropic": "Anthropic",
  "settings.serverModal.baseUrl.name": "Базовый URL",
  "settings.serverModal.baseUrl.desc":
    "Адрес провайдера, например базовый URL API OpenRouter, Ollama или Anthropic.",
  "settings.serverModal.apiKey.name": "Ключ API",
  "settings.serverModal.apiKey.desc":
    "Необязательно. Используется как bearer-токен для провайдеров, требующих аутентификации.",

  "settings.modelProfileModal.editTitle.chat": "Изменить профиль чат-модели",
  "settings.modelProfileModal.editTitle.embedding": "Изменить профиль модели эмбеддингов",
  "settings.modelProfileModal.addTitle.chat": "Добавить профиль чат-модели",
  "settings.modelProfileModal.addTitle.embedding": "Добавить профиль модели эмбеддингов",
  "settings.modelProfileModal.name.name": "Имя",
  "settings.modelProfileModal.name.desc":
    "Понятное имя, которое показывается в настройках и элементах управления чата. Не более {max} символов.",
  "settings.modelProfileModal.server.name": "Сервер",
  "settings.modelProfileModal.server.desc": "Адрес провайдера для обращения к этой модели.",
  "settings.modelProfileModal.model.name": "Модель",
  "settings.modelProfileModal.model.desc": "Имя модели, полученное от выбранного профиля сервера.",
  "settings.modelProfileModal.model.placeholder":
    "Загрузите модели, затем вводите текст для фильтрации",
  "settings.modelProfileModal.model.fetch": "Загрузить",
  "settings.modelProfileModal.model.empty": "Подходящих моделей нет",
  "settings.modelProfileModal.temperature.name": "Температура",
  "settings.modelProfileModal.temperature.desc":
    "Необязательно. Управляет случайностью ответа; пустое значение — по умолчанию провайдера или приложения.",
  "settings.modelProfileModal.maxTokens.name": "Максимум токенов",
  "settings.modelProfileModal.maxTokens.desc":
    "Необязательно. Ограничивает длину ответа; пустое значение — по умолчанию провайдера или модели, а для Anthropic 4096.",
  "settings.modelProfileModal.contextSize.name": "Размер контекста",
  "settings.modelProfileModal.contextSize.desc":
    "Необязательный лимит токенов. Заполняется из метаданных модели, когда они доступны, и используется для соблюдения контекстного окна чата.",
  "settings.modelProfileModal.error.selectServer": "Сначала выберите профиль сервера.",
  "settings.modelProfileModal.error.activeServer": "Выберите активный профиль сервера.",
  "settings.modelProfileModal.error.fetchModels":
    "Загрузите модели, прежде чем создавать профиль модели.",
  "settings.modelProfileModal.error.reasoningEffort":
    "Глубина рассуждения должна быть значением провайдера по умолчанию или подтверждённой возможностью.",
  "settings.modelProfileModal.error.reasoningSummary":
    "Краткие изложения рассуждений не подтверждены для этого профиля.",

  "settings.capabilityControls.heading": "Возможности",
  "settings.capabilityControls.testTooltip": "Проверить возможности — {status}",
  "settings.capabilityControls.retestTooltip": "Проверить возможности заново — {status}",
  "settings.capabilityControls.agentic.name": "Режим агента",
  "settings.capabilityControls.agentic.desc": "Включить подтверждённую поддержку режима агента.",
  "settings.capabilityControls.effort.name": "Глубина рассуждения",
  "settings.capabilityControls.effort.desc":
    "Значение «Авто» использует настройку провайдера по умолчанию или подтверждённое значение.",
  "settings.capabilityControls.effort.auto": "Авто",
  "settings.capabilityControls.effort.enableAgentic":
    "Включите режим агента, чтобы выбрать глубину рассуждения.",
  "settings.capabilityControls.tools.name": "Инструменты",
  "settings.capabilityControls.tools.desc":
    "Разрешить этой модели вызывать инструменты заметок — читать, искать и (при доступе на запись) изменять заметки хранилища. Инструменты индекса и веб-исследования в режиме «Размышление» управляются отдельно.",
  "settings.capabilityControls.notVerified": "Не подтверждено проверкой возможностей.",
  "settings.capabilityControls.notTested": "Ещё не проверялось.",
};
