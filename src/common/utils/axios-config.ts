import axios, { AxiosInstance } from 'axios';

export function createRetryableAxiosInstance(baseTimeout: number = 5000, retries: number = 3): AxiosInstance {
  const instance = axios.create({
    timeout: baseTimeout,
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

