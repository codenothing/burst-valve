import Benchmark from "benchmark";
import Memcached from "memcached";
import { promisify } from "util";
import { BurstValve } from "../src";

interface Customer {
  id: string;
  name: string;
}

const cache = new Memcached("127.0.0.1:11211");

const getCustomers = async (ids: string[]): Promise<Customer[]> => {
  return new Promise<Customer[]>((resolve) => {
    cache.getMulti(ids, (_e, data) => {
      const results: Record<string, Customer> = {};
      if (data) {
        for (const id in data) {
          results[id] = JSON.parse(data[id]);
        }
      }

      resolve(ids.map((id) => results[id]));
    });
  });
};

const batchValve = new BurstValve<Customer, string>({
  displayName: "Memcached Batch Fetch",
  batch: async (ids, earlyWrite) => {
    return new Promise<void>((resolve) => {
      cache.getMulti(ids, (_e, data) => {
        if (data) {
          for (const id in data) {
            earlyWrite(id, JSON.parse(data[id]));
          }
        }

        resolve();
      });
    });
  },
});

const suite = new Benchmark.Suite();

suite
  .add("Memcached Direct / 5 concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await Promise.all([
        getCustomers([`1`, `2`, `3`]),
        getCustomers([`1`, `2`, `3`]),
        getCustomers([`1`, `2`, `3`]),
        getCustomers([`1`, `2`, `3`]),
        getCustomers([`1`, `2`, `3`]),
      ]);
      deferred.resolve();
    },
  })
  .add("Memcached Direct / 25 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer[]>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(getCustomers([`1`]));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("Memcached Direct / 50 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer[]>[] = [];
      for (let i = 0; i < 50; i++) {
        stack.push(getCustomers([`1`]));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("Burst Valve / 5 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await Promise.all([
        batchValve.batch([`1`, `2`, `3`]),
        batchValve.batch([`1`, `2`, `3`]),
        batchValve.batch([`1`, `2`, `3`]),
        batchValve.batch([`1`, `2`, `3`]),
        batchValve.batch([`1`, `2`, `3`]),
      ]);
      deferred.resolve();
    },
  })
  .add("Burst Valve / 25 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<(Customer | Error)[]>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(batchValve.batch([`1`, `2`, `3`]));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("Burst Valve / 50 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<(Customer | Error)[]>[] = [];
      for (let i = 0; i < 50; i++) {
        stack.push(batchValve.batch([`1`, `2`, `3`]));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .on("cycle", (event: Benchmark.Event) => {
    console.log(String(event.target));
  })
  .on("complete", () => cache.end());

// Setup before running the suite
(async () => {
  await promisify(cache.set.bind(cache))(
    `1`,
    JSON.stringify({ id: "1", name: `foo` }),
    3600
  );
  await promisify(cache.set.bind(cache))(
    `2`,
    JSON.stringify({ id: "2", name: `bar` }),
    3600
  );
  await promisify(cache.set.bind(cache))(
    `3`,
    JSON.stringify({ id: "3", name: `baz` }),
    3600
  );
  await Promise.all([
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
  ]);

  // Run the suite
  console.log("Cache pool is primed, running the Memcached suite");
  suite.run({ async: true });
})();
