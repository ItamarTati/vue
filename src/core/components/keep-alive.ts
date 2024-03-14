import { isRegExp, isArray, remove } from 'shared/util'
import { getFirstComponentChild } from 'core/vdom/helpers/index'
import type VNode from 'core/vdom/vnode'
import type { VNodeComponentOptions } from 'types/vnode'
import type { Component } from 'types/component'
import { getComponentName } from '../vdom/create-component'

/**
 * @typedef {Object} CacheEntry - Entry in the component cache.
 * @property {string} [name] - Name of the component.
 * @property {string} [tag] - Tag of the component.
 * @property {Component} [componentInstance] - Instance of the component.
 */
type CacheEntry = {
  name?: string
  tag?: string
  componentInstance?: Component
}


/**
 * @typedef {Record<string, CacheEntry | null>} CacheEntryMap - Map of component cache entries.
 */
type CacheEntryMap = Record<string, CacheEntry | null>

/**
 * Get the name of a component from its options.
 * @param {VNodeComponentOptions} [opts] - Component options.
 * @returns {string | null} - Name of the component or null.
 */
function _getComponentName(opts?: VNodeComponentOptions): string | null {
  return opts && (getComponentName(opts.Ctor.options as any) || opts.tag)
}

/**
 * Check if a name matches a pattern.
 * @param {string | RegExp | Array<string>} pattern - Pattern to match against.
 * @param {string} name - Name to match.
 * @returns {boolean} - Whether the name matches the pattern.
 */
function matches(
  pattern: string | RegExp | Array<string>,
  name: string
): boolean {
  if (isArray(pattern)) {
    return pattern.indexOf(name) > -1
  } else if (typeof pattern === 'string') {
    return pattern.split(',').indexOf(name) > -1
  } else if (isRegExp(pattern)) {
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}

/**
 * Prune the cache entries based on a filter function.
 * @param {Object} keepAliveInstance - Keep alive instance.
 * @param {CacheEntryMap} keepAliveInstance.cache - Component cache.
 * @param {Array<string>} keepAliveInstance.keys - Keys of the cache entries.
 * @param {VNode} keepAliveInstance._vnode - Current vnode.
 * @param {VNode} keepAliveInstance.$vnode - Parent vnode.
 * @param {Function} filter - Filter function.
 */
function pruneCache(
  keepAliveInstance: {
    cache: CacheEntryMap
    keys: string[]
    _vnode: VNode
    $vnode: VNode
  },
  filter: Function
) {
  const { cache, keys, _vnode, $vnode } = keepAliveInstance
  for (const key in cache) {
    const entry = cache[key]
    if (entry) {
      const name = entry.name
      if (name && !filter(name)) {
        pruneCacheEntry(cache, key, keys, _vnode)
      }
    }
  }
  $vnode.componentOptions!.children = undefined
}

/**
 * Prune a cache entry.
 * @param {CacheEntryMap} cache - Component cache.
 * @param {string} key - Key of the cache entry.
 * @param {Array<string>} keys - Keys of the cache entries.
 * @param {VNode} [current] - Current vnode.
 */
function pruneCacheEntry(
  cache: CacheEntryMap,
  key: string,
  keys: Array<string>,
  current?: VNode
) {
  const entry = cache[key]
  if (entry && (!current || entry.tag !== current.tag)) {
    // @ts-expect-error can be undefined
    entry.componentInstance.$destroy()
  }
  cache[key] = null
  remove(keys, key)
}

const patternTypes: Array<Function> = [String, RegExp, Array]

// TODO defineComponent
export default {
  name: 'keep-alive',
  abstract: true,

  props: {
    include: patternTypes,
    exclude: patternTypes,
    max: [String, Number]
  },

  methods: {
    cacheVNode() {
      const { cache, keys, vnodeToCache, keyToCache } = this
      if (vnodeToCache) {
        const { tag, componentInstance, componentOptions } = vnodeToCache
        cache[keyToCache] = {
          name: _getComponentName(componentOptions),
          tag,
          componentInstance
        }
        keys.push(keyToCache)
        // prune oldest entry
        if (this.max && keys.length > parseInt(this.max)) {
          pruneCacheEntry(cache, keys[0], keys, this._vnode)
        }
        this.vnodeToCache = null
      }
    }
  },

  created() {
    this.cache = Object.create(null)
    this.keys = []
  },

  destroyed() {
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys)
    }
  },

  mounted() {
    this.cacheVNode()
    this.$watch('include', val => {
      pruneCache(this, name => matches(val, name))
    })
    this.$watch('exclude', val => {
      pruneCache(this, name => !matches(val, name))
    })
  },

  updated() {
    this.cacheVNode()
  },

  render() {
    const slot = this.$slots.default
    const vnode = getFirstComponentChild(slot)
    const componentOptions = vnode && vnode.componentOptions
    if (componentOptions) {
      // check pattern
      const name = _getComponentName(componentOptions)
      const { include, exclude } = this
      if (
        // not included
        (include && (!name || !matches(include, name))) ||
        // excluded
        (exclude && name && matches(exclude, name))
      ) {
        return vnode
      }

      const { cache, keys } = this
      const key =
        vnode.key == null
          ? // same constructor may get registered as different local components
            // so cid alone is not enough (#3269)
            componentOptions.Ctor.cid +
            (componentOptions.tag ? `::${componentOptions.tag}` : '')
          : vnode.key
      if (cache[key]) {
        vnode.componentInstance = cache[key].componentInstance
        // make current key freshest
        remove(keys, key)
        keys.push(key)
      } else {
        // delay setting the cache until update
        this.vnodeToCache = vnode
        this.keyToCache = key
      }

      // @ts-expect-error can vnode.data can be undefined
      vnode.data.keepAlive = true
    }
    return vnode || (slot && slot[0])
  }
}
