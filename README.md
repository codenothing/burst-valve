# BurstValve

An in memory queue for async processes in high concurrency code paths.

# How it works

Wrap any async method in a fetcher process to create a buffer where there will only ever be a single active request for that method at any given time.

![BurstValve](https://user-images.githubusercontent.com/204407/200234474-bf8d8d46-2551-41db-b3cb-ae289bd25c22.jpg)


*A very crude example*: given an application that displays public customer information, a common endpoint would be one that fetches the base customer information.

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
const valve = new BurstValve<string>(
  async (id: string) => {
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
  }
);
```

|                 | Run 1        | Run 2        | Run 3        |
| --------------- | ------------ | ------------ | ------------ |
| Direct Call     | 16,874 req/s | 16,729 req/s | 16,674 req/s |
| With BurstValve | 20,477 req/s | 20,512 req/s | 19,580 req/s |
