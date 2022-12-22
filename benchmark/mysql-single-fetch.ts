import Benchmark from "benchmark";
import { BurstValve } from "../src";
import { Customer, getCustomer } from "./common";

const fetchValve = new BurstValve<Customer, string>({
  displayName: "Single Fetch",
  fetch: async (id) => {
    if (id) {
      return await getCustomer(id);
    } else {
      throw new Error(`No subqueue id found`);
    }
  },
});

const suite = new Benchmark.Suite();

suite
  .add("MySQL Direct / 5 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await Promise.all([
        getCustomer(`1`),
        getCustomer(`1`),
        getCustomer(`1`),
        getCustomer(`1`),
        getCustomer(`1`),
      ]);
      deferred.resolve();
    },
  })
  .add("MySQL Direct / 25 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer>[] = [];
      for (let i = 0; i < 25; i++) {
        stack.push(getCustomer(`1`));
      }
      await Promise.all(stack);
      deferred.resolve();
    },
  })
  .add("MySQL Direct / 50 Concurrent", {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const stack: Promise<Customer>[] = [];
      for (let i = 0; i < 50; i++) {
        stack.push(getCustomer(`1`));
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
  await Promise.all([
    getCustomer(`1`),
    getCustomer(`1`),
    getCustomer(`1`),
    getCustomer(`1`),
    getCustomer(`1`),
    getCustomer(`1`),
    getCustomer(`1`),
    getCustomer(`1`),
    getCustomer(`1`),
    getCustomer(`1`),
  ]);

  // Run the suite
  console.log("Query pool is primed, running the single fetch suite");
  suite.run({ async: true });
})();
