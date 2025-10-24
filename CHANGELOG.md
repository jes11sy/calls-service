# Changelog - Calls Service

## [2.1.0] - 2024-12-19

### 🚀 New Features

#### Enhanced Database Schema
- ✅ Added `mangoData` (Json) field to store complete Mango Office webhook data
- ✅ Added `recordingEmailSent` field to track email notifications
- ✅ Added `Phone` model for managing phone numbers
- ✅ Added `Avito` model for Avito integration
- ✅ Enhanced relationships between Call, Phone, and Avito models

#### Automatic Phone Number Management
- ✅ Automatic creation of phone numbers in database
- ✅ Phone number lookup and association with calls
- ✅ City and RK assignment from operator data

#### Enhanced Webhook Processing
- ✅ Store complete Mango Office webhook data in `mangoData` field
- ✅ Improved operator lookup by SIP address
- ✅ Better error handling for phone number creation
- ✅ Enhanced logging for debugging

### 📊 Database Changes

**New fields in Call model:**
- `mangoData: Json?` - Complete webhook data from Mango Office
- `recordingEmailSent: Boolean` - Track email notifications

**New models:**
- `Phone` - Phone number management
- `Avito` - Avito account integration

### 🔄 Migration Required

```sql
-- Add new fields to calls table
ALTER TABLE calls ADD COLUMN mango_data JSONB;
ALTER TABLE calls ADD COLUMN recording_email_sent BOOLEAN DEFAULT FALSE;

-- Create phones table
CREATE TABLE phones (
  id SERIAL PRIMARY KEY,
  number VARCHAR UNIQUE NOT NULL,
  rk VARCHAR NOT NULL,
  city VARCHAR NOT NULL,
  avito_name VARCHAR,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create avito table
CREATE TABLE avito (
  id SERIAL PRIMARY KEY,
  name VARCHAR UNIQUE NOT NULL,
  client_id VARCHAR NOT NULL,
  client_secret VARCHAR NOT NULL,
  proxy_type VARCHAR,
  proxy_host VARCHAR,
  proxy_port INTEGER,
  proxy_login VARCHAR,
  proxy_password VARCHAR,
  connection_status VARCHAR DEFAULT 'not_checked',
  proxy_status VARCHAR DEFAULT 'not_checked',
  account_balance DECIMAL DEFAULT 0,
  ads_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  contacts_count INTEGER DEFAULT 0,
  views_today INTEGER DEFAULT 0,
  contacts_today INTEGER DEFAULT 0,
  last_sync_at TIMESTAMP,
  eternal_online_enabled BOOLEAN DEFAULT FALSE,
  is_online BOOLEAN DEFAULT FALSE,
  last_online_check TIMESTAMP,
  online_keep_alive_interval INTEGER DEFAULT 300,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign key constraints
ALTER TABLE calls ADD CONSTRAINT fk_calls_phone 
  FOREIGN KEY (phone_ats) REFERENCES phones(number);

ALTER TABLE calls ADD CONSTRAINT fk_calls_avito 
  FOREIGN KEY (avito_name) REFERENCES avito(name);

-- Add indexes
CREATE INDEX idx_calls_phone_ats ON calls(phone_ats);
CREATE INDEX idx_calls_avito_name ON calls(avito_name);
```

---

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

