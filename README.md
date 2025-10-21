# Calls Service

Микросервис для управления звонками и интеграции с Mango Office.

## Функционал

### Calls Management
- CRUD операции для звонков
- История звонков по клиентам
- Статистика звонков
- Фильтрация по операторам, датам, статусам

### Mango Office Integration
- Прием вебхуков от Mango Office
- Автоматическое сохранение звонков
- Получение записей звонков
- Обработка входящих и исходящих звонков

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
DATABASE_URL=postgresql://user:pass@host:port/db
JWT_SECRET=your-secret
PORT=5003
```

## Mango Office Webhook Configuration

**URL для вебхуков:** `https://api.test-shem.ru/api/v1/webhook/mango`

**Поддерживаемые события:**
- `CALL_RESULT` - результат звонка
- `RECORDING` - запись звонка

## Docker

```bash
docker build -t calls-service .
docker run -p 5003:5003 calls-service
```

