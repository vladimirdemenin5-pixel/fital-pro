# Fital Pro — настройка проекта

Проект использует существующий Cloudflare Worker `red-waterfall-2af8`, Workers AI и D1. Новые Worker и D1 создавать не нужно.

## Подтверждённые компоненты

- `_worker.js` — API и серверная логика.
- `public/` — статические файлы сайта; каталог должен присутствовать для развёртывания.
- `AI` — binding Workers AI.
- `DB` — binding к существующей D1 `fital-pro-db`.

## Оплата Robokassa

Worker создаёт платёжную ссылку Robokassa и принимает серверное уведомление.

Обязательные секреты Worker:

- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_PASSWORD1`
- `ROBOKASSA_PASSWORD2`

Не помещайте пароли в репозиторий, HTML, JavaScript браузера или переписку. Добавляйте их только в Cloudflare Worker → Settings → Variables and Secrets → Secrets.

Необязательная переменная:

- `ROBOKASSA_HASH_ALGORITHM` — алгоритм должен совпадать с настройкой магазина; если переменная отсутствует, используется MD5.

Технические настройки магазина Robokassa:

- Result URL: `https://<действующий-домен-Worker>/webhooks/robokassa`
- Метод Result URL: POST
- Пароль для проверки Result URL: Пароль №2
- Пароль для формирования платёжной ссылки: Пароль №1
- Success URL и Fail URL: страницы действующего сайта.

Worker проверяет подпись уведомления, номер счёта, тариф и сумму по сохранённому заказу. Повторные уведомления не должны повторно продлевать срок доступа. Сроки тарифов: 7, 14 и 30 дней.

Ответ `/api/checkout` содержит `client_ref`. Интерфейс должен сохранить его и после возврата с оплаты запрашивать `/api/payment-status?ref=<client_ref>`. Запрос статуса только по номеру платежа не раскрывает токен доступа.

## Команды

```bash
npm install
npm run check
```

`npm run deploy` выполняет только публикацию Worker. Production-миграции вынесены в `npm run db:migrate` и не запускаются автоматически.

Для изолированной Preview D1 используйте `npm run db:migrations:list:preview` и `npm run db:migrate:preview`. Они используют отдельный `wrangler.preview-migrations.jsonc`, где указан только Preview database ID.

## Важно до публикации

В текущем GitHub tree отсутствуют каталоги `public/` и `migrations/`. Поэтому этот репозиторий пока нельзя считать готовым к развёртыванию: сначала нужно восстановить и проверить фронтенд и реальные миграции существующей D1. Не создавайте пустые каталоги или фиктивные миграции вместо настоящих файлов.

Проверка `/health` должна показать `ok: true`, `ai: true`, `db: true`, `payments: true` только после фактической настройки соответствующих bindings и секретов.
