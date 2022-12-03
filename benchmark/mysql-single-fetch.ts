import Benchmark from "benchmark";
import { Customer, fetchValve, getCustomers } from "./common";

const suite = new Benchmark.Suite();

suite
  .add("MySQL Direct / 5 Concurrent", {
    defer: true,
    fn: async (deferred) => {
      await Promise.all([
        getCustomers([`1`]),
        getCustomers([`1`]),
        getCustomers([`1`]),
        getCustomers([`1`]),
        getCustomers([`1`]),
      ]);
      deferred.resolve();
    },
  })
  .add("MySQL Direct / 25 Concurrent", {
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
    fn: async (deferred) => {
      const stack: Promise<Customer>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(fetchValve.fetch(`1`));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .on("cycle", (event) => {
    console.log(String(event.target));
  })
  .on("complete", () => process.exit());

// Setup before running the suite
(async () => {
  await Promise.all([
    getCustomers([`1`]),
    getCustomers([`1`]),
    getCustomers([`1`]),
    getCustomers([`1`]),
    getCustomers([`1`]),
    getCustomers([`1`]),
    getCustomers([`1`]),
    getCustomers([`1`]),
    getCustomers([`1`]),
    getCustomers([`1`]),
  ]);

  // Run the suite
  console.log("Query pool is primed, running the single fetch suite");
  suite.run({ async: true });
})();
