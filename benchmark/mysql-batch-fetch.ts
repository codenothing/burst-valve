import Benchmark from "benchmark";
import { BurstValve } from "../src";
import { Customer, getCustomers } from "./common";

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
  .add("MySQL Direct / 5 Concurrent", {
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
  .add("MySQL Direct / 25 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer[]>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(getCustomers([`1`, `2`, `3`]));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("MySQL Direct / 50 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer[]>[] = [];
      for (let i = 0; i < 50; i++) {
        stack.push(getCustomers([`1`, `2`, `3`]));
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
  .on("complete", () => process.exit());

// Setup before running the suite
(async () => {
  await Promise.all([
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
    getCustomers([`1`, `2`, `3`]),
  ]);

  // Run the suite
  console.log("Query pool is primed, running batch fetch suite");
  suite.run({ async: true });
})();
