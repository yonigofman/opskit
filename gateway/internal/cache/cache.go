// Package cache is a short-TTL, in-memory cache for upstream results, keyed
// by the caller so a key built from query + range + permission scope can
// never return another identity's data.
package cache

import (
	"sync"
	"time"
)

type entry struct {
	val      any
	expireAt time.Time
}

// Cache is a TTL map safe for concurrent use.
type Cache struct {
	mu    sync.Mutex
	ttl   time.Duration
	items map[string]entry
}

// New returns a Cache whose entries expire after ttl.
func New(ttl time.Duration) *Cache {
	return &Cache{ttl: ttl, items: make(map[string]entry)}
}

// Get returns the cached value for key, if present and unexpired.
func (c *Cache) Get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[key]
	if !ok || time.Now().After(e.expireAt) {
		return nil, false
	}
	return e.val, true
}

// Set stores val under key for the cache's TTL.
func (c *Cache) Set(key string, val any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = entry{val: val, expireAt: time.Now().Add(c.ttl)}
}
