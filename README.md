# Calls Service

Микросервис для управления звонками и интеграции с Mango Office.

## Функционал

### Calls Management
- CRUD операции для звонков
- История звонков по клиентам
- Статистика звонков
- Фильтрация по операторам, датам, статусам

### Mango Office Integration (Полная)
- ✅ Прием вебхуков от Mango Office (все состояния)
- ✅ Обработка событий: Appeared, Connected, Disconnected
- ✅ Автоматическое сохранение звонков
- ✅ Скачивание записей звонков через Mango API
- ✅ Загрузка записей в S3/Object Storage
- ✅ Поиск операторов по SIP-адресам
- ✅ Определение статусов звонков (answered, missed, busy, no_answer)

### Real-time Events
- ✅ Интеграция с Realtime Service
- ✅ Broadcast событий новых звонков
- ✅ Broadcast обновлений звонков
- ✅ Broadcast завершения звонков

## API Endpoints

### Calls
- `GET /api/v1/calls` - Получить все звонки
- `GET /api/v1/calls/stats` - Статистика звонков
- `GET /api/v1/calls/:id` - Получить звонок по ID
- `GET /api/v1/calls/by-phone/:phone` - Звонки по номеру
- `POST /api/v1/calls` - Создать звонок вручную
- `PUT /api/v1/calls/:id` - Обновить звонок

### Webhook
- `POST /api/v1/webhook/mango` - Вебхук от Mango Office
- `POST /api/v1/webhook/mango/recording` - Вебхук для записей

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:port/db

# Auth
JWT_SECRET=your-secret

# Server
PORT=5003
CORS_ORIGIN=http://localhost:3000

# Mango Office API
MANGO_OFFICE_API_KEY=your-api-key
MANGO_OFFICE_API_SALT=your-api-salt
MANGO_API_URL=https://app.mango-office.ru/vpbx

# S3 / Object Storage
S3_BUCKET_NAME=your-bucket
S3_REGION=us-east-1
S3_ENDPOINT=https://s3.selcdn.ru
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret

# Realtime Service
REALTIME_SERVICE_URL=http://realtime-service:5009
WEBHOOK_TOKEN=your-webhook-token
```

## Mango Office Webhook Configuration

### 1. Webhook для звонков
**URL:** `https://api.test-shem.ru/api/v1/webhook/mango`

**Поддерживаемые события:**
- `call_state: Appeared` - звонок появился
- `call_state: Connected` - звонок принят
- `call_state: Disconnected` - звонок завершен

### 2. Webhook для записей
**URL:** `https://api.test-shem.ru/api/v1/webhook/mango/recording`

**События:**
- `recording_state: Completed` - запись готова
- Автоматическое скачивание и загрузка в S3

### Настройка в Mango Office

1. Войдите в личный кабинет Mango Office
2. Перейдите в раздел "Настройки" → "API"
3. Добавьте webhook URL
4. Выберите события: "Звонки" и "Записи звонков"
5. Сохраните настройки

## Docker

```bash
docker build -t calls-service .
docker run -p 5003:5003 calls-service
```



