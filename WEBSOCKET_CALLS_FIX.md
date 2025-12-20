# Исправление: Уведомления о новых звонках через WebSocket

## Проблема
WebSocket уведомления о новых звонках не приходили на фронтенд при создании звонков вручную через API.

## Причина
В методе `createCall` в `calls.service.ts` отсутствовал вызов `broadcastNewCall` для отправки WebSocket уведомления. Broadcast выполнялся только при создании звонков через webhooks от Mango Office (`webhook.service.ts`), но не при ручном создании через API.

## Внесенные изменения

### 1. Обновлен `calls.service.ts`
**Файл:** `api-services/calls-service/src/calls/calls.service.ts`

- ✅ Добавлен импорт `RealtimeService`
- ✅ Добавлен `RealtimeService` в конструктор
- ✅ Добавлен вызов `broadcastNewCall` после создания звонка в методе `createCall`
- ✅ Включен `operator` в include при создании звонка для корректной отправки данных

```typescript
// Добавлено в createCall после создания звонка:
await this.realtimeService.broadcastNewCall(call, [
  'operators',
  `operator:${user.userId}`,
]);
```

### 2. Обновлен `calls.module.ts`  
**Файл:** `api-services/calls-service/src/calls/calls.module.ts`

- ✅ Добавлен импорт `RealtimeModule`
- ✅ Добавлен `RealtimeModule` в массив imports модуля

## Как это работает

### Поток данных:
1. **Создание звонка** → `calls.service.ts` → `createCall()`
2. **Отправка в Realtime Service** → `RealtimeService.broadcastNewCall()`
3. **HTTP запрос** → `POST /api/v1/broadcast/call-new` (realtime-service)
4. **Broadcast через WebSocket** → `EventsGateway.broadcastToAll('call:new', call)`
5. **Получение на фронтенде** → Socket слушатель `call:new`

### Комнаты для broadcast:
- `operators` - все операторы
- `operator:${userId}` - конкретный оператор

## Проверка работы

### На бэкенде (calls-service логи):
```
✅ Broadcasted new call: {call_id}
```

### На бэкенде (realtime-service логи):
```
📡 [broadcastToAll] Event: call:new, Connected users: N
✅ [broadcastToAll] Emitted call:new to N users via Socket.IO
```

### На фронтенде (console):
```
📞 NEW CALL EVENT RECEIVED: {...}
```

## Совместимость
- ✅ Полностью обратно совместимо
- ✅ Не влияет на существующую логику webhooks
- ✅ Работает для обоих способов создания звонков (вручную и через webhooks)

## Дополнительные проверки

### Проверить переменные окружения в calls-service:
```env
WEBHOOK_TOKEN=your-secret-token
REALTIME_SERVICE_URL=http://realtime-service:5009
```

Если `WEBHOOK_TOKEN` не настроен, в логах будет:
```
⚠️ WEBHOOK_TOKEN not configured - realtime broadcasts disabled
```

### Проверить на фронтенде:
1. WebSocket подключение: `useSocket` или `useGlobalSocket`
2. Слушатель события `call:new`
3. Автоматическое обновление списка звонков

## Дата исправления
20 декабря 2025

