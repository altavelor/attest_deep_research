# Ixplorer

Ixplorer — local-first research assistant для Obsidian Desktop. Он ищет по выбранной части vault,
формирует ответы с цитатами и при необходимости использует настроенный web search.

Техническая документация для разработки, сборки и выпуска находится в
[Technical reference](docs/technical-reference.md).

## Перед началом

- Ixplorer работает в Obsidian Desktop. Мобильные приложения пока не поддерживаются.
- Для чата нужен локальный или облачный LLM provider.
- Для поиска по vault нужна embedding model.
- Облачные provider'ы требуют ваш API key; локальные Ollama и LM Studio могут работать без него.

## Установка

Установите Ixplorer через **Settings → Community plugins** в Obsidian, когда плагин доступен в
каталоге. Затем включите его и откройте **Settings → Ixplorer**.

## Быстрый старт

1. Создайте **Server profile** для chat и embeddings provider.
2. Создайте **Chat model profile** и выберите server profile и модель.
3. Создайте **Embedding model profile**.
4. Создайте или выберите **Index profile**, укажите папки vault для индексации и embedding model.
5. Запустите индексацию и дождитесь статуса completed.
6. Откройте Ixplorer chat, выберите index profile и задайте вопрос.

Если один из шагов недоступен, откройте соответствующий раздел Settings: Ixplorer показывает
статус модели и index profile.

## Настройка provider'ов

### Ollama

1. Запустите Ollama и загрузите chat и embedding models.
2. В Server profile выберите формат `ollama` и укажите адрес Ollama.
3. Создайте chat profile и embedding profile на этом server profile.

### LM Studio и другие OpenAI-compatible provider'ы

1. Запустите совместимый сервер и загрузите chat model.
2. В Server profile выберите формат `openai-compatible`.
3. Укажите URL и API key, если provider его требует.
4. Выберите model ID, который сообщает сервер.

### Anthropic и другие облачные provider'ы

1. Создайте Server profile с соответствующим API format и endpoint.
2. Введите API key только в поле настроек Ixplorer.
3. Создайте отдельные chat и embedding profiles, если provider использует разные модели.

Проверьте подключение кнопкой проверки в настройках профиля до первой индексации.

## Индексация vault

Index profile определяет, какие заметки Ixplorer может использовать как локальные источники.

- Выберите нужные папки; `/` означает весь vault.
- Исключите служебные или приватные каталоги через glob patterns.
- Запустите manual index для первого построения.
- Используйте incremental refresh после изменений заметок; rebuild пересоздаёт локальный index.
- Индексацию можно остановить и затем запустить снова.

Ixplorer поддерживает Markdown, TXT, PDF, EPUB, FB2 и DOCX. Для сканированных PDF без текстового
слоя OCR пока недоступен.

## Режимы исследования

### Instant

Быстрый режим для локального retrieval и моделей без tool calling или reasoning. Выберите его,
когда нужен предсказуемый короткий ответ либо модель не прошла capability check.

### Thinking

Многошаговый режим для совместимых моделей. Он может искать дополнительные источники и показывает
ход работы в chat. Если модель не поддерживает нужные capabilities, Ixplorer сообщает причину и
переходит в Instant.

Deep Research — будущий отдельный режим, не входящий в текущий стабильный пользовательский flow.

## Работа с ответами

- Задайте вопрос в chat и при необходимости выберите index-only, index-and-web или web-only scope.
- Открывайте citations, чтобы перейти к заметке, заголовку, PDF page или canonical web URL.
- Unknown и unverified citations отображаются как предупреждения.
- Сохраняйте ответ в новую заметку или добавляйте его к active note. Существующий файл не
  перезаписывается без явного действия.

## Web search и приватность

Web search выключен по умолчанию. При включении внешний search provider получает только введённый
вопрос; retrieved vault content и embeddings ему не передаются. Chat и embedding provider получают
только данные, нужные для выбранного пользователем запроса.

Note mutations выключены по умолчанию. Включайте их только для доверенной модели и vault.

## Diagnostics и устранение неполадок

Diagnostic report в toolbar помогает при проблемах с provider, index или research flow. Перед
отправкой отчёта убедитесь, что он не содержит приватных заметок, и никогда не прикладывайте API key.

| Проблема                | Что сделать                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- |
| Chat model недоступна   | Проверьте URL, API key и model ID; затем запустите проверку подключения.      |
| Index пуст              | Выберите embedding profile, проверьте включённые папки и запустите index run. |
| Thinking недоступен     | Перепроверьте capabilities модели или выберите Instant.                       |
| Web request не удался   | Отключите web search для vault-only ответа или проверьте настройки источника. |
| Citation не открывается | Убедитесь, что исходный файл не был удалён или перемещён.                     |

Сообщайте об уязвимостях по [Security policy](SECURITY.md), а о воспроизводимых ошибках — через
GitHub Issues с diagnostic report без секретов и приватного содержимого.

## Ограничения

- Только Obsidian Desktop.
- Нет OCR для сканированных PDF и анализа изображений/графиков.
- Web search использует только настроенные источники и может быть полностью выключен.
- Deep Research, очереди с возобновлением и отдельный report exporter пока не доступны.
