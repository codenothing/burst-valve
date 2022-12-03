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
  return new Promise<Customer[]>((resolve, reject) => {
    cache.getMulti(ids, (e, data) => {
      if (e || !data) {
        reject(e || new Error(`Data not found`));
      } else {
        resolve(ids.map((id) => JSON.parse(data[id] || "{}")));
      }
    });
  });
};

const batchValve = new BurstValve<Customer, string>({
  displayName: "Batch Fetch",
  batch: async (ids, earlyWrite) => {
    const results = await getCustomers(ids);
    results.forEach((row) => {
      earlyWrite(row.id, row);
    });
  },
});

const suite = new Benchmark.Suite();

suite
  .add("Memcached Direct / 5 concurrent", {
    defer: true,
    fn: async (deferred) => {
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
    fn: async (deferred) => {
      const stack: Promise<Customer[]>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(getCustomers([`1`]));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("Burst Valve / 5 Concurrent", {
    defer: true,
    fn: async (deferred) => {
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
    fn: async (deferred) => {
      const stack: Promise<(Customer | Error)[]>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(batchValve.batch([`1`, `2`, `3`]));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .on("cycle", (event) => {
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
