# Стенд для запуска Dumka Mail на синтетической почте

Запускает собранное приложение без изменений в коде: подменный `HOME`, поддельный Keychain,
поддельный Google/AI-бэкенд поверх `fetch`. В настоящую сеть и почту приложение не ходит.

```bash
export DR_SCRATCH=/путь/к/временной/папке        # вне репозитория
mkdir -p "$DR_SCRATCH/app/node_modules/@modelcontextprotocol"
cp -R dist dist-electron package.json "$DR_SCRATCH/app/"
cp -R node_modules/better-sqlite3 node_modules/bindings node_modules/file-uri-to-path "$DR_SCRATCH/app/node_modules/"
# better-sqlite3 в node_modules собран под Node (для vitest); Electron нужен свой бинарник:
cp "release/mac/Dumka Mail.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node" \
   "$DR_SCRATCH/app/node_modules/better-sqlite3/build/Release/"
ln -s "$PWD/node_modules/@modelcontextprotocol/sdk" "$DR_SCRATCH/app/node_modules/@modelcontextprotocol/sdk"
ln -s "$PWD/node_modules/eventsource" "$DR_SCRATCH/app/node_modules/eventsource"

design-review/stage0/harness/launch.sh demo fresh=1            # пустой профиль
design-review/stage0/harness/launch.sh demo DR_AI=1            # с заскриптованной моделью
node design-review/stage0/harness/connect-work.mjs             # «подключить» рабочий ящик
node design-review/stage0/harness/measure.mjs my-run 10        # замеры отзывчивости
```

Переменные: `DR_OAUTH=0` (без файла OAuth-клиента), `DR_AI=1`, `DR_BIG_INBOX=3000`, `DR_WORK_BULK`, `DR_HOME_BULK`.
Управление на лету: `POST http://127.0.0.1:9334/state` с `{"offline":true}`, `{"failGmailStatus":500}`, `{"aiFail":true}`.
