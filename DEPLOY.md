# Fital Pro — безопасная публикация

## Состояние перед публикацией

Сначала должны быть проверены:

- существующий Worker `red-waterfall-2af8`;
- binding Workers AI `AI`;
- binding D1 `DB` к существующей базе `fital-pro-db`;
- каталог `public/` с рабочим интерфейсом;
- каталог `migrations/` с реальными SQL-миграциями, согласованными с текущей схемой D1;
- Robokassa secrets и тестовые настройки магазина.

На текущей ветке GitHub отсутствуют `public/` и `migrations/`. Не запускайте публикацию и не применяйте миграции, пока эти файлы не восстановлены и не проверены. Не создавайте новую D1 и не меняйте существующий database ID.

## Проверка

```bash
npm install
npm run check
```

## Секреты Robokassa

Добавить в существующий Worker как Secrets:

- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_PASSWORD1`
- `ROBOKASSA_PASSWORD2`
- `ROBOKASSA_TEST_PASSWORD1` — отдельный тестовый Пароль №1 из технических настроек магазина.
- `ROBOKASSA_TEST_PASSWORD2` — отдельный тестовый Пароль №2 из технических настроек магазина.

Опциональная переменная `ROBOKASSA_HASH_ALGORITHM` должна совпадать с алгоритмом в кабинете Robokassa; по умолчанию код использует MD5.

Для безопасного теста задайте `ROBOKASSA_IS_TEST=1`. Используйте идентификатор магазина `ROBOKASSA_MERCHANT_LOGIN` и отдельные тестовые секреты `ROBOKASSA_TEST_PASSWORD1` и `ROBOKASSA_TEST_PASSWORD2`. Код выбирает тестовые пароли для подписи платёжной ссылки и проверки ResultURL. Рабочие `ROBOKASSA_PASSWORD1/2` при этом не используются. Для реальных платежей задайте `ROBOKASSA_IS_TEST=0` и рабочую пару паролей. Robokassa требует тестовую пару паролей вместе с `IsTest=1`; иначе операция может стать боевой.

В кабинете Robokassa задать Result URL:

`https://<действующий-домен-Worker>/webhooks/robokassa`

Метод — POST. Для уведомления используется Пароль №2. Платёжная ссылка подписывается Паролем №1.

## Разделение публикации и миграций

`npm run deploy` публикует Worker и не запускает миграции D1.

`npm run db:migrate` применяет миграции к удалённой D1. Не запускать её без отдельной проверки SQL-файлов и согласования с текущей схемой базы.

GitHub Actions в этой ветке только проверяет синтаксис Worker при Pull Request. Автоматической публикации в Cloudflare нет.

## После отдельного разрешения на публикацию

1. Выполнить dry-run с проверенным каталогом assets.
2. Проверить health endpoint.
3. Проверить тестовый платёж Robokassa.
4. Проверить Result URL и выдачу доступа на правильный срок.
5. Только после успешных тестов обсуждать production-платёж.


## Build from the existing ZIP

Cloudflare Workers Builds must use Build command `npm run build`. This extracts the existing static site and migrations from `Fital_Pro_PRODUCTION_GITHUB_READY.zip`, applies the checked frontend patch, and creates migration `0009_plan_drafts.sql` before Wrangler deploys. The Preview build must use the same build preparation. Do not run remote D1 migrations automatically from the build command.
