# DEPLOY — как поднять отдельный инстанс Task Carousel

Runbook для AI-агента (или инженера), который разворачивает **новый, изолированный**
экземпляр приложения для **другого человека**: свой Cloudflare Worker, своя D1-база,
свой домен и свой Cloudflare Access с почтой этого человека. Данные пользователей
между инстансами не пересекаются.

Ты пройдёшь: подготовка → параметры → D1 → Cloudflare Access → конфиг → деплой →
проверка. В конце — troubleshooting и удаление. Все команды идемпотентны либо
повторяемы. Не выдумывай значения — если чего-то не хватает (домен, email, доступ
к аккаунту), **остановись и спроси заказчика**, а не подставляй заглушку.

---

## 0. Предпосылки

Проверь до начала (каждую — реально, командой):

```sh
node --version      # >= 20
pnpm --version      # >= 9  (нет — corepack enable, либо npm i -g pnpm)
wrangler --version  # >= 4.x  (ставится как devDependency проекта, глобально не обязателен)
wrangler whoami     # должен показать аккаунт с нужной зоной; иначе: wrangler login
```

Что нужно у заказчика/аккаунта:

- **Cloudflare-аккаунт** с уже добавленной и активной **зоной** (например `example.com`),
  на поддомене которой будет жить приложение. Это НЕ workers.dev — приложение всегда
  за своим доменом и за Access.
- Права на аккаунт: Workers (write), D1 (write), DNS/zone (read), **Access / Zero Trust**
  (для создания Access-приложения). Для шага Access нужен либо доступ к дашборду
  Zero Trust, либо Cloudflare **API token** с правами Access.
- **Email(ы)** людей, которым открыть доступ (у каждого — вход по одноразовому коду).

---

## 1. Параметры инстанса

Собери значения и держи их перед глазами — они подставляются в команды ниже.
**Каждый инстанс должен иметь уникальные `WORKER_NAME`, `D1_NAME` и `APP_HOST`.**

| Переменная | Что это | Пример |
|---|---|---|
| `APP_HOST` | Домен приложения (поддомен активной зоны) | `todo.example.com` |
| `WORKER_NAME` | Имя Worker (уникально в аккаунте) | `task-carousel-alice` |
| `D1_NAME` | Имя D1-базы (уникально в аккаунте) | `task-carousel-alice-db` |
| `ALLOWED_EMAILS` | Кому открыть доступ | `alice@example.com` |
| `ACCESS_TEAM_DOMAIN` | Team-домен Zero Trust аккаунта | `myteam.cloudflareaccess.com` |
| `ACCESS_AUD` | AUD-тег Access-приложения (появится на шаге 3) | `bf7773…` (64 hex) |

Узнать `ACCESS_TEAM_DOMAIN` аккаунта:

```sh
wrangler login   # если ещё не
# team-домен виден в дашборде Zero Trust → Settings → Custom Pages,
# либо через API (см. шаг 3, вызов organizations).
```

Получить клон кода:

```sh
git clone https://github.com/azalio/task-carousel.git
cd task-carousel
pnpm install
```

---

## 2. Создать D1-базу и подставить её id

```sh
pnpm exec wrangler d1 create "$D1_NAME"
```

Команда напечатает `database_id`. Открой **`wrangler.jsonc`** и приведи блок
`d1_databases` и имя воркера к своим значениям:

```jsonc
{
  "name": "task-carousel-alice",            // = WORKER_NAME
  "d1_databases": [
    {
      "binding": "DB",                        // НЕ менять — код обращается к env.DB
      "database_name": "task-carousel-alice-db", // = D1_NAME
      "database_id": "<id из вывода выше>",
      "migrations_dir": "migrations"
    }
  ]
}
```

Применить схему к **удалённой** базе (без `--remote` уедет только в локальную):

```sh
pnpm exec wrangler d1 migrations apply "$D1_NAME" --remote
```

---

## 3. Создать Cloudflare Access-приложение и политику

Приложение закрывает `APP_HOST` целиком; политика разрешает только `ALLOWED_EMAILS`;
вход — по одноразовому коду (identity provider **One-time PIN**, включён в Zero Trust
по умолчанию). Итог шага — **`ACCESS_AUD`**, его нужно вписать в конфиг.

Два пути — выбери доступный.

### Путь A — Cloudflare API (для агента предпочтителен)

Нужен API token с правами Access (Account → Access: Apps & Policies: Edit) и
`ACCOUNT_ID`. Скрипт создаёт policy + app и печатает AUD. Подставь свои значения.

```sh
CF_API_TOKEN='<token>'
ACCOUNT_ID='<account id>'      # wrangler whoami покажет
APP_HOST='todo.example.com'
ALLOWED='["alice@example.com"]'   # JSON-массив

# 3.1 team-домен аккаунта (если ещё не знаешь ACCESS_TEAM_DOMAIN)
curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/organizations" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["auth_domain"])'

# 3.2 создать app + inline-policy allow по email
EMAILS_JSON=$(python3 -c 'import json,sys; print(json.dumps([{"email":{"email":e}} for e in json.loads(sys.argv[1])]))' "$ALLOWED")
curl -s -X POST -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -d "{
    \"name\": \"$APP_HOST\",
    \"type\": \"self_hosted\",
    \"domain\": \"$APP_HOST\",
    \"session_duration\": \"24h\",
    \"http_only_cookie_attribute\": true,
    \"policies\": [{
      \"name\": \"allow-listed\",
      \"decision\": \"allow\",
      \"include\": $EMAILS_JSON
    }]
  }" | python3 -c 'import sys,json;r=json.load(sys.stdin);print("AUD =", r["result"]["aud"]) if r.get("success") else print("ERROR", r["errors"])'
```

Запиши напечатанный `AUD` в `ACCESS_AUD`.

### Путь B — дашборд Zero Trust (руками)

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Application domain = `APP_HOST`. Session Duration = 24h.
3. Policy: Action **Allow**, Include → **Emails** → перечисли `ALLOWED_EMAILS`.
4. Identity provider: убедись, что включён **One-time PIN** (Settings →
   Authentication) — это вход по коду на почту.
5. Сохрани. Открой созданное приложение → **Overview → Application Audience (AUD) Tag**,
   скопируй в `ACCESS_AUD`.

> Приложение должно покрывать production-URL. Preview URLs в этом проекте отключены
> (`preview_urls: false`, `workers_dev: false`), отдельный Access для них не нужен.

---

## 4. Прописать Access-переменные в конфиг

В **`wrangler.jsonc`**, блок `vars`:

```jsonc
"vars": {
  "ACCESS_TEAM_DOMAIN": "myteam.cloudflareaccess.com",  // = ACCESS_TEAM_DOMAIN
  "ACCESS_AUD": "bf7773…"                               // = ACCESS_AUD из шага 3
}
```

Worker проверяет подпись Access-JWT (`iss` = `https://<ACCESS_TEAM_DOMAIN>`,
`aud` = `ACCESS_AUD`, `exp`/`nbf`) и берёт email пользователя **только** из токена.
Неверные значения → все запросы будут падать в 403, даже после входа.

Проверь `routes` там же — домен приложения:

```jsonc
"routes": [ { "pattern": "todo.example.com", "custom_domain": true } ]
```

При деплое Cloudflare сам создаст нужную DNS-запись для `APP_HOST` (отдельно в DNS
ходить не надо).

> **`compatibility_date`:** если при сборке/тестах видишь warning вида «latest
> compatibility date supported by the runtime is `YYYY-MM-DD`, but you requested …»,
> поставь дату **не новее** поддерживаемой установленным `wrangler`/`workerd`.
> Флаг `nodejs_compat` не трогай — он нужен `jose`.

---

## 5. Деплой

```sh
# ВАЖНО: именно `pnpm run deploy`. Голый `pnpm deploy` перехватывается встроенной
# командой pnpm (workspace deploy) и упадёт "A deploy is only possible from inside a workspace".
pnpm run deploy
```

Скрипт делает `vite build` (собирает фронт + Worker) и `wrangler deploy`. В выводе
проверь, что среди bindings есть `DB`, `ASSETS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`
и что триггер — твой `todo.example.com (custom domain)`.

---

## 6. Проверка (обязательно)

```sh
# 6.1 домен закрыт Access: без токена — 302 на страницу логина
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://todo.example.com/
# ждём: 302 https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/login/...  с твоим aud=<ACCESS_AUD>

# 6.2 dev-байпас НЕ должен просочиться в прод (иначе auth выключен для всех!)
#     В списке vars НЕ должно быть DEV_AUTH_EMAIL. Через API:
curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME/settings" \
  | python3 -c 'import sys,json;b=json.load(sys.stdin)["result"]["bindings"];print("DEV_AUTH_EMAIL present:", any(x.get("name")=="DEV_AUTH_EMAIL" for x in b))'
# ждём: DEV_AUTH_EMAIL present: False
```

Затем финальная ручная проверка: заказчик открывает `https://todo.example.com`,
получает код на почту из `ALLOWED_EMAILS`, входит, создаёт задачу, жмёт
«Записать и дальше», «Готово». (Это единственный шаг, который нельзя пройти из CLI —
нужен реальный вход через Access.)

---

## 7. Локальная разработка (опционально)

Локально Access не поднять, поэтому есть **dev-байпас** — только для `wrangler dev`/
`vite dev`, НИКОГДА в проде:

```sh
cp .dev.vars.example .dev.vars     # внутри: DEV_AUTH_EMAIL=dev@example.com
pnpm exec wrangler d1 migrations apply "$D1_NAME" --local
pnpm dev
pnpm test        # 113 unit/integration
pnpm test:e2e    # 3 Playwright сценария (сам поднимает preview на чистой БД)
```

`.dev.vars` — в `.gitignore`, коммитить нельзя. Наличие `DEV_AUTH_EMAIL` в окружении
выключает проверку Access и подставляет этот email как пользователя.

---

## 8. Troubleshooting

| Симптом | Причина / решение |
|---|---|
| `A deploy is only possible from inside a workspace` | Запущен `pnpm deploy` вместо `pnpm run deploy`. |
| Все запросы к API → **403** после входа | Неверный `ACCESS_AUD` или `ACCESS_TEAM_DOMAIN` в `vars`. Сверь AUD приложения (шаг 3). |
| Вход не запрашивается, любой открывает данные | В проде оказался `DEV_AUTH_EMAIL` (шаг 6.2). Убери из `vars`/секретов, передеплой. |
| `no such table` в рантайме | Не применены миграции на remote: `wrangler d1 migrations apply "$D1_NAME" --remote`. |
| Warning про `compatibility date` + fallback | Дата новее рантайма. Понизь `compatibility_date` до поддерживаемой (шаг 4). |
| `wrangler (X) does not satisfy peer … @cloudflare/vite-plugin (^Y)` | Версия plugin требует более свежий wrangler, чем даёт твой npm-реестр. Либо обнови `wrangler`, либо закрепи совместимую версию плагина (в этом репо — `@cloudflare/vite-plugin@1.26.0` под `wrangler@4.70`). Проверить: `pnpm view @cloudflare/vite-plugin@<v> peerDependencies.wrangler`. |
| DNS для `APP_HOST` не появился | Он создаётся при `wrangler deploy` из `routes.custom_domain`. Проверь, что зона `APP_HOST` в этом же аккаунте и активна. |

---

## 9. Снести инстанс

```sh
pnpm exec wrangler delete --name "$WORKER_NAME"        # Worker + custom domain
pnpm exec wrangler d1 delete "$D1_NAME"                # D1-база (данные!)
# Access-приложение удали в дашборде Zero Trust или DELETE /accounts/$ACCOUNT_ID/access/apps/<app_id>
```

---

### Чек-лист «готово»

- [ ] `APP_HOST`, `WORKER_NAME`, `D1_NAME` уникальны для этого инстанса
- [ ] D1 создана, `database_id` в `wrangler.jsonc`, миграции применены `--remote`
- [ ] Access-приложение на `APP_HOST`, политика с `ALLOWED_EMAILS`, получен `ACCESS_AUD`
- [ ] `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` в `vars`; `routes` = `APP_HOST`
- [ ] `pnpm run deploy` прошёл, bindings на месте
- [ ] `curl /` отдаёт 302 на Access-логин
- [ ] `DEV_AUTH_EMAIL present: False` в проде
- [ ] заказчик вошёл по коду и создал первую задачу
