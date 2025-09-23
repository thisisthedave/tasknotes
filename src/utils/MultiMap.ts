/**
 * MultiMap<K, V>
 * - Like Map<K, V> but each key can hold many V's.
 * - Iterable over [K, V] pairs (flattened).
 * - Ergonomics similar to Map: add/get/has/delete/clear/forEach/keys/values/entries.
 *
 * Options:
 *   - allowDuplicates (default: false): if false, each key behaves like a Set<V>.
 *
 * Delete semantics:
 *   - delete(key)                -> removes the whole bucket for key.
 *   - delete(key, value)         -> removes one value occurrence (or the only one if allowDuplicates=false).
 *   - delete(key, value, {all:true}) -> removes all matching occurrences of that value.
 * 
 *  ---------- Usage examples ---------- 
 * 
 *    const mm = new MultiMap<string, number>(undefined, { allowDuplicates: false })
 *    mm.add("a", 1).add("a", 1).add("a", 2)   // duplicates ignored by default => values = [1,2]
 *    mm.addAll("b", [3, 3, 4])
 *
 *    console.log([...mm.entries()])           // [["a",1],["a",2],["b",3],["b",4]]
 *    console.log(mm.get("b"))                 // [3,4]
 *    console.log(mm.has("a", 2))              // true
 *    mm.delete("b", 3, { all: true })         // remove all 3s under "b"
 *    console.log(mm.get("b"))                 // [4]
 *
 *    // Allow exact duplicates (bag-style) with allowDuplicates: true
 *    const bag = new MultiMap<string, string>(undefined, { allowDuplicates: true })
 *    bag.add("tags", "red").add("tags", "red").add("tags", "blue")
 *    console.log([...bag.get("tags")])        // ["red","red","blue"]
 *    bag.delete("tags", "red")                // removes one "red" (keeps the other)
 *
 */
export class MultiMap<K, V> implements Iterable<[K, V]> {
    private buckets: Map<K, V[]>
    private readonly allowDuplicates: boolean

    constructor(
        iterable?: Iterable<[K, V]>,
        options?: { allowDuplicates?: boolean }
    ) {
        this.allowDuplicates = options?.allowDuplicates ?? false
        this.buckets = new Map<K, V[]>()
        if (iterable) {
            for (const [k, v] of iterable) this.add(k, v)
        }
    }

    /** Number of keys (not total values) */
    get size(): number {
        return this.buckets.size
    }

    /** Total number of (key,value) pairs across all keys */
    get sizeValues(): number {
        let n = 0
        for (const arr of this.buckets.values()) n += arr.length
        return n
    }

    /** Add a single value for a key */
    add(key: K, value: V): this {
        const arr = this.buckets.get(key)
        if (!arr) {
            this.buckets.set(key, [value])
            return this
        }
        if (this.allowDuplicates) {
            arr.push(value)
        } else {
            if (!arr.includes(value)) arr.push(value)
        }
        return this
    }

    /** Add many values for a key */
    addAll(key: K, values: Iterable<V>): this {
        for (const v of values) this.add(key, v)
        return this
    }

    /** Returns a readonly snapshot of values for key (empty array if missing) */
    get(key: K): readonly V[] {
        const arr = this.buckets.get(key)
        return arr ? arr.slice() : []
    }

    /** Does the key exist? If value is provided, checks for that value under the key. */
    has(key: K, value?: V): boolean {
        const arr = this.buckets.get(key)
        if (!arr) return false
        return value === undefined ? true : arr.includes(value)
    }

    /**
     * Delete API:
     *  - delete(key) -> remove the entire key bucket.
     *  - delete(key, value) -> remove ONE occurrence of value under key.
     *  - delete(key, value, {all:true}) -> remove ALL occurrences of value under key.
     * Returns true if anything was removed.
     */
    delete(key: K, value?: V, opts?: { all?: boolean }): boolean {
        if (value === undefined) {
            return this.buckets.delete(key)
        }
        const arr = this.buckets.get(key)
        if (!arr) return false

        let removed = false
        if (opts?.all) {
            const oldLen = arr.length
            let write = 0
            for (let read = 0; read < arr.length; read++) {
                if (arr[read] !== value) arr[write++] = arr[read]
            }
            arr.length = write
            removed = write !== oldLen
        } else {
            const idx = arr.indexOf(value)
            if (idx !== -1) {
                arr.splice(idx, 1)
                removed = true
            }
        }

        if (arr.length === 0) this.buckets.delete(key)
        return removed
    }

    /** Remove all values for all keys */
    clear(): void {
        this.buckets.clear()
    }

    /** Iterate over keys (each key once) */
    keys(): IterableIterator<K> {
        return this.buckets.keys()
    }

    /** Iterate over values (flattened across keys) */
    *values(): IterableIterator<V> {
        for (const arr of this.buckets.values()) {
            for (const v of arr) yield v
        }
    }

    /** Iterate over [key, value] for each value (flattened) */
    *entries(): IterableIterator<[K, V]> {
        for (const [k, arr] of this.buckets) {
            for (const v of arr) yield [k, v] as [K, V]
        }
    }

    /** Iterate over [key, readonly values[]] (one entry per key) */
    *entriesByKey(): IterableIterator<[K, readonly V[]]> {
        for (const [k, arr] of this.buckets) {
            yield [k, arr.slice()] as [K, readonly V[]]
        }
    }

    /** Find the index of a value across all entries. */
    indexOf(value: V, key?: K): number {
        let index: number = 0;
        if (key == undefined) {
            for (const [k, arr] of this.buckets) {
                const i = arr.indexOf(value);
                if (i !== -1) {
                    return i;
                }
            }
        } else {
            for (const [k, arr] of this.buckets) {
                if (k != key) {
                    index += arr.length;
                } else {
                    const i = arr.indexOf(value);
                    return i == -1 ? -1 : index + i;
                }
            }
        }
        return -1;
    }

    /**
     * Returns the next element after (key, indexInKey) in flattened order,
     * or undefined if (key, indexInKey) is the last element or key is not found.
     */
    nextAfter(key: K, indexInKey: number):
        | { key: K; value: V; indexInKey: number }
        | undefined
    {
        const bucket = this.buckets.get(key);
        if (!bucket) return undefined;
        if (indexInKey + 1 < bucket.length) {
            return { key, value: bucket[indexInKey + 1], indexInKey: indexInKey + 1 };
        }

        let foundKey = false;
        for (const [k, values] of this.buckets.entries()) {
            if (foundKey) {
                return { key: k, value: values[0], indexInKey: 0 };
            }
            if (key === k) {
                foundKey = true;
            }
        }
        return undefined;
    }

    prevBefore(key: K, indexInKey: number):
        | { key: K; value: V; indexInKey: number }
        | undefined
    {
        if (indexInKey > 0) {
            const bucket = this.buckets.get(key);
            if (!bucket) return undefined;
            return { key, value: bucket[indexInKey - 1], indexInKey: indexInKey - 1 };
        }
        let prev: [K, readonly V[]] | undefined = undefined;
        for (const [k, values] of this.buckets.entries()) {
            if (k === key) {
                if (prev !== undefined) {
                    return { key: prev[0], value: prev[1][prev[1].length - 1], indexInKey: prev[1].length - 1 };
                } else {
                    return undefined;
                }
            }
            prev = [k, values];
        }
        return undefined;
    }

    /**
     * Map-like forEach over flattened entries.
     * Callback receives (value, key, index, multimap),
     * where index is the zero-based position across ALL values (in insertion order).
     *
     * NOTE: passing a callback with fewer parameters still works fine:
     *   mm.forEach((v) => { ... })                     // ok
     *   mm.forEach((v, k) => { ... })                  // ok
     *   mm.forEach((v, k, i) => { ... })               // ok
     *   mm.forEach((v, k, i, self) => { ... })         // ok
     * @param callbackfn A function that accepts up to three arguments. forEach calls the callbackfn function one time for each element in the array.
     * @param thisArg An object to which the this keyword can refer in the callbackfn function. If thisArg is omitted, undefined is used as the this value.
     */
    forEach(
        callbackfn: (value: V, key: K, index: number, multimap: this) => void,
        thisArg?: unknown
    ): void {
        let i = 0
        for (const [k, arr] of this.buckets) {
            for (const v of arr) {
                callbackfn.call(thisArg, v, k, i++, this)
            }
        }
    }

    /**
     * Array-like slice over the flattened values.
     * Semantics match Array.prototype.slice:
     *  - start is inclusive (default 0), end is exclusive (default length)
     *  - negative indices count from the end
     * Returns a new array of values in insertion order across all keys.
     */
    slice(start?: number, end?: number): V[] {
        const length = this.sizeValues

        // Normalize indices like Array.prototype.slice
        let s = start ?? 0
        let e = end ?? length
        if (s < 0) s = Math.max(length + s, 0)
        else s = Math.min(s, length)
        if (e < 0) e = Math.max(length + e, 0)
        else e = Math.min(e, length)
        if (e <= s) return []

        const out: V[] = []
        let i = 0
        for (const arr of this.buckets.values()) {
            for (const v of arr) {
                if (i >= s) {
                    if (i >= e) return out
                    out.push(v)
                }
                i++
            }
        }
        return out
    }

    /** Array-like filter over flattened values. */
    filter(predicatefn: (value: V) => boolean): V[] {
        const out: V[] = []
        this.forEach((value) => {
            if (predicatefn(value)) {
                out.push(value)
            }
        })
        return out
    }

    /**
     * Array-like map over flattened entries.
     * Callback receives (value, key, index, multimap),
     * where index is the zero-based position across ALL values (in insertion order).
     *
     * NOTE: passing a callback with fewer parameters still works fine:
     *   mm.map((v) => { ... })                     // ok
     *   mm.map((v, k) => { ... })                  // ok
     *   mm.map((v, k, i) => { ... })               // ok
     *   mm.map((v, k, i, self) => { ... })         // ok
     * @param callbackfn A function that accepts up to three arguments. The map method calls the callbackfn function one time for each element in the array.
     * @param thisArg An object to which the this keyword can refer in the callbackfn function. If thisArg is omitted, undefined is used as the this value.
     */
    map<U>(
        transformfn: (value: V, key: K, index: number, multimap: this) => U,
        thisArg?: unknown
    ): U[] {
        const out: U[] = []
        let i = 0
        for (const [k, arr] of this.buckets) {
            for (const v of arr) {
                out.push(transformfn.call(thisArg, v, k, i++, this))
            }
        }
        return out;
    }

    /**
     * Flatten all values across all keys into a single array.
     * Preserves insertion order (Map key order, then per-bucket value order).
     */
    flatten(): V[] {
        const out: V[] = new Array(this.sizeValues) // preallocate
        let i = 0
        for (const arr of this.buckets.values()) {
            for (const v of arr) {
                out[i++] = v
            }
        }
        return out
    }

    /** Default iterator yields flattened [key, value] pairs */
    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries()
    }

    /** Create from flattened entries */
    static from<K, V>(
        iterable: Iterable<[K, V]>,
        options?: { allowDuplicates?: boolean }
    ): MultiMap<K, V> {
        return new MultiMap(iterable, options)
    }
}

