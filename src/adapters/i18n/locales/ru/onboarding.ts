import type { EnOnboardingMessages } from "../en/onboarding";

export const onboarding: EnOnboardingMessages = {
  "onboarding.title": "Настройка Attest",
  "onboarding.progress": "Шаг {step} из {total}",
  "onboarding.scope.pickOne": "Выберите вариант, чтобы продолжить",

  "onboarding.action.back": "Назад",
  "onboarding.action.skip": "Пропустить и настроить вручную",
  "onboarding.action.continue": "Продолжить",
  "onboarding.action.checking": "Проверка…",
  "onboarding.action.startIndexing": "Начать индексацию",
  "onboarding.action.finish": "Завершить",
  "onboarding.action.openChat": "Открыть чат",
  "onboarding.action.addVaultLater": "Добавить поиск по заметкам позже",
  "onboarding.action.keepIndexing": "Индексировать в фоне",

  "onboarding.chat.title": "Провайдер и модель чата",
  "onboarding.chat.intro":
    "Attest создаст профили по ходу настройки. Всё это можно изменить позже в настройках плагина.",

  "onboarding.endpoint.provider.name": "Провайдер",
  "onboarding.endpoint.provider.chatDesc":
    "Заполняет базовый URL и формат API. Модель эмбеддингов может использовать другой.",
  "onboarding.endpoint.provider.embeddingDesc":
    "Модель эмбеддингов может находиться на другом сервере, чем модель чата.",
  "onboarding.endpoint.baseUrl.name": "Базовый URL",
  "onboarding.endpoint.baseUrl.desc":
    "Заполняется провайдером. Измените его для собственного сервера.",
  "onboarding.endpoint.apiKey.name": "Ключ API (необязательно)",
  "onboarding.endpoint.apiKey.desc":
    "Хранится в настройках плагина этого хранилища. Локальным провайдерам он не нужен.",
  "onboarding.endpoint.connection.name": "Подключение",
  "onboarding.endpoint.connection.action": "Проверить подключение",
  "onboarding.endpoint.connection.desc":
    "Загрузите список моделей, чтобы убедиться, что сервер отвечает.",
  "onboarding.endpoint.connection.testing": "Обращение к провайдеру…",
  "onboarding.endpoint.connection.mobileLocal":
    "Локальные провайдеры моделей недоступны в Obsidian Mobile. Выберите облачного провайдера.",
  "onboarding.endpoint.model.chatName": "Модель чата",
  "onboarding.endpoint.model.embeddingName": "Модель эмбеддингов",
  "onboarding.endpoint.model.desc": "Этой роли соответствует моделей: {count}.",
  "onboarding.endpoint.model.empty": "Проверьте подключение, чтобы загрузить список моделей.",
  "onboarding.endpoint.model.placeholder": "Выберите модель",
  "onboarding.endpoint.model.testing": "Проверка",

  "onboarding.scope.title": "Откуда брать ответы?",
  "onboarding.scope.intro":
    "Это единственный выбор, который меняет объём оставшейся настройки. Для поиска по хранилищу нужны модель эмбеддингов и индекс; для веба не нужно ни то, ни другое.",
  "onboarding.scope.notesAndWeb.name": "Мои заметки и веб",
  "onboarding.scope.notesAndWeb.desc":
    "Полный вариант. Ещё два шага: модель эмбеддингов, затем папки для индексации.",
  "onboarding.scope.webOnly.name": "Только веб",
  "onboarding.scope.webOnly.desc":
    "Ответы со ссылками на открытый веб плюс та заметка, что сейчас открыта. Ни индекса, ни модели эмбеддингов. DuckDuckGo уже включён и не требует ключа.",
  "onboarding.scope.notesOnly.name": "Только мои заметки",
  "onboarding.scope.notesOnly.desc":
    "Хранилище не покидает ничего, кроме самого вопроса, отправленного вашей модели чата.",
  "onboarding.scope.remaining.two": "Осталось 2 шага",
  "onboarding.scope.remaining.none": "После этого всё готово",

  "onboarding.embedding.title": "Модель, читающая ваши заметки",
  "onboarding.embedding.intro":
    "Здесь можно выбрать другого провайдера, чем для чата: частая связка — облачная модель чата и локальные эмбеддинги, чтобы текст заметок не покидал компьютер.",
  "onboarding.embedding.sameAsChat.name": "Тот же сервер, что и у модели чата",
  "onboarding.embedding.previousProvider": "ранее: как для чата ({provider})",
  "onboarding.embedding.sameAsChat.desc":
    "Отключите, чтобы считать эмбеддинги на другом сервере. Тогда будет создан второй профиль сервера.",
  "onboarding.embedding.rebuildWarning":
    "Смена этой модели позже потребует перестроить индекс: векторы двух моделей несопоставимы.",
  "onboarding.embedding.unverified":
    "Не удалось подтвердить поддержку эмбеддингов. Модель чата уже работает, поэтому можно завершить настройку с вебом и добавить поиск по хранилищу позже.",
  "onboarding.embedding.useWebInstead": "Использовать веб вместо этого",

  "onboarding.folders.title": "Какие заметки может читать Attest?",
  "onboarding.folders.intro": "Индексируются только эти папки, и только на них можно ссылаться.",
  "onboarding.folders.mode.name": "Папки",
  "onboarding.folders.mode.desc":
    "Начните с малого — расширить охват позже дёшево, это добавочное обновление.",
  "onboarding.folders.mode.wholeVault": "Всё хранилище",
  "onboarding.folders.mode.selected": "Выбранные папки",
  "onboarding.folders.paths.name": "Выбрано",
  "onboarding.folders.paths.action": "Выбрать папки…",
  "onboarding.folders.paths.empty": "Пока ничего не выбрано.",
  "onboarding.folders.paths.remove": "Убрать {path}",
  "onboarding.folders.excluded.name": "Исключено",
  "onboarding.folders.excluded.desc": "Заполнено заранее.",
  "onboarding.folders.location.name": "Расположение индекса",
  "onboarding.folders.location.desc":
    "Внутри хранилища, чтобы индекс синхронизировался с заметками.",
  "onboarding.folders.location.outsideVault":
    "Индекс должен оставаться внутри хранилища. Уберите сегменты «..» и ведущий слеш.",
  "onboarding.folders.mobileWarning":
    "На мобильном первая сборка идёт медленно: малые пакеты, по одной странице PDF за раз, большие PDF пропускаются. Соберите индекс на компьютере и синхронизируйте либо выберите пока путь только через веб.",

  "onboarding.finish.web.title": "Веб-исследование готово",
  "onboarding.finish.web.status": "2 профиля · без ожидания",
  "onboarding.finish.vault.title": "Идёт индексация заметок",
  "onboarding.finish.vault.status": "выполняется в фоне",
  "onboarding.finish.vault.doneTitle": "Поиск по заметкам готов",
  "onboarding.finish.vault.doneStatus": "индексация завершена",
  "onboarding.finish.vault.errorTitle": "Индексация прервана",
  "onboarding.finish.vault.errorStatus": "индексация не удалась",
  "onboarding.finish.tag.server": "Профиль сервера",
  "onboarding.finish.tag.chat": "Модель чата",
  "onboarding.finish.tag.embedding": "Модель эмбеддингов",
  "onboarding.finish.tag.index": "Профиль индекса",
  "onboarding.finish.stats.files": "{scanned} / {total} файлов",
  "onboarding.finish.stats.chunks": "{embedded} / {total} фрагментов",
  "onboarding.finish.webIntro":
    "Индексировать нечего, поэтому настройка закончена. Задайте вопрос, и ответ будет ссылаться на использованные веб-страницы.",
  "onboarding.finish.vaultIntro":
    "Чат откроется сейчас; ответы по хранилищу будут точнее по мере обработки фрагментов. Индекс продолжит строиться, даже если закрыть это окно.",
  "onboarding.finish.vaultDoneIntro":
    "Все выбранные заметки проиндексированы. Задайте вопрос — ответ будет ссылаться на использованные заметки.",
  "onboarding.finish.vaultErrorIntro":
    "Модель чата работает, начать можно уже сейчас. Откройте профиль индекса в настройках, чтобы увидеть причину и запустить сборку заново.",
  "onboarding.finish.indexingStarting": "Запуск первой сборки индекса…",

  "command.runSetup": "Запустить первоначальную настройку",
};
