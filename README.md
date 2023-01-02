# BurstValve

An in memory queue for async processes in high concurrency code paths.

## How it works

Wrap any async method in a fetcher process to create a buffer where there will only ever be a single active request for that method at any given time.

![BurstValve](https://user-images.githubusercontent.com/204407/200234474-bf8d8d46-2551-41db-b3cb-ae289bd25c22.jpg)

_A very crude example_: given an application that displays public customer information, a common service method would be one that fetches the base customer information.

```ts
export const getCustomer = async (id: string) => {
  return await sql.query("SELECT id, name FROM customers WHERE id = ?", [id]);
};
```

With this function, every request would hit the database directly. Given the data is unlikely to change while multiple requests are active at the same time, the database call can be wrapped inside a BurstValve instance so that only a single concurrent query is ever active for the specified customer.

```ts
const valve = new BurstValve<Customer>(async (id: string) => {
  return await sql.query("SELECT id, name FROM customers WHERE id = ?", [id]);
});

export const getCustomer = async (id: string) => {
  return await valve.fetch(id);
};
```

To better visualize the performance gain, a simple benchmark run was setup to test various levels of concurrency (2022 MacBook Air M2).

| [Suite](benchmark/mysql-single-fetch.ts) | 5 Concurrent          | 25 Concurrent         | 50 Concurrent         |
| ---------------------------------------- | --------------------- | --------------------- | --------------------- |
| MySQL Direct                             | 5,490 ops/sec ±0.50%  | 1,150 ops/sec ±1.93%  | 523 ops/sec ±1.58%    |
| BurstValve                               | 11,571 ops/sec ±1.05% | 11,307 ops/sec ±1.03% | 11,408 ops/sec ±1.08% |

Again, this is a very crude example. Adding caching layer in front of the database call would improve the initial performance significantly. Even then, adding BurstValve would still add a layer of improvement as traffic rate increases.

```ts
const valve = new BurstValve<Customer>(async (id: string) => {
  const customer = await cache.get(`customer:${id}`);
  if (customer) {
    return customer;
  }

  return await sql.query("SELECT id, name FROM customers WHERE id = ?", [id]);
});
```

| [Suite](benchmark/memcached-single-fetch.ts) | 5 Concurrent          | 25 Concurrent         | 50 Concurrent         |
| -------------------------------------------- | --------------------- | --------------------- | --------------------- |
| Memcached Direct                             | 23,220 ops/sec ±0.75% | 7,971 ops/sec ±0.14%  | 4,193 ops/sec ±1.76%  |
| BurstValve                                   | 38,834 ops/sec ±0.72% | 34,557 ops/sec ±1.01% | 32,193 ops/sec ±1.03% |

## Batching

BurstValve comes with a unique batching approach, where requests for multiple unique identifiers can occur individually with parallelism. Consider the following:

```ts
const valve = new BurstValve<number, number>({
  batch: async (ids) => {
    await sleep(50);
    return ids.map((id) => id * 2);
  },
});

const [run1, run2, run3, run4] = await Promise.all([
  valve.batch([1, 2, 3]),
  valve.batch([3, 4, 5]),
  valve.fetch(4), // When batch fetcher is defined, all fetch requests route through there
  valve.fetch(8),
]);

run1; // [1, 2, 3] -> [2, 4, 6]
run2; // [3(queued), 4, 5] -> [6, 8, 10]
run3; // [4(queued)] -> 8
run4; // [8] -> 16
```

In the above example, the valve was able to detect that the identifiers `3` & `4` were already requested (active) by previous batch/fetch calls, which means they are not passed along to the batch fetcher for another query. Only inactive identifiers are requested, all active identifiers are queued to wait for a previous run to complete.

### Early Writing

To further the concept of individual queues for batch runs, the batch fetcher process provides an early writing mechanism for broadcasting results as they come in. This gives the ability for queues to be drained as quickly as possible.

```ts
const valve = new BurstValve<number, number>({
  batch: async (ids, earlyWrite) => {
    await sleep(50);
    earlyWrite(1, 50);
    await sleep(50);
    earlyWrite(2, 100);
    await sleep(50);
    earlyWrite(3, 150);
  },
});

const [run1, run2, run3] = await Promise.all([
  valve.batch([1, 2, 3]),
  valve.fetch(1),
  valve.fetch(2),
]);

// Resolution Order: run2, run3, run1
```

**Note:** While early writing may be used in conjunction with overall batch process returned results, anything early written will take priority over returned results.

### Benchmark

Performance for batch fetching will vary depending on the number of overlapping identifiers being requested, but in an optimal scenario (high bursty traffic for specific data), the gains are significant.

| [MySQL Suite](benchmark/mysql-batch-fetch.ts) | 5 Concurrent          | 25 Concurrent        | 50 Concurrent        |
| --------------------------------------------- | --------------------- | -------------------- | -------------------- |
| Direct Call                                   | 5,101 ops/sec ±0.84%  | 1,127 ops/sec ±0.98% | 492 ops/sec ±1.88%   |
| BurstValve                                    | 10,491 ops/sec ±0.75% | 9,499 ops/sec ±0.74% | 8,091 ops/sec ±0.83% |

And similar to the fetch suite at the top, gains are amplified when putting a memcached layer in front

| [Memcached Suite](benchmark/memcached-batch-fetch.ts) | 5 Concurrent          | 25 Concurrent         | 50 Concurrent         |
| ----------------------------------------------------- | --------------------- | --------------------- | --------------------- |
| Direct Call                                           | 16,735 ops/sec ±2.25% | 7,090 ops/sec ±1.84%  | 3,911 ops/sec ±0.76%  |
| BurstValve                                            | 31,030 ops/sec ±1.24% | 23,106 ops/sec ±1.27% | 16,360 ops/sec ±1.02% |

## Streaming

The stream method provides a callback style mechanism to obtain access to data as soon at it is available (anything that leverages early writing). Any identifiers requested through the stream interface will follow the batch paradigm, where overlapping ids will share responses to reduce active requests down to a single concurrency.

```ts
const valve = new BurstValve<number, number>({
  batch: async (ids, earlyWrite) => {
    await sleep(50);
    earlyWrite(1, 50);
    await sleep(50);
    earlyWrite(2, 100);
    await sleep(50);
    earlyWrite(3, 150);
  },
});

await valve.stream([1, 2, 3], async (id, result) => {
  response.write({ id, result }); // Some external request/response stream
});
```
