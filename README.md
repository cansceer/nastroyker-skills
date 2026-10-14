# nastroyker-skills

Личное хранилище проектных навыков и плагинов.

## Плагины

- [Комплекты баннеров для соцсетей](plugins/social-banner-kit/skills/social-banner-kit/SKILL.md) — Codex-плагин с одним встроенным навыком для создания и адаптации баннеров.
- Каталог плагинов: [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json).

Добавить репозиторий как marketplace в Codex CLI:

```sh
codex plugin marketplace add cansceer/nastroyker-skills
codex plugin marketplace list
```

В ChatGPT desktop после добавления источника перезапусти приложение, открой Plugins Directory и установи **Nastroyker Skills → social-banner-kit**.

Установить аудит StroykerBox в Codex Desktop через окно добавления маркетплейса:

- **Источник:** `https://github.com/cansceer/nastroyker-skills.git`
- **Git ref:** `main`
- **Выборочные пути:** `plugins/codex`

После добавления маркетплейса открой каталог плагинов и установи **Nastroyker Skills → stroykerbox-site-audit**. Плагин содержит навык и его скрипты. Альтернативно навык доступен как проектный при открытии самого репозитория в Codex.

## Проектные навыки

- [Аудит сайтов StroykerBox](.agents/skills/stroykerbox-site-audit/SKILL.md) — обязательный Microsoft Edge, проверка исходников CSS/JS без запуска пользовательского JS, полный порядок проверки при 2550 px, на мобильных ширинах и брейкпоинтах; изображения, ссылки, поля, дизайн-код; два рабочих чеклиста без правок и отправки форм.
- [Подключение и запуск](.agents/skills/stroykerbox-site-audit/README.md).
- [Профиль tsk-market.ru](.agents/skills/stroykerbox-site-audit/profiles/tsk-market.json).

## Как открыть навык в Codex Desktop

Навык уже лежит в стандартной папке `.agents/skills/` этого репозитория. Отдельно добавлять его через настройки или каталог плагинов не нужно.

1. Если GitHub Desktop ещё не установлен, скачайте его с [desktop.github.com](https://desktop.github.com/).
2. В GitHub Desktop выберите **File → Clone repository → URL** и вставьте `https://github.com/cansceer/nastroyker-skills.git`. Выберите папку, куда сохранить репозиторий.
3. В Codex Desktop откройте **Open project** (или **Open folder**) и выберите созданную папку `nastroyker-skills`.
4. Начните **новый чат** внутри этого проекта и отправьте: `Используй навык stroykerbox-site-audit. Проведи аудит https://tsk-market.ru/ по профилю tsk-market. Только проверка, без правок и отправки форм.`

Если репозиторий уже клонирован, в GitHub Desktop нажмите **Fetch origin**, затем **Pull origin**, после чего откройте эту папку в Codex и начните новый чат. В текущий уже открытый чат навык задним числом не добавляется.
