# 📞 Функция обратного звонка (Callback)

## Описание

Мастер может инициировать звонок клиенту прямо из интерфейса заказа. Система использует Mango Office для:
1. Звонка мастеру на указанный номер
2. После ответа мастера - соединения с клиентом
3. Клиент видит номер АТС (тот же, на который звонил изначально)

---

## 🏗️ Архитектура

> **Важно:** `calls-service` и `orders-service` используют **одну и ту же БД**, поэтому нет необходимости в HTTP запросах между сервисами. Это упрощает архитектуру и повышает производительность.

### Поток данных:

```
Frontend Master
    ↓ POST /calls/initiate-callback
Calls Service
    ↓ SELECT * FROM orders WHERE id = ?
Database (получить данные клиента)
    ↓ SELECT * FROM calls WHERE phone_client = ? ORDER BY date_create DESC
Database (получить phone_ats)
    ↓
Calls Service
    ↓ POST /commands/callback
Mango Office API
    ↓ звонит мастеру
Мастер отвечает
    ↓ соединяет с клиентом
Клиент видит phone_ats
```

---

## 📁 Файлы

### Backend (calls-service):

1. **DTO**: `src/calls/dto/initiate-callback.dto.ts`
   - Валидация `orderId` и `masterPhone`

2. **Mango Service**: `src/mango/mango.service.ts`
   - Метод `initiateCallback()` - интеграция с Mango Office API

3. **Calls Service**: `src/calls/calls.service.ts`
   - Метод `initiateCallback()`:
     - Получает заказ напрямую из БД (та же БД, что и у orders-service)
     - Определяет `phone_ats` с fallback стратегией:
       1. **Приоритет 1**: Если у заказа есть `callId` → берёт номер из этого звонка
       2. **Приоритет 2**: Если нет `callId` → ищет последний звонок от `phoneClient`
       3. **Приоритет 3**: Если клиент не звонил → берёт дефолтный номер из таблицы `phones` по `city` и `rk`
     - Инициирует callback через Mango
     - Создаёт запись в БД
     - Логирует действие

4. **Controller**: `src/calls/calls.controller.ts`
   - Эндпоинт `POST /calls/initiate-callback`
   - Доступ: `MASTER`, `ADMIN`

5. **Module**: `src/calls/calls.module.ts`
   - Импортирует `MangoModule`

### Frontend (frontend master):

1. **Компонент**: `components/CallButton.tsx`
   - Кнопка "Позвонить клиенту"
   - Модальное окно для ввода номера мастера
   - Валидация номера
   - Toast-уведомления

2. **API Client**: `lib/api.ts`
   - Метод `initiateCallback(orderId, masterPhone)`

3. **Страница заказа**: `pages/orders/[id].tsx`
   - Интеграция `CallButton` рядом с заголовком

---

## 🔧 Настройка

### 1. Mango Office API

Убедись, что настроены:

```bash
MANGO_OFFICE_API_KEY=your-mango-api-key
MANGO_OFFICE_API_SALT=your-mango-api-salt
MANGO_API_URL=https://app.mango-office.ru/vpbx
```

### 2. База данных

Структура таблицы `calls` уже поддерживает новые записи:
- `status: 'initiated'` - звонок инициирован
- `callId` - ID команды Mango Office
- `operatorId` - ID мастера

### 3. Fallback стратегия для phone_ats

Система использует **3-уровневую fallback стратегию** для определения номера АТС:

#### Приоритет 1: Звонок из заказа
Если у заказа есть `callId` (заказ создан после звонка):
```sql
SELECT phone_ats FROM calls WHERE call_id = order.callId;
```

#### Приоритет 2: История звонков клиента
Если `callId` нет, ищем последний звонок от этого номера:
```sql
SELECT phone_ats FROM calls 
WHERE phone_client = order.phone 
ORDER BY date_create DESC 
LIMIT 1;
```

#### Приоритет 3: Дефолтный номер для города/РК
Если клиент вообще не звонил, берём дефолтный номер:
```sql
SELECT number FROM phones 
WHERE city = order.city AND rk = order.rk 
LIMIT 1;
```

#### Ошибка
Если ничего не найдено → `BadRequestException`

**Важно:** Убедись, что в таблице `phones` есть номера для всех городов и РК, где работают мастера!

---

## 🚀 Развертывание

### Docker Compose / Kubernetes

Никаких дополнительных настроек не требуется - `calls-service` использует ту же БД, что и `orders-service`.

---

## 🧪 Тестирование

### 1. Через Swagger UI

```
POST /calls/initiate-callback
Authorization: Bearer <master-token>

Body:
{
  "orderId": 943,
  "masterPhone": "+79991234567"
}
```

### 2. Через Frontend

1. Открой заказ: `https://lead-schem.ru/orders/943`
2. Нажми "Позвонить клиенту"
3. Введи свой номер
4. Нажми "Позвонить"
5. Ожидай входящего звонка

### 3. Проверка логов

```bash
# Calls Service
kubectl logs -f deployment/calls-service | grep "callback"

# Ожидаемые логи:
# 📞 Initiating callback: callback_943_1234567890
# ✅ Callback initiated successfully: {...}
```

---

## 🔍 Troubleshooting

### Ошибка: "Заказ не найден"
- Проверь, что заказ с таким ID существует в БД
- Проверь подключение к БД в `calls-service`

### Ошибка: "Не найден номер АТС"
- Клиент не звонил, и нет дефолтного номера для города/РК
- **Решение**: Добавь номер в таблицу `phones` для соответствующего города и РК:
  ```sql
  INSERT INTO phones (number, rk, city) 
  VALUES ('+74951234567', 'Avito', 'Москва');
  ```
- Проверь таблицу `phones`, есть ли записи для города и РК заказа

### Ошибка: "Mango Office API не настроен"
- Проверь переменные окружения `MANGO_OFFICE_API_KEY` и `MANGO_OFFICE_API_SALT`

### Звонок не поступает мастеру
- Проверь формат номера (должен быть международный: `+79991234567`)
- Проверь логи Mango Office API
- Проверь баланс в Mango Office

---

## 📊 Мониторинг

### Метрики для отслеживания:

1. **Количество callback запросов** (по мастерам)
2. **Успешность инициации** (success rate)
3. **Время ответа Mango API**
4. **Ошибки интеграции** (БД, Mango API)

### Audit Log

Все действия логируются в `audit_log`:
- `INITIATE_CALLBACK` - успешная инициация
- `INITIATE_CALLBACK_ERROR` - ошибка

---

## 🔐 Безопасность

1. **Авторизация**: Только `MASTER` и `ADMIN` могут инициировать callback
2. **Валидация**: Номер телефона проходит валидацию на формат
3. **Audit Trail**: Все действия логируются с userId
4. **Rate Limiting**: Рекомендуется добавить ограничение (например, 10 звонков/час на мастера)

---

## 📝 TODO (будущие улучшения)

- [ ] Rate limiting для предотвращения спама
- [ ] Webhook от Mango для отслеживания статуса звонка
- [ ] История callback звонков в интерфейсе мастера
- [ ] Уведомления о статусе звонка (звонит, соединён, завершён)
- [ ] Аналитика по callback звонкам

---

## 👨‍💻 Автор

Реализовано: 2025-12-09

