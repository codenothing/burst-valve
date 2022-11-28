# BurstValve

An in memory queue for async processes in high concurrency code paths.

# How it works

Wrap any async method in a fetcher process to create a buffer where there will only ever be a single active request for that method at any given time.

![BurstValve](https://user-images.githubusercontent.com/204407/200234474-bf8d8d46-2551-41db-b3cb-ae289bd25c22.jpg)

_A very crude example_: given an application that displays public customer information, a common endpoint would be one that fetches the base customer information.

```ts
const app = express();
const pool = mysql.createPool({ connectionLimit: 10, ... });

app.get("/customer/:id", (req, res) => {
  pool.query("SELECT id, name FROM customers WHERE id = ?", [req.params.id], (e, results) => {
    if (e) {
      res.status(500).send(`Service Error`);
    } else {
      res.status(200).send(results[0]);
    }
  });
});
```

With this setup, every request would hit the database directly. Given the data is unlikely to change while multiple requests are active at the exact same time, the database call can be wrapped inside a BurstValve instance so that only a single concurrent query is ever active for the specified customer.

```ts
const app = express();
const pool = mysql.createPool({ connectionLimit: 10, ... });

const valve = new BurstValve<{ id: string, name: string }>(async (id: string) => {
  return new Promise((resolve, reject) => {
    pool.query("SELECT id, name FROM customers WHERE id = ?", [id], (e, results) => {
      if (e || !results || !results.length) {
        reject(e || new Error(`Unknown Error`));
      } else {
        resolve(results[0]);
      }
    });
  });
});

app.get("/customer/:id", (req, res) => {
  try {
    const data = await valve.fetch(req.params.id);
    res.status(200).send(data);
  } catch {
    res.status(500).send(`Error`);
  }
});
```

To better visualize the performance gain, a simple load test was run with 100 concurrent calls for 15s against the application (2022 MacBook Air M2).

|                 | Run 1        | Run 2        | Run 3        |
| --------------- | ------------ | ------------ | ------------ |
| Direct Call     | 10,381 req/s | 10,374 req/s | 10,363 req/s |
| With BurstValve | 19,885 req/s | 19,681 req/s | 19,742 req/s |

Again, this is a very crude example. Adding caching layer in front of the database call would improve the initial performance tremendously. Even then, adding BurstValve would still add a layer of improvement as traffic rate increases.

```ts
const valve = new BurstValve<string>(async (id: string) => {
  return new Promise((resolve, reject) => {
    memcached.get(`customer:${id}`, (e, data) => {
      if (data) {
        return resolve(data);
      }

      pool.query(
        "SELECT id, name FROM customers WHERE id = ?",
        [id],
        (e, results) => {
          if (e || !results || !results.length) {
            reject(e || new Error(`Unknown Error`));
          } else {
            const stringified = JSON.stringify(results[0]);

            memcached.set(`customer:${id}`, stringified, 60 * 60, () => {
              resolve(stringified);
            });
          }
        }
      );
    });
  });
});
```

|                 | Run 1        | Run 2        | Run 3        |
| --------------- | ------------ | ------------ | ------------ |
| Direct Call     | 16,874 req/s | 16,729 req/s | 16,674 req/s |
| With BurstValve | 20,477 req/s | 20,512 req/s | 19,580 req/s |

# Batching

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

To futher the concept of individual queues for batch runs, the batch fetcher process provides an early writing mechanism for broadcasting results as they come in. This gives the ability for queues to be drained as quickly as possible.

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

**Note:** While early writing may be used in conjunction with overal batch process returned results, anything early written will take priority over returned results.
