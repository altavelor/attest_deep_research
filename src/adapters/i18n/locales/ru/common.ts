import type { EnCommonMessages } from "../en/common";

export const common: EnCommonMessages = {
  "common.cancel": "Отмена",
  "common.save": "Сохранить",
  "common.close": "Закрыть",
  "common.advanced": "Дополнительно",
  "common.unknownError": "Неизвестная ошибка",
  "common.copiedToClipboard": "Скопировано в буфер обмена.",
  "common.pdfPage": "стр. {page}",

  "profile.error.chatModelMissing": "Выберите профиль чат-модели, прежде чем задавать вопрос.",
  "profile.error.embeddingModelMissing":
    "Выберите профиль модели эмбеддингов, прежде чем использовать этот индекс.",
  "profile.error.serverUnavailable": "Выбранный профиль сервера недоступен.",
  "profile.error.indexNotBuilt":
    "Проиндексируйте этот профиль, прежде чем использовать его в чате или поиске.",
  "profile.error.indexUnavailable": "Выбранный профиль индекса недоступен.",
  "profile.warning.indexNotSelected":
    "Выберите проиндексированный профиль в настройках Ixplorer перед поиском.",
  "profile.warning.embeddingProfileUnavailable":
    "Профиль модели эмбеддингов выбранного индекса недоступен. Обновите его в настройках Ixplorer.",
  "profile.warning.embeddingProfileSuspended":
    "Профиль модели эмбеддингов выбранного индекса приостановлен. Обновите его в настройках Ixplorer.",
  "profile.warning.embeddingNotSupported":
    "Модель эмбеддингов выбранного индекса не умеет создавать эмбеддинги. Обновите её в настройках Ixplorer.",
  "profile.warning.embeddingServerUnavailable":
    "Сервер эмбеддингов выбранного индекса недоступен. Обновите его в настройках Ixplorer.",
};
