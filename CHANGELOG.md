# Changelog - Calls Service

## [2.0.0] - 2024-10-22

### 🚀 Major Features

#### Mango Office Integration (Полная)
- ✅ Обработка всех состояний звонков:
  - `Appeared` - звонок появился в системе
  - `Connected` - звонок принят оператором
  - `Disconnected` - звонок завершен
- ✅ Скачивание записей звонков через Mango API
- ✅ Автоматическая загрузка записей в S3/Object Storage
- ✅ Поиск операторов по SIP-адресам
- ✅ Определение статусов: answered, missed, busy, no_answer
- ✅ Обработка причин завершения звонка (disconnect_reason)

#### S3 Integration
- ✅ Загрузка аудиофайлов в S3
- ✅ Поддержка Selectel Object Storage
- ✅ Поддержка AWS S3
- ✅ Поддержка MinIO
- ✅ Генерация presigned URLs для доступа к записям
- ✅ Проверка существования файлов

#### Real-time Events
- ✅ Интеграция с Realtime Service
- ✅ Broadcast новых звонков в WebSocket
- ✅ Broadcast обновлений звонков
- ✅ Broadcast завершения звонков
- ✅ Отправка в конкретные комнаты (operators, operator:ID)

### 📦 New Modules

- `MangoModule` - Взаимодействие с Mango Office API
  - `MangoService.downloadRecording()` - Скачивание записей
  - `MangoService.determineCallStatus()` - Определение статуса звонка
  - `MangoService.calculateDuration()` - Вычисление длительности
  - `MangoService.extractSipUsername()` - Извлечение SIP username

- `S3Module` - Работа с Object Storage
  - `S3Service.uploadRecording()` - Загрузка записей
  - `S3Service.getSignedUrl()` - Генерация signed URLs
  - `S3Service.checkFileExists()` - Проверка существования файла

- `RealtimeModule` - Интеграция с Realtime Service
  - `RealtimeService.broadcastNewCall()` - Broadcast новых звонков
  - `RealtimeService.broadcastCallUpdated()` - Broadcast обновлений
  - `RealtimeService.broadcastCallEnded()` - Broadcast завершения

### 🔄 Updated Services

#### WebhookService
- ✨ Полная переработка логики обработки webhook
- ✨ Поддержка новых форматов данных от Mango Office
- ✨ Улучшенная обработка ошибок
- ✨ Логирование всех этапов обработки
- ✨ Fallback на legacy формат для совместимости

**Новые методы:**
- `handleCallAppeared()` - Обработка появления звонка
- `handleCallConnected()` - Обработка соединения
- `handleCallDisconnected()` - Обработка завершения
- `handleLegacyFormat()` - Fallback для старого формата
- `findOperatorBySip()` - Поиск оператора по SIP

### 📊 Database Changes

**Нет изменений в схеме.** Используется существующее поле `sip_address` в таблице `callcentre_operator`.

### 🛠️ Environment Variables

**Новые переменные:**
```env
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

### 📝 API Changes

#### Webhook Endpoints

**Обновлен:** `POST /api/v1/webhook/mango`
- Теперь обрабатывает call_state (Appeared, Connected, Disconnected)
- Автоматически определяет статус звонка
- Ищет оператора по SIP-адресу
- Отправляет события в Realtime Service

**Обновлен:** `POST /api/v1/webhook/mango/recording`
- Скачивает запись через Mango API
- Загружает в S3 автоматически
- Обновляет запись в БД с S3 key
- Отправляет обновление в Realtime Service

### 🔧 Configuration

#### Mango Office Webhooks

**Webhook для звонков:**
```
URL: https://api.test-shem.ru/api/v1/webhook/mango
События: Call states (Appeared, Connected, Disconnected)
```

**Webhook для записей:**
```
URL: https://api.test-shem.ru/api/v1/webhook/mango/recording
События: Recording state (Completed)
```

### 📚 Dependencies

**Добавлены:**
- `@aws-sdk/client-s3: ^3.478.0` - S3 client
- `@aws-sdk/s3-request-presigner: ^3.478.0` - Signed URLs

### 🐛 Bug Fixes

- Исправлена обработка звонков без ответа
- Исправлено определение статуса по disconnect_reason
- Улучшена обработка ошибок при скачивании записей
- Исправлен fallback на default оператора

### 🔒 Security

- Добавлена валидация webhook token для Realtime Service
- Secure загрузка файлов в S3
- Безопасная генерация presigned URLs

### 📖 Documentation

- ✅ Полное руководство по деплою (DEPLOYMENT.md)
- ✅ Примеры настройки Mango Office
- ✅ Примеры настройки S3/Selectel
- ✅ Инструкции по миграции БД
- ✅ Troubleshooting guide

### ⚠️ Breaking Changes

**Нет breaking changes.** Используется существующая структура БД.

### 🔄 Setup Guide

```sql
-- Заполните SIP-адреса для операторов (если не заполнены)
UPDATE callcentre_operator SET sip_address = '101' WHERE id = 1;
UPDATE callcentre_operator SET sip_address = '102' WHERE id = 2;
UPDATE callcentre_operator SET sip_address = '103' WHERE id = 3;
```

---

## [1.0.0] - 2024-10-01

### Initial Release

- ✅ CRUD операции для звонков
- ✅ Базовая интеграция с Mango Office
- ✅ История звонков по клиентам
- ✅ JWT аутентификация
- ✅ Swagger документация

