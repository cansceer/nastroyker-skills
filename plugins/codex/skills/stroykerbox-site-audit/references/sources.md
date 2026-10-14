# Что заимствовано и что не подключено

Источники изучены 2026-10-14. Код сторонних проектов в пакет не скопирован; агенты/платформы не устанавливались. Это самостоятельная реализация правил пользователя.

- https://github.com/Leonxlnx/taste-skill — полезны просмотр в реальном браузере, цикл screenshot → review, проверка отступов/состояний/иерархии. Эстетические предписания, смена бренда и автоматические исправления не перенесены.
- https://github.com/NousResearch/hermes-agent — идея сохранять опыт в явных профилях; отдельный runtime не нужен.
- https://github.com/bytedance/deer-flow — браузерное действие важнее простого web-fetch; отдельная оркестрация не подключена.
- https://github.com/netdata/netdata — возможное расширение серверной диагностики при доступе; не требуется для навыка.
- https://github.com/thedotmack/claude-mem — сохранение решений; заменено проверяемыми локальными профилями/исключениями.
- https://open-design.ai/ru/codex-plugin/ — инструмент создания дизайна, не зависимость аудита.
- https://github.com/hashgraph-online/awesome-codex-plugins — каталог, не зависимость.
- https://playwright.dev/docs/emulation — viewport/touch/движки браузеров.
- https://developer.chrome.com/docs/lighthouse/overview — необязательный расширенный performance/SEO проход только при подключении к Edge без запуска другого браузера.
- https://github.com/dequelabs/axe-core — необязательные автоматические кандидаты доступности.
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html — контраст текста/placeholder.

Внешние навыки не получают права изменять сайт, слать формы или менять дизайн-код. Правила владельца сайта имеют приоритет.
