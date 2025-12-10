# 🐛 Исправление: Callback звонки записываются в БД

## Проблема

При использовании функции callback (обратный звонок мастеру) звонки записывались в таблицу `calls` в БД, хотя не должны были.

## Причина

Когда мастер инициирует callback через `POST /calls/initiate-callback`:
1. Система отправляет команду в Mango Office с `command_id` вида `callback_943_1234567890`
2. Mango Office инициирует звонок мастеру, затем соединяет с клиентом
3. Mango Office отправляет webhook'и с событиями звонка (`Appeared`, `Connected`, `Disconnected`, `Summary`)
4. **Проблема**: Webhook сервис не проверял `command_id` и записывал эти звонки в БД как обычные входящие

## Решение

Добавлена проверка `command_id` во всех методах обработки webhook'ов:

### Изменения в `webhook.service.ts`:

1. **`processMangoWebhook()`** - главный обработчик:
   ```typescript
   // Игнорируем callback звонки (инициированные через initiateCallback)
   if (command_id && command_id.startsWith('callback_')) {
     this.logger.log(`Ignoring callback call ${call_id}, command_id: ${command_id}`);
     return { success: true, message: 'Callback call ignored' };
   }
   ```

2. **`handleCallAppeared()`** - событие "Appeared":
   ```typescript
   // Игнорируем callback звонки
   if (command_id && command_id.startsWith('callback_')) {
     this.logger.log(`Ignoring callback call: ${call_id}, command_id: ${command_id}`);
     return { success: true, message: 'Callback call ignored' };
   }
   ```

3. **`handleCallConnected()`** - событие "Connected":
   ```typescript
   // Игнорируем callback звонки
   if (command_id && command_id.startsWith('callback_')) {
     this.logger.log(`Ignoring callback call: ${call_id}, command_id: ${command_id}`);
     return { success: true, message: 'Callback call ignored' };
   }
   ```

4. **`handleCallDisconnected()`** - событие "Disconnected":
   ```typescript
   // Игнорируем callback звонки
   if (command_id && command_id.startsWith('callback_')) {
     this.logger.log(`Ignoring callback call: ${call_id}, command_id: ${command_id}`);
     return { success: true, message: 'Callback call ignored' };
   }
   ```

5. **`handleLegacyFormat()`** - старый формат:
   ```typescript
   // Игнорируем callback звонки
   if (command_id && command_id.startsWith('callback_')) {
     this.logger.log(`Ignoring callback call (legacy): ${call_id || 'unknown'}, command_id: ${command_id}`);
     return { success: true, message: 'Callback call ignored' };
   }
   ```

6. **`processMangoSummary()`** - summary события:
   ```typescript
   // Игнорируем callback звонки
   if (command_id && command_id.startsWith('callback_')) {
     this.logger.log(`Ignoring callback call: ${entry_id}, command_id: ${command_id}`);
     return { success: true, message: 'Callback call ignored' };
   }
   ```

## Логика работы

1. Когда мастер инициирует callback, система генерирует `command_id` вида `callback_{orderId}_{timestamp}`
2. Этот `command_id` передается в Mango Office при вызове `/commands/callback`
3. Mango Office включает `command_id` во все webhook'и, связанные с этим звонком
4. Webhook сервис проверяет `command_id` и **игнорирует** звонки, начинающиеся с `callback_`
5. Такие звонки не записываются в БД и не отображаются в интерфейсе операторов

## Результат

✅ Callback звонки больше **не записываются** в таблицу `calls`  
✅ Сохраняется только информация в `audit_log` (действие `INITIATE_CALLBACK`)  
✅ Обычные входящие и исходящие звонки продолжают записываться как раньше  
✅ Добавлено логирование для отладки: `Ignoring callback call...`

## Тестирование

1. Инициируй callback через интерфейс мастера
2. Проверь логи `calls-service`:
   ```
   Ignoring callback call abc123, command_id: callback_943_1234567890
   ```
3. Проверь БД - звонок не должен появиться в таблице `calls`
4. Проверь `audit_log` - должна быть запись с action `INITIATE_CALLBACK`

## Дата исправления

2025-12-10

