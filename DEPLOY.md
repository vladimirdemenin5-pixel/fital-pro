# Fital Pro — публикация

Публикация выполняется в существующий Cloudflare Worker `red-waterfall-2af8`.

## Локальные команды

```sh
npm install
npm run db:migrate
npm run deploy
```

Сценарий `deploy` сначала применяет миграции D1 к существующей базе `fital-pro-db`, затем публикует Worker и frontend assets.

## Перед приёмом оплаты

В Cloudflare Worker должны быть заданы:
- AI binding: `AI`.
- D1 binding: `DB` → `fital-pro-db`.
- Secrets: `ROBOKASSA_MERCHANT_LOGIN`, `ROBOKASSA_PASSWORD1`, `ROBOKASSA_PASSWORD2`.

В кабинете Robokassa укажите ResultURL `https://ВАШ-ДОМЕН/webhooks/robokassa` с методом POST и настройте SuccessURL/FailURL на страницы сайта.

## Важно

Не публикуйте тестовые пароли в боевом магазине. Не проверяйте оплату реальной картой до проверки уведомления в тестовом режиме. Доступ активируется только после сверки подписи и суммы сервером.
