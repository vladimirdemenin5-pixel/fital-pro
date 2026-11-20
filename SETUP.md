# Fital Pro — текущая настройка

Проект продолжает использовать существующий Cloudflare Worker `red-waterfall-2af8`, Workers AI и обе уже созданные D1. Новый Worker или база не нужны.

## Компоненты

- `_worker.js` — API, тарифы, AI-генерация, Robokassa и выдача доступа.
- `public/` — сайт и локальные изображения.
- `migrations/` — SQL-история для существующей схемы D1.
- `AI` — Workers AI binding.
- `DB` — Production D1 `fital-pro-db`.
- Preview D1 — `fital-pro-preview-db`, отдельный ID в `wrangler.jsonc`.

## Сценарий клиента

1. Выбирает тариф.
2. Заполняет анкету. У тарифа «Питание» поля тренировок скрыты.
3. Получает план на 7, 14 или 30 дней. Состав блюд и список покупок отображаются на сайте.
4. Оплачивает только после успешного сохранения черновика.
5. Robokassa отправляет серверное ResultURL уведомление.
6. После проверки подписи и суммы Worker включает подписку и сохраняет план.
7. Клиент возвращается на SuccessURL и получает доступ к кабинету.

## Preview — только тестовая среда

В `wrangler.jsonc` уже заданы Preview D1, AI binding и `ROBOKASSA_IS_TEST=1`.

Добавьте в Cloudflare **Previews Base → Secrets** отдельные тестовые секреты:

- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_TEST_PASSWORD1`
- `ROBOKASSA_TEST_PASSWORD2`

Или используйте команды Wrangler из корня репозитория:

```bash
npx wrangler preview base-config secret put ROBOKASSA_MERCHANT_LOGIN
npx wrangler preview base-config secret put ROBOKASSA_TEST_PASSWORD1
npx wrangler preview base-config secret put ROBOKASSA_TEST_PASSWORD2
```

Не копируйте рабочие пароли в Preview и тестовые пароли в Production.

Перед Preview сначала посмотрите ожидающие миграции:

```bash
npm run db:migrations:list:preview
```

После проверки списка миграции можно применить только к отдельной Preview D1:

```bash
npm run db:migrate:preview
```

Затем запустить изолированный Preview существующего Worker:

```bash
npm run preview
```

## Production и реальные платежи

Production secrets остаются в настройках Production Worker:

- `ROBOKASSA_MERCHANT_LOGIN`
- `ROBOKASSA_PASSWORD1`
- `ROBOKASSA_PASSWORD2`

В коде добавлена дополнительная защита: live checkout закрыт, пока Production variable `ROBOKASSA_LIVE_ENABLED` не установлена в `1`. Наличие ранее сохранённых паролей само по себе не включает реальные платежи.

Включать live checkout можно только после:
- полного успешного Preview-платежа;
- проверки POST ResultURL и токена доступа;
- заполнения настоящих реквизитов продавца на `/requisites.html`;
- проверки оферты, политики и возвратов.

## Команды проверки

```bash
npm run check
npm test
npm run build
```

Сборка проверяет исходный код текущей ветки. Она не распаковывает архив и не заменяет сайт или миграции. `scripts/extract-release.mjs` намеренно отключён, чтобы старый ZIP не перезаписывал текущую версию.

## Разделение Production / Preview

- `npm run db:migrate:preview` — только Preview D1.
- `npm run db:migrate` — Production D1. Не запускать на этапе тестирования.
- `npm run preview` — изолированный Worker Preview.
- `npm run deploy` — публикация Worker; не запускать до отдельного разрешения.

Текущий PR остаётся Draft. Production Worker, Production D1 и Production Secrets этой веткой не менялись.


Миграция `0011_one_payment_per_draft.sql` добавляет уникальное ограничение: один сохранённый AI-черновик может иметь только один ожидающий или успешный заказ. При повторной попытке после незавершённой оплаты пользователь формирует новый черновик. Сначала применить и проверить только на Preview.
