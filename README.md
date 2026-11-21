# Fital Pro

Персональный сервис питания и фитнеса на существующем Cloudflare Worker \`red-waterfall-2af8\`.

## Архитектура

- Frontend: \`public/\` (HTML, CSS, JavaScript).
- API и серверная логика: \`_worker.js\`.
- Workers AI: binding \`AI\`, модель Llama 3.1 8B Instruct.
- D1: binding \`DB\`, база \`fital-pro-db\`.
- Оплата: Robokassa с серверной проверкой подписи ResultURL.
- Telegram не используется.

## Пользовательский сценарий

1. Клиент выбирает тариф.
2. Заполняет анкету с параметрами, целями и ограничениями питания.
3. Workers AI создаёт персональный план на 7 дней; перед оплатой показывается пример первого дня.
4. Клиент переходит на страницу оплаты Robokassa.
5. Worker проверяет подпись и сумму уведомления Robokassa, после чего создаёт подписку и открывает полный план.
6. В личном кабинете доступны меню, список покупок, дневник прогресса и ИИ-консультант.

## Тарифы

- Питание — 990 ₽ / 7 дней.
- PRO — 1 990 ₽ / 14 дней.
- Premium — 3 990 ₽ / 30 дней.

## API

- \`GET /health\`
- \`POST /api/checkout\` — анкета, генерация AI-плана и создание ссылки Robokassa.
- \`POST /webhooks/robokassa\` — серверное подтверждение оплаты.
- \`GET /api/payment-status?ref=...\`
- \`GET /api/me\`
- \`GET|POST /api/profile\`
- \`GET /api/plan\`
- \`GET|POST /api/progress\`
- \`POST /api/chat\`

## Настройка Cloudflare

Используется уже существующий Worker \`red-waterfall-2af8\`. Не создавайте новый Worker.

Нужны bindings:
- Workers AI: \`AI\`.
- D1: \`DB\`, база \`fital-pro-db\`.
- Static assets: каталог \`public\`, binding \`ASSETS\`.

Секреты Worker:
- \`ROBOKASSA_MERCHANT_LOGIN\`
- \`ROBOKASSA_PASSWORD1\`
- \`ROBOKASSA_PASSWORD2\`

Не помещайте реальные пароли в GitHub, frontend, \`.dev.vars.example\` или публичные файлы. Добавляйте их только в Cloudflare Worker → Settings → Variables and Secrets.

## Robokassa

В технических настройках магазина:
- ResultURL: \`https://ВАШ-ДОМЕН/webhooks/robokassa\`, метод POST.
- SuccessURL: \`https://ВАШ-ДОМЕН/\`.
- FailURL: \`https://ВАШ-ДОМЕН/?payment=fail\`.
- Метод подписи: MD5, если в кабинете магазина выбран MD5.

Worker использует Password #1 для создания платежной ссылки и Password #2 для проверки серверного ResultURL. Секреты должны соответствовать одному магазину и одному режиму Robokassa.

## База данных и публикация

Миграция находится в \`migrations/0001_init.sql\`. Она создаёт таблицы заказов, платежей, подписок, профилей, планов, прогресса и журнала ограничений запросов.

Перед запуском примените миграции к существующей базе \`fital-pro-db\`, затем опубликуйте Worker. После этого внесите секреты Robokassa и настройте ResultURL в кабинете магазина.

Команды для локальной разработки: \`npm install\`, \`npm run db:migrate\`, \`npm run dev\`.
