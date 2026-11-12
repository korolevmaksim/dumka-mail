<!-- Критика от автора предложения C -->

# Кросс-критика предложений A, B, D, E (этап 2)

## Предложение A

### 1. Конкретные проблемы

1. `К2 · Первый запуск · Connect Gmail` — без `~/.config/dumka-mail/google-oauth-client.json` ([gmailOAuth.ts:39](/main/gmailOAuth.ts:39)) тост заменён путём к файлу, но создание OAuth-клиента Google остаётся на пользователе; вход «из коробки» сломан. Тяжесть: `блокер`.
2. `К1, К4 · Now · Handled · 11 automated и disposition(thread)` — фильтр «`noreply`, `notifications`, `List-Unsubscribe`, обновление календаря» сбоит на 28 письмах ([dataset.cjs:198](/design-review/stage0/harness/dataset.cjs:198)): захватывает ревью PR (`notifications@codeforge.example`, `List-Unsubscribe`), тикет `NW-1432` (`noreply@trackline.example`) и комментарий Priya Raman (`comments-noreply@pagewise.example`), а первый `↩` запоминает `noreply@trackline.example` (через `NW-1398`) и прячет будущие тикеты. Наоборот, у `bookings@skylineair.example`, `billing@paperclip.example`, `tracking@parcelo.example`, `people@northwind.example` нет ни `noreply`, ни `List-Unsubscribe` ([dataset.cjs:232](/design-review/stage0/harness/dataset.cjs:232)) — в пачку они не войдут. Тяжесть: `блокер`.
3. `К4, К2 · Now / Тред · rsvp и Y / N / M` — одна клавиша без подтверждения шлёт внешний ответ организатору (`PATCH ...?sendUpdates=all`, [googleWorkspace.ts:519](/main/googleWorkspace.ts:519)), `M` конфликтует с `Ignore Thread` ([appKeymap.ts:108](/shared/appKeymap.ts:108)), а при `Calendar: off` нет `GOOGLE_CALENDAR_SCOPES` ([gmailOAuth.ts:25](/main/gmailOAuth.ts:25)) — `Y` упадёт с ошибкой прав. Тяжесть: `серьёзно`.
4. `К1 · Now / Ответ · редактор и счёт действий` — на 5 ответов заложено 5×`⌘↩`, но фокус держится в списке ради `J`/`K`/`E`, поэтому перед вводом 400 символов (или правкой 250) нужен `R`×5; без модели некому отметить напоминание к среде для Daniel Okafor (`board-numbers`). Тяжесть: `серьёзно`.

### 2. Проверка утверждений автора

- **`SplitInboxRouter.split` ([classifier.ts:67](/shared/classifier.ts:67)):** подтверждается (`isPurchase` идёт раньше `isImportant`).
- **Синк 10/60 с ([index.ts:2542](/main/index.ts:2542)), поиск 250 мс ([searchCommitController.ts:1](/renderer/src/components/layout/searchCommitController.ts:1)), `stream: false` ([ai.ts:310](/main/ai.ts:310)):** подтверждается. Причина `Z` = 116 мс видна в [useMailState.ts:1326](/renderer/src/stores/useMailState.ts:1326): `restoreInbox` без оптимистичного патча ждёт IPC и `loadThreadsFromDB(true)`.
- **`disposition(thread)` в `shared/` и 60 → 17:** не подтверждается. `MailThread` ([types.ts:60](/shared/types.ts:60)) не хранит `List-Unsubscribe` и `ics` (они в `MailMessage`, [types.ts:325](/shared/types.ts:325)). С 5×`R`, напоминанием, 4 письмами без маркеров и OAuth `Calendar` выйдет **22–24 с моделью** и **26–28 без модели**.

### 3. Что стоит забрать

- Инвариант в коде: модель не переводит человеческий `From` в `handled`.
- Автоотключение правила при >10% `Undo` в пачке или двойном возврате отправителя.
- Строку `confirm-unsubscribe` в потоке вместо экрана `Cleanup`.

### 4. Оценки по К1–К5

- **К1 — 3/5:** рутина сжата в одну строку, но 17 действий занижены (пропущены `R`, напоминание и 4 письма).
- **К2 — 1/5:** ручной `google-oauth-client.json` блокирует подключение «из коробки».
- **К3 — 4/5:** точные фиксы синка, поиска и стриминга, но `56+440 px` слева не сжаты для узких окон.
- **К4 — 2/5:** первый `↩` глушит будущие тикеты `noreply@trackline.example`, а `Y`/`N`/`M` шлёт RSVP без подтверждения.
- **К5 — 4/5:** компактная карточка `Account` изолирует подпись, модель и правила.

## Предложение B

### 1. Конкретные проблемы

1. `К1, К4 · Inbox · Clear и «хоть раз писал»` — опора на `Sent` ([dataset.cjs:327](/design-review/stage0/harness/dataset.cjs:327)) рушится на новых контактах и втором ящике: Alex не писал Hannah Weiss (`Intro: Alex <> Tomás`, нужен ответ) и `eng-announce@northwind.example` (`Deploy freeze` с `List-Id` → `Clear`), а у `alex@morgan-family.example` истории `Sent` нет ([dataset.cjs:494](/design-review/stage0/harness/dataset.cjs:494)) — под `⇧A` попадут аренда от Greta Holm, счёт за свет и школа. Тяжесть: `блокер`.
2. `К1 · Inbox / SnoozeMenu · H H, A и M+1…6` — открытие `SnoozeMenu` ставит фокус в `<input>` ([SnoozeMenu.tsx:83](/renderer/src/components/SnoozeMenu.tsx:83)), поэтому вторая `H` введёт `h`; `A` затирает `Reply All`, а `M` — `Ignore Thread` ([appKeymap.ts:99](/shared/appKeymap.ts:99)). Тяжесть: `серьёзно`.
3. `К4, К2 · Inbox · Event и Y / N` — одноклавишный RSVP из списка нарушает собственное правило уровня 3 («явное подтверждение каждого пункта: send, unsubscribe, RSVP»), а `Updated invitation: 1:1 Daniel / Alex` (`METHOD:REQUEST`, `PARTSTAT=NEEDS-ACTION`, [dataset.cjs:191](/design-review/stage0/harness/dataset.cjs:191)) закрывается клавишей `E` без ответа. Тяжесть: `серьёзно`.
4. `К3, К4 · Синхронизация / Reply · черновики за 0 мс` — генерация сводок и черновиков при синхронизации ящика на 3028 тредов ([STAGE0.md](/design-review/stage0/STAGE0.md), снимок `33`) вызовет лавину вызовов API без лимита на аккаунт, а без ключа модели черновиков за 0 мс нет. Тяжесть: `серьёзно`.

### 2. Проверка утверждений автора

- **Ссылки на [classifier.ts:71](/shared/classifier.ts:71), [index.ts:2518](/main/index.ts:2518), [useMailSync.ts:82](/renderer/src/stores/useMailSync.ts:82), [types.ts:1324](/shared/types.ts:1324):** подтверждается частично. Баг покупок на `classifier.ts:68,91` (`71,98` — `isLinkedIn`), а `signaturesByAccount` ([types.ts:1110](/shared/types.ts:1110)) уже есть.
- **`Later = 1` без модели «по шаблонам CodeForge/CI»:** не подтверждается. В [triage-baseline.mjs:29](/design-review/stage0/harness/triage-baseline.mjs:29) откладываются PR (`CodeForge`), `NW-1432` (`Trackline`) и комментарий (`Pagewise`), а упавший CI (`CodeForge`) архивируется — шаблон источника их смешает.
- **60 → 17 с моделью / 22 без модели:** не подтверждается. Забыты 5×`R` перед правкой 80 символов, срок к среде вместо `Send & remind in 3 days` (`⌘⇧↩`), переходы по 6 секциям и OAuth `Calendar`: реально **25–28 с моделью** и **29–33 без модели**.

### 3. Что стоит забрать

- Локальную метрику `Rescue rate` (доля пакетно убранных писем, открытых или возвращённых за 7 дней).
- Секцию `People` вместо разделения `Reply`/`Read` без модели (убирает ложные `Prepare draft`).
- Инлайн-чипы поиска с двушаговым `Esc` и бейджем места письма (`Inbox` / `Archived` / `Later`).

### 4. Оценки по К1–К5

- **К1 — 3/5:** `⇧A` ускоряет пакеты, но счёт 17 занижен, а `H H`, `A`, `M` ломают ввод и хоткеи.
- **К2 — 3/5:** встроенный OAuth и синк работают, но эвристика «хоть раз писал» опасна на новых контактах и втором ящике.
- **К3 — 4/5:** верные фиксы поиска, стриминга и `Undo`, но не ограничена предгенерация AI на больших ящиках.
- **К4 — 2/5:** одноклавишный RSVP из списка нарушает защиту внешних действий, а `List-Id → Clear` прячет `Deploy freeze`.
- **К5 — 5/5:** чистый лист аккаунта с правилами и сжатием глобальных настроек до ≤40 контролов.

## Предложение D

### 1. Конкретные проблемы

1. `К1, К4 · Inbox / Review action · E на треде и пакете` — `E` архивирует и тред, и открытый пакет при автопереходе к следующему элементу: лишнее нажатие по инерции снесёт пакет из 3–4 писем, а клавиш исключения строки в `Review action` нет. Тяжесть: `серьёзно`.
2. `К1 · Reply / SnoozeMenu · Send & Archive → H, Enter` — посчитан `Send & Archive`, затем `H`, `Enter`, но после `Send & Archive` открыт следующий тред и `H` отложит чужое письмо; плюс в [SnoozeMenu.tsx:69](/renderer/src/components/SnoozeMenu.tsx:69) `H`, `Enter` ставит `Later today`, а не `Tomorrow, 09:00` (+8×`↓` на 4 напоминания). Тяжесть: `серьёзно`.
3. `К2, К1 · Inbox (без модели) · пакеты уведомлений` — заявлены 35 команд без модели, но в [dataset.cjs:198](/design-review/stage0/harness/dataset.cjs:198) `pr-482` и `ci-failed` идут с одного `notifications@codeforge.example`, а `nw-1432` и `nw-1398` — с одного `noreply@trackline.example`: без семантики не отделить 3 откладываемых от пакета `Archive 3`. Тяжесть: `серьёзно`.
4. `К1, К5 · Inbox · навигация 200 px при 1100–1220 px и All Mail / Archive` — до `1100 px` колонки `200+420 px` оставляют читателю `480–600 px` (скролл на рассылках `width="600"`, [dataset.cjs:82](/design-review/stage0/harness/dataset.cjs:82)), а раздельные `All Mail` и `Archive` при снятии `INBOX` ([useMailState.ts:1325](/renderer/src/stores/useMailState.ts:1325)) раздувают меню до 11 папок. Тяжесть: `мелочь`.

### 2. Проверка утверждений автора

- **Задержки в [useMailSync.ts:191](/renderer/src/stores/useMailSync.ts:191), [index.ts:2542](/main/index.ts:2542), [searchCommitController.ts:1](/renderer/src/components/layout/searchCommitController.ts:1), [ai.ts:310](/main/ai.ts:310):** подтверждается.
- **Разделение `App.tsx:985` и `Unified Inbox` p95 366 мс:** подтверждается (скролл уже 59,8 fps, 366 мс на `⌘0`); причина `Undo` 119 мс видна в [useMailState.ts:1326](/renderer/src/stores/useMailState.ts:1326).
- **60 → 35 команд:** не подтверждается. С учётом пресетов `SnoozeMenu`, распада уведомлений без модели и OAuth `Calendar` выйдет **40–45 действий**.

### 3. Что стоит забрать

- Стабильную очередь за `New mail` и списки `Later`, `Waiting`, `Outbox` с возвратом письма при сбое отправки.
- Отказ выдавать `onScroll` за доказанную причину хвоста `Unified Inbox`.
- Стресс-тест с намеренно ошибочной группировкой (§5) для замера пропущенных обязательств.

### 4. Оценки по К1–К5

- **К1 — 3/5:** скромный выигрыш (35 по автору, реально 40–45) и риск случайного архива пакета клавишей `E`.
- **К2 — 4/5:** встроенный OAuth и синк ≤5 с работают сразу, но без второго OAuth на `Calendar` нет честного нуля.
- **К3 — 5/5:** безупречная сверка с кодом и замерами `STAGE0.md`.
- **К4 — 4/5:** раздельные права подготовки/исполнения, защита черновика от позднего ответа модели и `Activity`.
- **К5 — 4/5:** ясное наследование `Use app defaults` / `Customized` при широковатой колонке `200 px`.

## Предложение E

### 1. Конкретные проблемы

1. `К1, К4 · Inbox / Agent decision · Archive 10` — противоречие §2 и §5: в §2 в `Archive 10` входят «3 уведомления + 3 покупки + 4 рассылки» (в [triage-baseline.mjs:31](/design-review/stage0/harness/triage-baseline.mjs:31) одно из трёх убираемых уведомлений — `Run failed: CI on main`), а в §5 попадание упавшего CI в `Archive 10` объявлено блокером. Без модели правила (§1) не соберут ни `nw-1398` отдельно от `nw-1432`, ни билет/доставку/рассылку штата без `List-Unsubscribe`, срывая «24 действия без AI». Тяжесть: `блокер`.
2. `К1 · Search / Thread · ⌘F вместо /` — перенос поиска по ящику на `⌘F` и удаление `/` ломают поиск внутри письма (`Find in message`, [App.tsx:404](/renderer/src/App.tsx:404), [appKeymap.ts:86](/shared/appKeymap.ts:86)) на треде из 14 сообщений. Тяжесть: `серьёзно`.
3. `К1, К3 · Reply · 10-секундная отмена при быстрых ответах` — в `sendDraftWithUndo` ([useDraftsState.ts:632](/renderer/src/stores/useDraftsState.ts:632)) стоит замок `if (pendingSend) return;` на 10 с: при отправке двух готовых AI-черновиков быстрее 10 с второй `⌘Enter` проигнорируется (в §4 нет очереди параллельных отправок). Тяжесть: `серьёзно`.
4. `К2, К1 · Thread / Inbox · блок нуля без Calendar и ширина ~1150 px` — удержание приглашений до RSVP требует второго OAuth (+3–5 действий), а `184+456=640 px` слева без порога схлопывания оставляют на `1150 px` лишь `510 px` читателю (скролл на HTML `600 px`). Тяжесть: `серьёзно`.

### 2. Проверка утверждений автора

- **Ссылки на [App.tsx:1074](/renderer/src/App.tsx:1074), [gmailOAuth.ts:39](/main/gmailOAuth.ts:39), [index.ts:1253](/main/index.ts:1253), [index.ts:2542](/main/index.ts:2542), [useMailSync.ts:95](/renderer/src/stores/useMailSync.ts:95):** подтверждается.
- **Поиск ([searchCommitController.ts:1](/renderer/src/components/layout/searchCommitController.ts:1)), `stream: false` ([ai.ts:310](/main/ai.ts:310), [ai.ts:603](/main/ai.ts:603)), скролл ([App.tsx:985](/renderer/src/App.tsx:985)):** подтверждается.
- **60 → 24 действия:** не подтверждается. Вынос `ci-failed` по §5, клик по `Remind if no reply` и OAuth `Calendar` дают **28–31 действие с AI**, а распад пакетов без модели — **33–38 действий**.

### 3. Что стоит забрать

- Заморозку состава открытого пакета и диалога отписки от новых писем.
- Разделение `Inbox clear` и `Pending sync` с возвратом треда при сбое отправки или RSVP.
- Разведение разового `Correct` для треда и `Apply to this sender` для правила.

### 4. Оценки по К1–К5

- **К1 — 3/5:** `Archive 10` противоречит запрету по CI из §5, `⌘F` ломает поиск в письме, без AI 24 действия недостижимы.
- **К2 — 4/5:** релизный OAuth, мгновенный синк и авто-backfill работают сразу, кроме блока приглашений без `Calendar`.
- **К3 — 5/5:** точные привязки к коду, p95-бюджеты и требование профилировать `Unified Inbox`.
- **К4 — 5/5:** лучшая защита агента: заморозка пакетов, раздельные диалоги внешних действий и точечное обучение.
- **К5 — 4/5:** чистое наследование `Use app defaults` и `Reset` на аккаунт при широковатой панели `184 px`.

## Разногласия между предложениями

1. **Структура главного списка.** **A** строит плоский `Now` со строкой `Handled · 11`; **B** делит инбокс на 6 секций с `⇧A`; **D** и **E** ведут единую очередь, но **D** дробит рутину на однородные пакеты (`Archive 3`, `Archive 4`), а **E** собирает общий `Archive 10`.
2. **Включение автоархива.** **A** запоминает отправителей после первого `↩` на пачке (откат при >10% `Undo`); **B** предлагает правило после 3 подтверждений подряд (`Cleared by rules (n)`); **D** и **E** включают автоправила только отдельной командой на отправителя и аккаунт.
3. **Барьер внешних действий.** **A** и **B** выбирают скорость: одиночная клавиша `Y`/`N` (`M` в **A**) шлёт RSVP и архивирует письмо, отписка в **A** уходит одним `↩`; **D** и **E** требуют двухшагового подтверждения с деталями для RSVP и каждого отправителя отписки.
4. **OAuth и приглашения без Calendar.** **A** оставляет пользовательский JSON; **B**, **D**, **E** встраивают OAuth в релиз, но в **D** и **E** без второго OAuth на `Calendar` приглашение блокирует «ноль», а **B** разрешает закрыть обновление клавишей `E` и просит доступ только при `Y`/`N`.
5. **Границы «нулевого инбокса».** **A** и **B** ограничиваются `rail` `56 px` (`Now`/`Inbox` + `All Mail`); **D** и **E** держат панель (`200` / `184 px`) с `Later`, `Waiting`, `Activity` (`Outbox` в **D**), сохраняя на виду отложенную работу и сбои.
