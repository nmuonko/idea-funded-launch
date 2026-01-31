import { useState, useCallback, useRef, useEffect } from 'react';

interface ResilientFetchOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
  onRetry?: (attempt: number, error: Error) => void;
  shouldRetry?: (error: Error) => boolean;
}

interface ResilientFetchResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  isRetrying: boolean;
  retryCount: number;
  retry: () => void;
  reset: () => void;
}

const DEFAULT_OPTIONS: Required<Omit<ResilientFetchOptions, 'onRetry' | 'shouldRetry'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  jitterFactor: 0.3,
};

/**
 * Hook for resilient data fetching with exponential backoff
 * Automatically retries failed requests with increasing delays
 */
export function useResilientFetch<T>(
  fetcher: () => Promise<T>,
  options: ResilientFetchOptions = {}
): ResilientFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  // Calculate delay with exponential backoff and jitter
  const calculateDelay = useCallback((attempt: number): number => {
    const exponentialDelay = Math.min(
      opts.baseDelayMs * Math.pow(2, attempt),
      opts.maxDelayMs
    );
    // Add jitter to prevent thundering herd
    const jitter = exponentialDelay * opts.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, exponentialDelay + jitter);
  }, [opts.baseDelayMs, opts.maxDelayMs, opts.jitterFactor]);

  // Check if we should retry based on error type
  const shouldRetryError = useCallback((err: Error): boolean => {
    if (options.shouldRetry) {
      return options.shouldRetry(err);
    }
    
    // Don't retry on circuit breaker open
    if (err.message.includes('CIRCUIT_OPEN')) {
      return false;
    }
    
    // Don't retry on auth errors
    if (err.message.includes('401') || err.message.includes('403')) {
      return false;
    }
    
    // Don't retry on validation errors
    if (err.message.includes('400') || err.message.includes('422')) {
      return false;
    }
    
    // Retry on network errors and 5xx
    return true;
  }, [options.shouldRetry]);

  const execute = useCallback(async (attempt: number = 0) => {
    if (!isMountedRef.current) return;

    // Cancel any pending retry
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setIsLoading(true);
    if (attempt > 0) {
      setIsRetrying(true);
    }
    setRetryCount(attempt);

    try {
      const result = await fetcher();
      
      if (!isMountedRef.current) return;
      
      setData(result);
      setError(null);
      setIsRetrying(false);
    } catch (err) {
      if (!isMountedRef.current) return;
      
      const fetchError = err instanceof Error ? err : new Error(String(err));
      
      // Check if we should retry
      if (attempt < opts.maxRetries && shouldRetryError(fetchError)) {
        const delay = calculateDelay(attempt);
        
        options.onRetry?.(attempt + 1, fetchError);
        
        console.log(`[ResilientFetch] Retry ${attempt + 1}/${opts.maxRetries} in ${delay}ms`);
        
        timeoutRef.current = window.setTimeout(() => {
          execute(attempt + 1);
        }, delay);
      } else {
        // Max retries reached or non-retryable error
        setError(fetchError);
        setIsRetrying(false);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [fetcher, opts.maxRetries, calculateDelay, shouldRetryError, options.onRetry]);

  const retry = useCallback(() => {
    setError(null);
    execute(0);
  }, [execute]);

  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setData(null);
    setError(null);
    setIsLoading(false);
    setIsRetrying(false);
    setRetryCount(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    data,
    error,
    isLoading,
    isRetrying,
    retryCount,
    retry,
    reset,
  };
}

/**
 * Hook for one-shot resilient fetch that executes immediately
 */
export function useResilientQuery<T>(
  fetcher: () => Promise<T>,
  dependencies: any[] = [],
  options: ResilientFetchOptions = {}
): ResilientFetchResult<T> {
  const result = useResilientFetch(fetcher, options);
  
  useEffect(() => {
    result.retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  
  return result;
}
