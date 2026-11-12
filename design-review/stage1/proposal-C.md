<!-- Предложение C (автор скрыт до итогового отчёта) -->

# Предложение C

# Предложение по Dumka Mail: Prepared Action Queue

## 1. Концепция: инбокс как очередь готовых решений, а не папка для чтения

Сейчас Dumka Mail совмещает две конфликтующие модели. Пять вкладок `Split Inbox` (`Important`, `Purchases`, `LinkedIn`, `Automation`, `Other` — [05-inbox-default-split-important.png](/design-review/stage0/shots/05-inbox-default-split-important.png), [13-split-other.png](/design-review/stage0/shots/13-split-other.png)) дробят 28 тредов на пять очередей и ошибаются по подстрокам в [classifier.ts:66-106](/shared/classifier.ts#L66-L106): `Re: Invoice #2291 approved` улетает в `Purchases`, а PR `#482`, сбой CI и дизайн-тред на 14 писем тонут в `Other` рядом с промо. При этом AI вынесен в три отдельных экрана (`Today`, чат `AI Assistant`, `Agent Review Queue` — [19-today-no-ai.png](/design-review/stage0/shots/19-today-no-ai.png), [21-ai-copilot-no-provider.png](/design-review/stage0/shots/21-ai-copilot-no-provider.png), [44-ai-review-queue-result.png](/design-review/stage0/shots/44-ai-review-queue-result.png)), а сам инбокс пассивен (~60 действий вручную).

**Главная идея — `Prepared Action Queue` (единая двухзонная очередь подготовленных решений).** Убираем сплиты, `Today`, боковой чат `AI Assistant` и постоянную панель `AGENDA`. Весь `Inbox` — один список тредов, разделённый по требуемому действию на две зоны:

1. **`Needs Decision` (верхняя зона, поштучный поток):** письма от людей, `.ics`-приглашения и личные рабочие задачи (`Priya Raman`, `Daniel Okafor`, `Sofia Lindqvist`, PR `#482`, тикет `NW-1432`). Агент заранее готовит артефакт прямо внутри треда: черновик в `Sticky Reply Dock`, кнопку `Accept & Archive` на приглашении или чип `Snooze → Tomorrow 09:00`. Отправка (`⌘↩`) сразу архивирует тред и открывает следующий.
2. **`Ready to Sweep` (нижняя зона, пакетный разбор):** остальная почта собрана в пачки по действию (`FYI & Resolved`, `Receipts & Logistics`, `Newsletters & Alerts`, `Unsubscribe Suggestions`). Под темой каждой строки видна однострочная выжимка (`Thread Gist`), поэтому открывать письма не нужно — вся пачка архивируется одной клавишей `⇧E` с общим `Undo` (`Z`).

**Роль AI-агента:**
- **Делает сам (локально, обратимо):** делит очередь на две зоны, строит `Thread Gist` (сжимая 14 писем `Onboarding flow v4` до *«QA passed; Daniel: Alex FYI only»*), выносит суммы/рейсы/трек-номера в строку списка и стримит локальный `Suggested Draft` в `Sticky Reply Dock`.
- **Предлагает в 1 клавишу (с `Undo`):** пакетный `Sweep Group` (`⇧E`), `Snooze` по дедлайну из текста (`Tab`), правило отправителя (`Always Sweep`).
- **Требует подтверждения (`Confirm Popover`):** внешние необратимые действия — отправка (`⌘↩` + 5 с `Undo Send`), `Unsubscribe` по RFC 8058 / `mailto:` (вместо слепого клика в [20-cleanup.png](/design-review/stage0/shots/20-cleanup.png)), внешний RSVP, удаление / `Spam`.
- **Без модели и при ошибке:** без ключа очередь работает на RFC-заголовках (`Auto-Submitted`, `List-Id`, `List-Unsubscribe`, `Precedence`, `To/Cc`, `.ics`). Автоматика и `noreply` никогда не помечаются под ответ (чинит [19-today-no-ai.png](/design-review/stage0/shots/19-today-no-ai.png)); генеративные кнопки скрыты вместо `Automatic · None`. Сбой API ([46-ai-error-provider-failure.png](/design-review/stage0/shots/46-ai-error-provider-failure.png)) тихо включает RFC-режим (`AI offline · local rules`), а клавиша `X` меняет группу и запоминает отправителя.

**Первые 60 секунд и per-account:** встроенный PKCE Desktop OAuth client запускает синк сразу после входа: за **< 1,5 с** появляются первые 30 писем и подпись Gmail, а в фоне без кликов индексируется весь архив. Настройки сжаты с 19 до 5 вкладок плюс `Account Drawer` каждого ящика (`alex.morgan@northwind.example`, `alex@morgan-family.example`): подпись, пресет `Work / Personal`, приватность и тон AI, уведомления.

---

## 2. «Было → стало» для типового инбокса из 28 писем

База «было» из [STAGE0.md](/design-review/stage0/STAGE0.md) (раздел 3, режим `Superhuman [не проверено]`, без AI) и [triage-notes.md](/design-review/stage0/metrics/triage-notes.md): **60 действий** (58 клавиш + 2 клика), **~400 символов**, **28 открытий**, **6–7 мин** (KLM). В новой модели 28 тредов `alex.morgan@northwind.example` делятся на **11 в `Needs Decision`** и **17 в `Ready to Sweep`**.

| Группа (28 тредов) | Было | Стало с AI | Стало без AI (RFC) |
| --- | --- | --- | --- |
| **Люди, ответ (5):** `Priya`, `Daniel` (+напомнить), `Sofia`, `Marcus`, `Hannah` | 19 кл. (`5×(R,⌘↩,E)`+`H↓↓↩`), ~400 симв. | **12 кл.:** `↩`, `5×Tab` (черновик), `⌘⇧R` (`Daniel`), `5×⌘↩` (`Send & Archive`), **~90 симв.** правок | **13 кл.:** `↩`, `5×R`, `H↩` (`Daniel`), `5×⌘↩`, ~400 симв. |
| **Календарь (2):** `Priya` (`weekly`), `Daniel` (`1:1`) | 2 кл. (`2×E`, без RSVP) | **3 кл.:** `Y↩` (`Confirm RSVP`), `E` (`1:1`) | **3 кл.** (локальный `.ics`) |
| **Уведомления (6):** 3 отложить (`PR #482`, `CI #9121`, `NW-1432`), 3 убрать (`Pilot plan`, `NW-1398`, `Resolved`) | 15 кл. (`3×H↓↓↩`+`3×E`) | **7 кл.:** `3×H↩` (`Tomorrow 09:00`) = 6; `E` (`Pilot plan`) = 1; 2 статуса в `FYI` (0) | **7 кл.** (`Auto-Submitted`, `Resolved`) |
| **Люди, FYI (4):** `Onboarding v4` (14 сообщ.), `Offsite`, `Invoice #2291`, `Deploy freeze` | 4 кл. (`4×E`) + 14 писем | **1 кл. `⇧E`** на `FYI & Resolved (6)` после скана `Gist` | **4 кл.:** `Deploy freeze` в `Sweep` (`⇧E`), 3 FYI (`3×E`) |
| **Чеки и доставка (3):** `Skyline`, `Paperclip`, `Parcelo` | 3 кл. (`3×E`) | **1 кл. `⇧E`** на `Receipts & Logistics (3)` (`€29`, `BER→LIS`, `10–14:00` в строке) | **1 кл. `⇧E`** |
| **Рассылки (4) + соцсеть/SSO (2):** `Dispatch`, `Product Weekly`, `People`, `DevConf`, `LinkedIn`, `SSO` | 6 кл. (`6×E`) | **1 кл. `⇧E`** на `Newsletters & Alerts (6)` | **1 кл. `⇧E`** (`List-Unsubscribe`, `noreply`) |
| **Промо — отписка (2):** `Fieldnote`, `Loft & Linen` | 2 клика без спроса | **2 кл. (`U`, `↩`):** пакетный `Confirm Unsubscribe` | **2 кл. (`U`, `↩`)** |
| **Обход 5 сплитов** | 10 кл. (`5+5×↩`) | **0 кл.** (единый список) | **0 кл.** |
| **ИТОГО** | **60 действий, ~400 симв., 28 открытий, 6–7 мин** | **27 клавиш (-55%), 0 кликов, ~90 симв. (-78%), 11 открытий, ~2,0 мин** *(оценка)* | **31 клавиша (-48%), 0 кликов, ~400 симв., 14 открытий, ~3,6 мин** *(оценка)* |

*Факт vs оценка:* база «было» измерена в `STAGE0.md`; клавиши «стало» — точный подсчёт по механике; правки (~90 симв.) и время KLM (**~2,0 мин** с AI: ~65 с чтение 11 тредов и скан 17 `Gist` + ~25 с правка + ~30 с ввод; **~3,6 мин** без AI) — **оценка**.

---

## 3. Ключевые экраны и карта клавиш

Окно 1440×900 — максимум **3 колонки** (вместо 5 в [21-ai-copilot-no-provider.png](/design-review/stage0/shots/21-ai-copilot-no-provider.png)): `LeftRail` (56 px) + `Queue List` (420 px; без открытого треда 760 px по центру) + `Thread Stage` (964 px). Панель `AGENDA` удалена.

1. **`First Run & Onboarding`:** чистое окно без пустой `AGENDA` ([01-first-run-empty.png](/design-review/stage0/shots/01-first-run-empty.png)), по центру `Connect Gmail` и свёрнутый `Custom OAuth JSON`. За **< 1,5 с** после OAuth появляются первые 30 писем и подпись `alex.morgan@northwind.example`. Внизу `LeftRail` тихо идёт `Indexing archive · 1,200 / 6,034`, а съёмная плашка предлагает опционально подключить AI.
2. **`Inbox — Prepared Action Queue`:** в `LeftRail` — аватары ящиков (`⌘1`, `⌘2`, `⌘0` `Unified`), `Inbox`, `Snoozed`, `Drafts`, `Sent`, `All Mail`, `Calendar` (`⌘3`), `Settings` (`⌘,`). В `Queue List` (420 px) сверху `NEEDS DECISION (11)`, ниже — пачки `READY TO SWEEP` с кнопкой `Sweep · ⇧E` в шапке. Строка (64 px, 2 ряда): 1-й ряд — непрочитанность, отправитель, счётчик `(14)`, чип (`Reply`, `RSVP`, `Snooze?`, `Receipt`, `FYI`), время; 2-й ряд — тема (до 55 симв.) и `Thread Gist` или факты (`€29.00`, `BER→LIS 14 Oct`).
3. **`Thread Stage`:** 964 px справа; вместо 12 немых иконок ([06-thread-open-simple.png](/design-review/stage0/shots/06-thread-open-simple.png)) только тема, адрес и **4 кнопки с текстом**: `Reply R`, `Done E`, `Snooze H`, `More ···`. Над длинным тредом — 2-строчная `Thread Summary` и `Expand 12 earlier`. Простые письма рендерятся через Shadow DOM в цветах темы без белого `iframe` (`Original HTML` — для рассылок), а карточка `.ics` ([18-thread-calendar-invite.png](/design-review/stage0/shots/18-thread-calendar-invite.png)) сразу даёт `Accept Y` / `Decline`.
4. **`Sticky Reply Dock`:** закреплён внизу `Thread Stage` (`max-height: 42vh`, скролл внутри текста), поэтому `Send & Archive ⌘↩` | `Send only ⌘⇧↩` | `Remind ⌘⇧R` | `Discard ⌘⌫` всегда на экране ([08-reply-inline-typed.png](/design-review/stage0/shots/08-reply-inline-typed.png)). Черновик агента ждёт прямо в поле (`Suggested Draft · Tab to edit`); `Esc` сворачивает док в полоску `Draft saved · R to resume`.
5. **`Instant Search Bar`:** по `/` строка над списком фильтрует SQLite FTS5 за **< 45 мс** и через 300 мс добавляет `Semantic`. Фильтры (`from:`, `has:attachment`, `in:all`, даты) открываются поповером поверх списка (не сдвигая верстку, как в [29-filters-panel-stuck-open-with-toasts.png](/design-review/stage0/shots/29-filters-panel-stuck-open-with-toasts.png)) и закрываются первым `Esc`.
6. **`Account Drawer & Settings`:** глобальные настройки сжаты с 19 до 5 вкладок (`Accounts`, `Inbox & Triage`, `AI & Models`, `Shortcuts & Theme`, `Privacy & Data`) без констант вроде `min wait 48h` ([settings/03-inbox.png](/design-review/stage0/shots/settings/03-inbox.png)). Клик по ящику открывает его `Account Drawer`: `Signature`, пресет `Work: Strict` / `Personal: Relaxed`, `AI Privacy & Tone` (`Local only` / `Cloud`, `Direct` / `Warm`), `Notifications`, опциональный `Enable Calendar`.
7. **`Agent Action & Confirmation`:** агент встроен в строку (`Gist`, чип, `X` `Change group…` с сохранением правила отправителя) и в `Reply Dock`. Необратимые внешние действия открывают модальный `Confirm Popover`: получатель (`Fieldnote Pro`), запрос (`HTTPS POST links.example/unsubscribe/fieldnote`), локальный эффект (`Archive + mute`) и `Cancel Esc` / `Confirm ↩`.

### Карта клавиш

| Клавиши | Действие |
| --- | --- |
| `J` / `K`, `↩` / `Esc` | Навигация по очереди и пачкам; открыть тред / закрыть поповер или свернуть `Reply Dock` |
| `E` / `⇧E` / `Z` | Архив треда + автопереход / `Sweep Group` пачки / `Undo` действия или пачки |
| `R` / `A` / `F`, `Tab` | Ответить / всем / переслать; `Tab` принимает `Suggested Draft` или предложенный чип |
| `⌘↩` / `⌘⇧↩` / `⌘⇧R` | `Send & Archive` (5 с `Undo Send` + следующий тред) / `Send` без архива / напомнить без ответа |
| `H` / `Y` / `U` / `X` | `Snooze` (`Tomorrow 09:00`) / принять `.ics` / отписаться (`Confirm`) / сменить группу отправителя |
| `/` , `⌘0` / `⌘1`–`⌘9` | Мгновенный поиск (`Esc` сбрасывает) / `Unified Inbox` / переключение аккаунтов |

---

## 4. Список конкретных изменений

| Что | Почему (проблема, код, замер → цель) | Критерий | Сложность |
| --- | --- | --- | --- |
| 1. Заменить 5 `Split Tabs` на очередь `Needs Decision` + `Ready to Sweep` (`⇧E`) | Сплиты требуют +10 нажатий и ошибаются в [classifier.ts:66-106](/shared/classifier.ts#L66-L106); `Sweep` убирает 17 писем из 28 за 5 клавиш | К1, К2 | **L** |
| 2. Сделать `Send & Archive` по умолчанию (`⌘↩`) и починить закрытие чужого треда | Отправка не архивирует тред, а замыкание `openedThread?.id` в [useDraftsState.ts:691,703](/renderer/src/stores/useDraftsState.ts#L691-L704) через 10 с закрывает другой тред | К1 | **S** |
| 3. Убрать чат `AI Assistant`, `Today` и `Review Queue`; перенести черновик в `Reply Dock`, `Gist` — в список | 5 колонок жмут читалку до 390 px ([21-ai-copilot-no-provider.png](/design-review/stage0/shots/21-ai-copilot-no-provider.png)), черновик падает в чат ниже скролла ([42-ai-draft-reply-result.png](/design-review/stage0/shots/42-ai-draft-reply-result.png)) | К1, К4 | **L** |
| 4. Запускать синк сразу в `api:onboardAccount` и автоматизировать фоновый `backfill` | Вход ждёт воркер 10–60 с в [main/index.ts:1253-1277](/main/index.ts#L1253-L1277), [main/index.ts:2542-2548](/main/index.ts#L2542-L2548) (**10,2 с** / **49,9 с**), архив ждёт 61 клик ([useMailSync.ts:82-110](/renderer/src/stores/useMailSync.ts#L82-L110)) → **< 1,5 с** | К2, К3 | **M** |
| 5. Вшить PKCE Desktop OAuth client и диагностику ошибок входа | Без JSON в [gmailOAuth.ts:39-49](/main/gmailOAuth.ts#L39-L49) вход падает немым тостом ([02-first-run-connect-without-oauth-client.png](/design-review/stage0/shots/02-first-run-connect-without-oauth-client.png)) | К2 | **S** |
| 6. Построить базовую сортировку на RFC-заголовках (`Auto-Submitted`, `List-Id`, `List-Unsubscribe`, `To/Cc`, `.ics`) | Убирает `Prepare draft` на `noreply` ([19-today-no-ai.png](/design-review/stage0/shots/19-today-no-ai.png)) и работает без AI-ключа | К2, К4 | **M** |
| 7. Ввести `Confirm Popover` для `Unsubscribe`, внешнего RSVP и `Spam` | Блокирует необратимые внешние вызовы без подтверждения ([20-cleanup.png](/design-review/stage0/shots/20-cleanup.png)) | К4 | **S** |
| 8. Снизить дебаунс FTS5 с 250 мс до 16 мс и закрывать фильтры по `Esc` | Пауза 250 мс в [searchCommitController.ts:1](/renderer/src/components/layout/searchCommitController.ts#L1) раздувает поиск до 272 мс → **< 45 мс** (p95 < 60 мс) | К3, К1 | **S** |
| 9. Выделить `AccountSettingsMap[accountId]` (`Account Drawer`) и сжать настройки с 19 до 5 вкладок | Единый `AppSettings` в [types.ts:1324-1342](/shared/types.ts#L1324-L1342) ([settings/01-accounts.png](/design-review/stage0/shots/settings/01-accounts.png)) смешивает подписи, тон и приватность AI разных ящиков | К5, К2 | **M** |
| 10. Закрепить `Sticky Reply Dock`, расширить список до 420 px, оставить 4 кнопки с текстом в шапке, убрать `AGENDA` | Чинит `Send` за краем окна ([08-reply-inline-typed.png](/design-review/stage0/shots/08-reply-inline-typed.png)), обрезку тем и 12 немых иконок ([06-thread-open-simple.png](/design-review/stage0/shots/06-thread-open-simple.png)) | К1, К2 | **M** |
| 11. Разделить IPC сообщений и инсайтов, добавить prefetch `±1` по `J`/`K` и Shadow DOM вместо белого `iframe` | В [main/index.ts:1124-1128](/main/index.ts#L1124-L1128) и [SafeHtmlRenderer.tsx:305-331](/renderer/src/components/SafeHtmlRenderer.tsx#L305-L331) тело грузится 67–69 мс → **< 20 мс** (p95 < 35 мс) | К3, К1 | **M** |
| 12. Считать окно `Unified Inbox` в SQLite-воркере с прогретым кэшем `⌘0`/`⌘1`/`⌘2` | Перегон 7546 тредов в [useMailState.ts:540-601](/renderer/src/stores/useMailState.ts#L540-L601) даёт p95 **366 мс** → **< 25 мс** (p95 < 40 мс) | К3 | **M** |
| 13. Перевести `Undo` (`Z`) на `patchThread` и изолировать `onScroll` из корня `App.tsx` | `loadThreadsFromDB(true)` в [useMailState.ts:1326-1328](/renderer/src/stores/useMailState.ts#L1326-L1328) тормозит `Z` до **116 мс**; скролл ререндерит [App.tsx:985-994](/renderer/src/App.tsx#L985-L994) → `Z` **< 25 мс** | К3 | **S** |
| 14. Включить стриминг AI (`stream: true`), тихий fallback ошибок, ящик `All Mail` и локальный `.ics` RSVP | Убирает паузу в [main/ai.ts:310](/main/ai.ts#L310) (первый токен **< 350 мс**), стек 503 ([46-ai-error-provider-failure.png](/design-review/stage0/shots/46-ai-error-provider-failure.png)) и потерю архива | К1, К3, К4 | **S** |

---

## 5. Главный риск идеи и раннее обнаружение

**Главный риск — попадание важного живого письма в `Ready to Sweep` («слепое смахивание»).** Если запрос от нового человека или критичный инцидент попадёт в пачку `Sweep`, пользователь уберёт его клавишей `⇧E` не читая. Два таких промаха разрушат доверие, и пользователь начнёт открывать каждое письмо в `Sweep` вручную, обнулив выигрыш по К1.

**Защита и раннее обнаружение (локально по `ActionLog`):**
- **Асимметричный порог:** без ручного правила `Always Sweep` в `Ready to Sweep` допускаются только письма с маркерами массовости/автоматики (`List-Id`, `List-Unsubscribe`, `Auto-Submitted`, чеки). Любое сомнение поднимает тред в `Needs Decision`.
- **Метрика `Sweep Rescue Rate`:** доля смахнутых по `⇧E` тредов, которые за 48 часов вернули через `Undo` / `All Mail`, подняли в `Needs Decision` (`X`) или открыли через поиск и ответили. При `Sweep Rescue Rate > 1%` или перевесе повышений `Sweep → Needs Decision` над понижениями порог `Sweep` немедленно ужесточается.
