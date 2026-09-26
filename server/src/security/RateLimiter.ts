/**
 * RateLimiter.ts - In-Memory Anti-Spam & Denial-of-Service Rate Limiter (Phase 28)
 *
 * Protects socket event endpoints against high-frequency flooding, packet macros,
 * and malicious denial-of-service attempts.
 */

interface RateBucket {
  tokens: number
  lastRefill: number
}

export class RateLimiter {
  private buckets = new Map<string, RateBucket>()
  private cleanupTimer: NodeJS.Timeout

  constructor() {
    // Periodically prune stale buckets every 60 seconds
    this.cleanupTimer = setInterval(() => {
      this.pruneStale()
    }, 60000)
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref()
    }
  }

  /**
   * Consume 1 token for the specified key using token bucket algorithm.
   * @param key Unique identifier (e.g. `${socketId}:${action}`)
   * @param maxTokens Maximum burst capacity
   * @param refillRateTokensPerSec Refill rate in tokens per second
   * @returns true if allowed, false if rate limited
   */
  public check(key: string, maxTokens: number, refillRateTokensPerSec: number): boolean {
    const now = Date.now()
    let bucket = this.buckets.get(key)

    if (!bucket) {
      bucket = {
        tokens: maxTokens - 1,
        lastRefill: now,
      }
      this.buckets.set(key, bucket)
      return true
    }

    // Refill tokens according to elapsed time
    const elapsedSec = (now - bucket.lastRefill) / 1000
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsedSec * refillRateTokensPerSec)
      bucket.lastRefill = now
    }

    if (bucket.tokens >= 1.0) {
      bucket.tokens -= 1.0
      return true
    }

    // Rate limit exceeded
    return false
  }

  /**
   * Clear all buckets associated with a specific socket/client prefix.
   */
  public clearClient(socketId: string): void {
    const prefix = `${socketId}:`
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix) || key === socketId) {
        this.buckets.delete(key)
      }
    }
  }

  private pruneStale(): void {
    const now = Date.now()
    const staleCutoff = 120000 // 2 minutes of inactivity
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > staleCutoff) {
        this.buckets.delete(key)
      }
    }
  }

  public destroy(): void {
    clearInterval(this.cleanupTimer)
    this.buckets.clear()
  }
}

export const rateLimiter = new RateLimiter()
