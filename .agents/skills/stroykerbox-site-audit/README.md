# Аудит сайтов StroykerBox

Версия 1.0.4. Навык проверяет опубликованный сайт и выдаёт рекомендации. Он не ищет локальные исходники, не меняет сайт и не отправляет формы. **Все браузерные проверки — только Microsoft Edge.** Основная инструкция — [SKILL.md](SKILL.md). Профиль первого сайта — [profiles/tsk-market.json](profiles/tsk-market.json).

## Подключение

В этом репозитории пакет навыка находится непосредственно в `.agents/skills/stroykerbox-site-audit`, стандартной папке проектных навыков Codex. Отдельно подключать его через настройки не нужно. Откройте корень репозитория в Codex Desktop и начните новый чат: уже открытая сессия не получает новый навык автоматически.

Для другого локального проекта:

```bash
python3 /absolute/path/stroykerbox-site-audit/scripts/install.py --project /absolute/path/project
```

Codex Desktop, CLI и расширение Codex в VS Code используют пакет через проектные навыки. В ChatGPT пакет можно передать как инструкции/архив в среду, которая поддерживает файлы и браузерные инструменты. Обычный чат без исполнения кода/браузера не получает эти возможности от SKILL.md. Архив не является обещанием автоматической установки плагина ChatGPT.

Запрос: `Используй stroykerbox-site-audit. Проведи аудит https://tsk-market.ru/ по профилю tsk-market. Только проверка, без правок и отправки форм.`

## Инструменты

Нужны установленный Microsoft Edge, Node.js ≥22 и Playwright. Для контактных листов — Python 3 и Pillow. Сначала проверьте доступный Edge, затем при необходимости установите зависимости пакета:

```bash
npm install
python3 -m pip install -r requirements.txt
```

Скрипты запускают канал `msedge`. Для нестандартного расположения задайте `AUDIT_EDGE_EXECUTABLE` — полный путь к настоящему Edge. На Linux идентичность исполняемого файла проверяется через `--version`. Если Edge не найден, аудит останавливается: запасной браузер не запускается.

Edge облачной среды — отдельная браузерная сессия. Подготовка Edge здесь не подключает браузер, открытые вкладки, cookies или OneDrive вашего компьютера.

Сбор доказательств:

```bash
node scripts/audit.cjs --profile profiles/tsk-market.json --output /absolute/path/audit-results
node scripts/audit.cjs --profile profiles/tsk-market.json --output /absolute/path/audit-results --resume
node scripts/check-links.cjs --profile profiles/tsk-market.json --input /absolute/path/audit-results --output /absolute/path/audit-results/links.json
python3 scripts/image-review.py --input /absolute/path/audit-results/assets --output /absolute/path/audit-results/image-review
```

Сборщик сохраняет исходный HTML и отрисованную разметку каждой страницы в `markup/`, а подключённые CSS/JS — в `sources/`. Проверь `sourceCaptureComplete` и `sourceCaptureFailures` в `manifest.json`, затем прочитай все успешно сохранённые файлы; локальные копии не ищи. Inline CSS/JS содержится в HTML. Скрипты анализируй как текст, не исполняй отдельно. Ограничения размера и ошибки загрузки указаны в manifest.

Один инпут, ввод и очистка без отправки и без динамических запросов во время ввода:

```bash
node scripts/probe-input.cjs --profile profiles/tsk-market.json --url https://tsk-market.ru/ --selector 'input[name="q"]' --width 390 --output /absolute/path/audit-results/input-probe.json
```

Сначала проверьте существование/назначение селектора; это пример, не утверждение о текущем HTML tsk-market.ru. Для checkbox/select/масок/автозаполнения нужен дополнительный ручной проход с тем же запретом мутаций. Блокировка отправки может влиять на компоненты: такие результаты фиксируются как ограничения, а не ошибки сайта.

Автоматические findings имеют статус `candidate`. После просмотра/воспроизведения агент отмечает `confirmed` или `rejected`, добавляет проверенное действие и происхождение CMS. Только confirmed попадают в итоговый файл `checklist.md`: три раздела в порядке «Визуальные ошибки и дизайн» → «Вёрстка, стили и орфография» → «Глобальные проблемы», внутри — по P1 → P2 → P3. В каждом чекбоксе указываются исполнитель, точная ссылка на страницу, а для находки по файлу — точная ссылка на ресурс. Для отсутствующего description перечисляются конкретные страницы.

Проверка ссылок включает адреса повторяемых товаров за пределами визуальной выборки. Внешние назначения можно включить `--external` при разрешённом доступе. HEAD/GET не подтверждают смысл назначения; 401/403/429 требуют выяснить причину. `links.json` дополняет findings.json после проверки агентом.

```bash
node scripts/render-report.cjs --input /absolute/path/audit-results/findings.json --manifest /absolute/path/audit-results/manifest.json --coverage /absolute/path/audit-results/coverage.json --output /absolute/path/audit-results/checklist.md
```

Аудит не завершён после запуска скрипта. Агент обязан проверить скриншоты, разрешённые действия, орфографию и содержимое изображений, а затем заполнить coverage. Исходный runtime не меняет `auditComplete` на true самостоятельно.

## Документация CMS

Первоначальный URL: https://box7.nastroyker.ru/api/v1/docs/. Дополнительный URL пользователя: https://stroybaza-samara.ru/api/v1/docs/.

Учётные данные не входят в пакет. Если документация использует HTTP Basic и сеть разрешает доступ, можно безопасно получить GET-ответ с вводом логина/пароля через скрытый prompt:

```bash
python3 scripts/fetch-docs.py --url https://stroybaza-samara.ru/api/v1/docs/ --output /absolute/path/private-docs/cms-docs.html
```

Этот скрипт не реализует форму входа и не гарантирует тип авторизации. Проверить ответ прежде, чем применять его как описание CMS. Не публиковать private-docs. В среде создания обоих URL доступ не получен; авторизация не проверена, данные CMS не выдуманы.

Документация открывается через Microsoft Edge. Python только запрашивает данные скрытым вводом и передаёт их процессу Edge через закрытый stdin; логин/пароль не записываются в файлы, аргументы запуска или переменные окружения.

## Расширения

Внешняя проверка происхождения изображений и серверный Netdata — дополнительные инструменты при доступности. Дополнительный измеритель скорости разрешён только если работает с Edge и не запускает иной браузер. Правила проекта важнее чужих эстетических навыков. Основания: [references/sources.md](references/sources.md).

## Проверка пакета

```bash
npm test
```

Интеграционный стенд проверяет настоящий DOM в Microsoft Edge: относительные/абсолютные адреса, h1, контраст, HTML-ответ и отрисованную разметку, сохранение подключённых CSS/JS, размер/хеши картинок, порядок ширин, запрет POST и GET-действий, поля без отправки, частичный обход и отчёт только из подтверждённых находок. Отдельные проверки запрещают запуск другого браузера и fallback после ошибки Edge. Это проверка инструментов, не аудит живого сайта.
