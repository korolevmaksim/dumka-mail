#!/bin/bash
# Builds side-by-side "было → стало" composites (2880x1040) into design-review/stage3/compare.
set -euo pipefail
cd "$(dirname "$0")/.."
S0="../../stage0/shots"; R="../renders"
names=("1 · Секции решений" "2 · Проход по решениям" "3 · Тихий инбокс")
targets=()
add() { targets+=("mocks/compare.html#$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote("|".join(sys.argv[1:5])))' "$1" "$2" "$3" "$4")@@$5"); }
i=0
for d in d1 d2 d3; do
  n="${names[$i]}"; i=$((i+1))
  add "$S0/05-inbox-default-split-important.png" "$R/mock-$d-inbox.png" "Инбокс: 5 сплитов, пустая читалка, Agenda" "$n — основной экран" "$d-1-inbox"
  add "$S0/42-ai-draft-reply-result.png" "$R/mock-$d-thread.png" "Тред и ответ: черновик агента в боковом чате" "$n — тред и ответ" "$d-2-thread"
  add "$S0/44-ai-review-queue-result.png" "$R/mock-$d-agent.png" "Действие агента: очередь в карточке 300 px" "$n — действие агента" "$d-3-agent"
  add "$S0/20-cleanup.png" "$R/mock-$d-confirm.png" "Отписка: сразу, без подтверждения" "$n — подтверждение" "$d-4-confirm"
  add "$S0/50-inbox-after-scripted-triage.png" "$R/mock-$d-empty.png" "Пусто: «Clear inbox split»" "$n — пусто" "$d-5-empty"
  add "$S0/03-onboarding-after-oauth-loading.png" "$R/mock-$d-loading.png" "Загрузка: пустой ящик и «Ready» 10–50 с" "$n — загрузка" "$d-6-loading"
  add "$S0/46-ai-error-provider-failure.png" "$R/mock-$d-error.png" "Ошибка: сырой текст исключения в чате" "$n — ошибка модели" "$d-7-error"
done
add "$S0/01-first-run-empty.png" "$R/mock-sh-firstrun.png" "Первый запуск" "Общее — первый запуск" "sh-1-firstrun"
add "$S0/02-first-run-connect-without-oauth-client.png" "$R/mock-sh-firstrunerror.png" "Нет OAuth-клиента: тост «Please try again»" "Общее — понятная ошибка входа" "sh-2-firstrunerror"
add "$S0/29-filters-panel-stuck-open-with-toasts.png" "$R/mock-sh-search.png" "Поиск: панель фильтров сдвигает экран" "Общее — поиск по всей почте" "sh-3-search"
add "$S0/settings/01-accounts.png" "$R/mock-sh-settings.png" "Аккаунт: 4 ссылки, 19 общих вкладок" "Общее — настройки аккаунта" "sh-4-settings"
rm -rf compare
RENDER_SIZE=1440x520 RENDER_WAIT=900 ../../node_modules/.bin/electron tools/render.cjs compare "${targets[@]}"
