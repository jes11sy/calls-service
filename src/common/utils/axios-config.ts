import axios, { AxiosInstance } from 'axios';
import * as https from 'https';

/**
 * Создаёт axios instance с retry логикой
 * 
 * БЕЗОПАСНОСТЬ: SSL верификация включена по умолчанию.
 * Отключение через DISABLE_SSL_VERIFY=true допустимо ТОЛЬКО для:
 * - Локальной разработки
 * - Внутренних сервисов в Kubernetes с self-signed сертификатами
 * 
 * В production с публичными API всегда используйте SSL верификацию!
 */
export function createRetryableAxiosInstance(baseTimeout: number = 5000, retries: number = 3): AxiosInstance {
  // SSL верификация включена по умолчанию для безопасности
  const disableSSLVerify = process.env.DISABLE_SSL_VERIFY === 'true';
  
  if (disableSSLVerify) {
    console.warn('⚠️ SSL verification is DISABLED. This should only be used in development or for internal services.');
  }

  const instance = axios.create({
    timeout: baseTimeout,
    httpsAgent: new https.Agent({  
      rejectUnauthorized: !disableSSLVerify // SSL верификация включена по умолчанию
    })
  });

  // Add retry interceptor
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;

      if (!config || !config.retry) {
        config.retry = { count: 0, maxRetries: retries };
      }

      config.retry.count += 1;

      // Check if we should retry
      const shouldRetry =
        config.retry.count < config.retry.maxRetries &&
        (!error.response || error.response.status >= 500 || error.code === 'ECONNABORTED');

      if (shouldRetry) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, config.retry.count), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));

        return instance(config);
      }

      return Promise.reject(error);
    }
  );

  return instance;
}

