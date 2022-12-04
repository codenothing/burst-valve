import Benchmark from "benchmark";
import { BurstValve } from "../src";
import { cache, Customer, getCustomer } from "./common";

const getCachedCustomer = async (id: string, skipCache?: boolean) => {
  return new Promise<Customer>((resolve, reject) => {
    const cacheKey = `customer:${id}`;

    cache.get(cacheKey, (_e, data) => {
      if (data && !skipCache) {
        return resolve(JSON.parse(data));
      }

      getCustomer(id)
        .then((value) => {
          cache.set(cacheKey, JSON.stringify(value), 3600, () => {
            resolve(value);
          });
        })
        .catch((e) => reject(e));
    });
  });
};

const fetchValve = new BurstValve<Customer, string>({
  displayName: "Single Fetch",
  fetch: async (id) => {
    if (id) {
      return await getCachedCustomer(id);
    } else {
      throw new Error(`No subqueue id found`);
    }
  },
});

const suite = new Benchmark.Suite();

suite
  .add("Memcached Direct / 5 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await Promise.all([
        getCachedCustomer(`1`),
        getCachedCustomer(`1`),
        getCachedCustomer(`1`),
        getCachedCustomer(`1`),
        getCachedCustomer(`1`),
      ]);
      deferred.resolve();
    },
  })
  .add("Memcached Direct / 25 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(getCachedCustomer(`1`));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("Memcached Direct / 50 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer>[] = [];
      for (let i = 0; i < 50; i++) {
        stack.push(getCachedCustomer(`1`));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("Burst Valve / 5 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await Promise.all([
        fetchValve.fetch(`1`),
        fetchValve.fetch(`1`),
        fetchValve.fetch(`1`),
        fetchValve.fetch(`1`),
        fetchValve.fetch(`1`),
      ]);
      deferred.resolve();
    },
  })
  .add("Burst Valve / 25 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(fetchValve.fetch(`1`));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("Burst Valve / 50 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer>[] = [];
      for (let i = 0; i < 50; i++) {
        stack.push(fetchValve.fetch(`1`));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .on("cycle", (event: Benchmark.Event) => {
    console.log(String(event.target));
  })
  .on("complete", () => process.exit());

// Setup before running the suite
(async () => {
  await getCachedCustomer(`1`, true);

  await Promise.all([
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
    getCachedCustomer(`1`),
  ]);

  // Run the suite
  console.log("Query pool is primed, running the single fetch suite");
  suite.run({ async: true });
})();
