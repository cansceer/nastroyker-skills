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

## Проектные навыки

- [Аудит сайтов StroykerBox](skills/stroykerbox-site-audit/SKILL.md) — проверка сайта в Microsoft Edge, CSS/JS, изображений, ссылок, форм и дизайн-кода без отправки данных.
- [Подключение и запуск](skills/stroykerbox-site-audit/README.md).
- [Профиль tsk-market.ru](skills/stroykerbox-site-audit/profiles/tsk-market.json).

Навык StroykerBox подключён к репозиторию через `.agents/skills/stroykerbox-site-audit`.
