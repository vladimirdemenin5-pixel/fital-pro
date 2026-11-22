# Fital Pro

Персональный сервис питания и фитнеса на существующем Cloudflare Worker `red-waterfall-2af8`.

## Архитектура

- Frontend: `public/` (HTML, CSS, JavaScript).
- API и серверная логика: `_worker.js`.
- Workers AI: binding `AI`, модель `@cf/google/gemma-4-26b-a4b-it`.
- D1: binding `DB`, база `fital-pro-db`.
- Оплата: Robokassa с серверной проверкой подписи ResultURL.
- Telegram не используется.

## Пользовательский сценарий

1. Клиент выбирает тариф.
2. Заполняет анкету с параметрами, целями и ограничениями питания.
3. Workers AI создаёт персональный план на срок выбранного тарифа: 7 дней для «Питание», 14 дней для PRO и 30 дней для Premium. До оплаты показывается только предварительный просмотр первого дня.
4. Клиент переходит на страницу оплаты Robokassa.
5. Worker проверяет подпись и сумму уведомления Robokassa, после чего создаёт подписку и открывает полный план.
6. В личном кабинете доступны меню и список покупок; дневник прогресса и ИИ-консультант — на PRO и Premium. На Premium дополнительно доступен один ИИ-разбор прогресса за календарную неделю при наличии минимум двух записей дневника; пять последних отчётов сохраняются в D1.

## Тарифы

- Питание — 990 ₽ / 7 дней.
- PRO — 1 990 ₽ / 14 дней.
- Premium — 3 990 ₽ / 30 дней.

## API

- `GET /health`
- `POST /api/checkout` — анкета, генерация AI-плана и создание ссылки Robokassa.
- `POST /webhooks/robokassa` — серверное подтверждение оплаты.
- `GET /api/payment-status?ref=...`
- `GET /api/me`
- `GET|POST /api/profile`
- `GET /api/plan`
- `GET|POST /api/progress`
- `POST /api/chat`
- `GET|POST /api/premium/review` — еженедельный ИИ-разбор прогресса, только Premium.

## Настройка Cloudflare

Используется уже существующий Worker `red-waterfall-2af8`. Не создавайте новый Worker.

Нужны bindings:
- Workers AI: `AI`.
- D1: `DB`, база `fital-pro-db`.
- Static assets: каталог `public`, binding `ASSETS`.

Секреты Worker:
- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_PASSWORD1`
- `ROBOKASSA_PASSWORD2`
- `ROBOKASSA_TEST_PASSWORD1` и `ROBOKASSA_TEST_PASSWORD2` — отдельные тестовые пароли Robokassa для защищённого тестового checkout.
- `ROBOKASSA_TEST_ACCESS_KEY` — секретный ключ доступа к закрытым страницам диагностики AI и тестовой оплаты; это не пароль Robokassa.
- `ROBOKASSA_IS_TEST=1` включается только в отдельной тестовой среде, не в production.

Не помещайте реальные пароли в GitHub, frontend, `.dev.vars.example` или публичные файлы. Добавляйте их только в Cloudflare Worker → Settings → Variables and Secrets.

## Robokassa

В технических настройках магазина:
- ResultURL: `https://ВАШ-ДОМЕН/webhooks/robokassa`, метод POST.
- SuccessURL: `https://ВАШ-ДОМЕН/`.
- FailURL: `https://ВАШ-ДОМЕН/?payment=fail`.
- Метод подписи: MD5, если в кабинете магазина выбран MD5.

Worker использует Password #1 для создания платежной ссылки и Password #2 для проверки серверного ResultURL. Секреты должны соответствовать одному магазину и одному режиму Robokassa. Тестовый режим использует только тестовую пару паролей; отсутствие тестовой пары останавливает создание платежа с ошибкой конфигурации.

## База данных и публикация

Используется уже существующая D1 `fital-pro-db`, привязанная как `DB`. Таблицы профилей, подписок, платежей и прогресса продолжают использовать прежнюю структуру Fital Pro. Таблица `premium_reviews` создаётся автоматически через существующий D1 binding при первом обращении к Premium-разбору. Таблица `pending_orders`, необходимая для новых заказов Robokassa, создаётся Worker автоматически через существующий D1 binding при первом запросе оплаты.

Файл `migrations/0001_init.sql` сохранён для развёртывания чистой базы или ручного управления схемой. Обычная публикация Worker не требует отдельного D1 Admin API token. Для новой пустой базы миграцию можно применить командой `npm run db:migrate` с учётными данными, имеющими D1 edit permissions.

После публикации используются уже сохранённые секреты Worker Robokassa и существующие настройки магазина.

Команды для локальной разработки: `npm install`, `npm run db:migrate`, `npm run dev`.


## Изоляция Preview
- Preview не наследует production bindings и secrets автоматически.
- Для Preview требуется отдельная D1-база (например, `fital-pro-preview-db`) с binding `DB`; production D1 не подключать к Preview.
- Workers AI binding `AI` должен быть доступен в Preview.
- В Preview установить `ROBOKASSA_IS_TEST=1` и тестовые `ROBOKASSA_TEST_PASSWORD1/2`. Не копировать в Preview production Password #1/#2.
- Production использует только `ROBOKASSA_PASSWORD1/2` и не должен иметь `ROBOKASSA_IS_TEST=1`.
- После настройки Preview привязать его к отдельной D1 и применить миграции именно к этой базе. Не запускать `db:migrate` против production ради Preview.
