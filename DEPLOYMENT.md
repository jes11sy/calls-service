# Calls Service - Deployment Guide

## 🎯 Описание

Расширенный микросервис для управления звонками с полной интеграцией Mango Office, S3 и Real-time событиями.

## 📋 Новые возможности

### ✅ Полная интеграция Mango Office
- Обработка всех состояний звонков (Appeared, Connected, Disconnected)
- Автоматическое скачивание записей звонков
- Загрузка записей в S3/Object Storage
- Поиск операторов по SIP-адресам

### ✅ Real-time события
- Broadcast новых звонков в Realtime Service
- Broadcast обновлений звонков
- Broadcast завершения звонков

### ✅ S3 Integration
- Загрузка записей звонков в S3
- Поддержка Selectel, AWS S3, MinIO
- Генерация presigned URLs для доступа к записям

---

## 🚀 Локальная установка

### 1. Установка зависимостей

```bash
cd api-services/calls-service
npm install
```

### 2. Настройка окружения

Создайте `.env` файл:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/callcentre_crm

# JWT
JWT_SECRET=your-jwt-secret-key

# Server
PORT=5003
CORS_ORIGIN=http://localhost:3000

# Mango Office API
MANGO_OFFICE_API_KEY=your-mango-api-key
MANGO_OFFICE_API_SALT=your-mango-api-salt
MANGO_API_URL=https://app.mango-office.ru/vpbx

# S3 / Object Storage (Selectel)
S3_BUCKET_NAME=callcentre-recordings
S3_REGION=ru-1
S3_ENDPOINT=https://s3.selcdn.ru
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key

# Realtime Service
REALTIME_SERVICE_URL=http://localhost:5009
WEBHOOK_TOKEN=your-webhook-secret-token
```

### 3. Prisma миграция

```bash
npx prisma generate
npx prisma db push
```

### 4. Запуск

```bash
npm run start:dev
```

---

## 🐳 Docker Deployment

### 1. Сборка образа

```bash
docker build -t your-registry/calls-service:latest .
```

### 2. Запуск контейнера

```bash
docker run -d \
  --name calls-service \
  -p 5003:5003 \
  -e DATABASE_URL="postgresql://user:pass@postgres:5432/db" \
  -e JWT_SECRET="your-secret" \
  -e MANGO_OFFICE_API_KEY="your-key" \
  -e MANGO_OFFICE_API_SALT="your-salt" \
  -e S3_BUCKET_NAME="your-bucket" \
  -e S3_ACCESS_KEY_ID="your-key" \
  -e S3_SECRET_ACCESS_KEY="your-secret" \
  -e REALTIME_SERVICE_URL="http://realtime-service:5009" \
  -e WEBHOOK_TOKEN="your-token" \
  your-registry/calls-service:latest
```

---

## ☸️ Kubernetes Deployment

### 1. Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: calls-service-secrets
  namespace: crm
type: Opaque
stringData:
  DATABASE_URL: "postgresql://user:pass@postgres:5432/db"
  JWT_SECRET: "your-jwt-secret"
  MANGO_OFFICE_API_KEY: "your-mango-key"
  MANGO_OFFICE_API_SALT: "your-mango-salt"
  S3_BUCKET_NAME: "callcentre-recordings"
  S3_ACCESS_KEY_ID: "your-s3-key"
  S3_SECRET_ACCESS_KEY: "your-s3-secret"
  WEBHOOK_TOKEN: "your-webhook-token"
```

### 2. Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: calls-service
  namespace: crm
spec:
  replicas: 2
  selector:
    matchLabels:
      app: calls-service
  template:
    metadata:
      labels:
        app: calls-service
    spec:
      containers:
      - name: calls-service
        image: your-registry/calls-service:latest
        ports:
        - containerPort: 5003
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: calls-service-secrets
              key: DATABASE_URL
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: calls-service-secrets
              key: JWT_SECRET
        - name: MANGO_OFFICE_API_KEY
          valueFrom:
            secretKeyRef:
              name: calls-service-secrets
              key: MANGO_OFFICE_API_KEY
        - name: MANGO_OFFICE_API_SALT
          valueFrom:
            secretKeyRef:
              name: calls-service-secrets
              key: MANGO_OFFICE_API_SALT
        - name: MANGO_API_URL
          value: "https://app.mango-office.ru/vpbx"
        - name: S3_BUCKET_NAME
          valueFrom:
            secretKeyRef:
              name: calls-service-secrets
              key: S3_BUCKET_NAME
        - name: S3_REGION
          value: "ru-1"
        - name: S3_ENDPOINT
          value: "https://s3.selcdn.ru"
        - name: S3_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef:
              name: calls-service-secrets
              key: S3_ACCESS_KEY_ID
        - name: S3_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: calls-service-secrets
              key: S3_SECRET_ACCESS_KEY
        - name: REALTIME_SERVICE_URL
          value: "http://realtime-service:5009"
        - name: WEBHOOK_TOKEN
          valueFrom:
            secretKeyRef:
              name: calls-service-secrets
              key: WEBHOOK_TOKEN
        - name: PORT
          value: "5003"
        - name: CORS_ORIGIN
          value: "https://test-shem.ru"
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 5003
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 5003
          initialDelaySeconds: 10
          periodSeconds: 5
```

### 3. Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: calls-service
  namespace: crm
spec:
  selector:
    app: calls-service
  ports:
  - protocol: TCP
    port: 5003
    targetPort: 5003
```

---

## 🔧 Настройка Mango Office

### Webhook для звонков

1. Войдите в личный кабинет Mango Office
2. Настройки → API → Webhooks
3. Добавьте URL: `https://api.test-shem.ru/api/v1/webhook/mango`
4. Выберите события:
   - ✅ Звонки (Call events)
   - ✅ Состояния звонков (Call states)

### Webhook для записей

1. Добавьте URL: `https://api.test-shem.ru/api/v1/webhook/mango/recording`
2. Выберите события:
   - ✅ Записи звонков (Call recordings)
   - ✅ Состояние записи: Completed

---

## 🗄️ Настройка S3 (Selectel)

### 1. Создание bucket

```bash
# Через Selectel Panel
1. Перейдите в раздел "Object Storage"
2. Создайте новый контейнер "callcentre-recordings"
3. Настройте приватный доступ
```

### 2. Получение credentials

```bash
# В разделе "Object Storage" → "Ключи доступа"
S3_ACCESS_KEY_ID: <ваш ключ>
S3_SECRET_ACCESS_KEY: <ваш секретный ключ>
```

### 3. Настройка CORS (опционально)

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://test-shem.ru"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"]
    }
  ]
}
```

---

## 🔗 Интеграция с другими сервисами

### Realtime Service

Calls Service отправляет события в Realtime Service:

```typescript
// При новом звонке
POST http://realtime-service:5009/api/v1/broadcast/call-new
{
  "token": "webhook-token",
  "call": { ... },
  "rooms": ["operators", "operator:123"]
}

// При обновлении звонка
POST http://realtime-service:5009/api/v1/broadcast/call-updated
{
  "token": "webhook-token",
  "call": { ... },
  "rooms": ["operators"]
}

// При завершении звонка
POST http://realtime-service:5009/api/v1/broadcast/call-ended
{
  "token": "webhook-token",
  "call": { ... },
  "rooms": ["operators"]
}
```

---

## 📊 Мониторинг

### Health Check

```bash
curl http://localhost:5003/api/health
```

### Logs

```bash
# Docker
docker logs -f calls-service

# Kubernetes
kubectl logs -f deployment/calls-service -n crm
```

### Метрики

```bash
# Prometheus endpoint
curl http://localhost:5003/metrics
```

---

## 🐛 Troubleshooting

### Ошибка: "Mango API not configured"

**Проблема:** Не указаны `MANGO_OFFICE_API_KEY` или `MANGO_OFFICE_API_SALT`

**Решение:**
```bash
# Проверьте переменные окружения
echo $MANGO_OFFICE_API_KEY
echo $MANGO_OFFICE_API_SALT
```

### Ошибка: "S3 upload failed"

**Проблема:** Неверные S3 credentials или bucket не существует

**Решение:**
```bash
# Проверьте S3 настройки
echo $S3_BUCKET_NAME
echo $S3_ACCESS_KEY_ID

# Проверьте доступность S3
curl -I https://s3.selcdn.ru
```

### Ошибка: "Operator not found for SIP"

**Проблема:** У оператора не заполнен SIP-адрес в базе данных

**Решение:**
```sql
-- Проверьте, какой SIP приходит в webhook
-- (смотрите логи: "Operator not found for SIP: XXX")

-- Добавьте SIP-адрес оператору
UPDATE callcentre_operator 
SET sip_address = '101' 
WHERE login = 'operator1';

-- Или по ID
UPDATE callcentre_operator 
SET sip_address = '101' 
WHERE id = 1;
```

### Webhook не приходит

**Проблема:** Mango Office не может достучаться до webhook URL

**Решение:**
1. Проверьте доступность URL извне: `curl https://api.test-shem.ru/api/v1/webhook/mango`
2. Проверьте настройки Ingress/Firewall
3. Убедитесь, что SSL сертификат валиден

---

## 📝 Настройка SIP-адресов

### Заполнение SIP-адресов для операторов

Поле `sip_address` уже существует в таблице `callcentre_operator`. Заполните его для каждого оператора:

```sql
-- Заполнить SIP-адреса операторов
UPDATE callcentre_operator SET sip_address = '101' WHERE id = 1;
UPDATE callcentre_operator SET sip_address = '102' WHERE id = 2;
UPDATE callcentre_operator SET sip_address = '103' WHERE id = 3;

-- Или по логину
UPDATE callcentre_operator SET sip_address = '101' WHERE login = 'operator1';
```

---

## ✅ Проверка работоспособности

### 1. Проверка API

```bash
# Health check
curl http://localhost:5003/api/health

# Получить звонки
curl -H "Authorization: Bearer <token>" \
  http://localhost:5003/api/v1/calls
```

### 2. Тест webhook

```bash
# Симуляция webhook от Mango
curl -X POST http://localhost:5003/api/v1/webhook/mango \
  -H "Content-Type: application/json" \
  -d '{
    "call_id": "test-123",
    "call_state": "Connected",
    "from": { "number": "+79991234567" },
    "to": { "number": "sip:101@domain" },
    "timestamp": 1234567890
  }'
```

### 3. Проверка S3

```bash
# Проверить загруженные файлы
aws s3 ls s3://callcentre-recordings/callcentre/recordings/ \
  --endpoint-url https://s3.selcdn.ru
```

---

## 🔄 CI/CD

### GitHub Actions

См. `.github/workflows/docker-build.yml`

### Manual Deploy

```bash
# 1. Сборка
docker build -t your-registry/calls-service:v1.1.0 .

# 2. Push
docker push your-registry/calls-service:v1.1.0

# 3. Deploy в Kubernetes
kubectl set image deployment/calls-service \
  calls-service=your-registry/calls-service:v1.1.0 \
  -n crm

# 4. Проверка
kubectl rollout status deployment/calls-service -n crm
```

---

## 📚 Полезные ссылки

- [Mango Office API Docs](https://mango-office.ru/support/api/)
- [AWS SDK для S3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-examples.html)
- [Selectel Object Storage](https://docs.selectel.ru/en/cloud/object-storage/)
- [NestJS Documentation](https://docs.nestjs.com/)

