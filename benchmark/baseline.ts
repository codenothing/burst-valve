import Benchmark from "benchmark";
import { BurstValve } from "../src";

const tick = () => new Promise((resolve) => process.nextTick(resolve));

const singleFetch = new BurstValve<number, number>({
  displayName: "Early Write",
  fetch: async (id) => {
    await tick();
    return (id as number) * 2;
  },
});

const arrayResult = new BurstValve<number, number>({
  displayName: "Early Write",
  batch: async (ids) => {
    await tick();
    return ids.map((id) => id * 2);
  },
});

const mapResult = new BurstValve<number, number>({
  displayName: "Early Write",
  batch: async (ids) => {
    await tick();
    return new Map(ids.map((id) => [id, id * 2]));
  },
});

const earlyWriteValve = new BurstValve<number, number>({
  displayName: "Early Write",
  batch: async (ids, earlyWrite) => {
    await tick();
    ids.forEach((id) => earlyWrite(id, id * 2));
  },
});

const suite = new Benchmark.Suite();

suite.add("Tick Baseline", {
  defer: true,
  fn: async (deferred: Benchmark.Deferred) => {
    await tick();
    deferred.resolve();
  },
});

suite
  .add(`singleFetch single call`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await singleFetch.fetch(1);
      deferred.resolve();
    },
  })
  .add(`arrayResult single call`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await arrayResult.batch([1, 2, 3, 4, 5]);
      deferred.resolve();
    },
  })
  .add(`mapResult single call`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await mapResult.batch([1, 2, 3, 4, 5]);
      deferred.resolve();
    },
  })
  .add(`earlyWriteValve single call`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await earlyWriteValve.batch([1, 2, 3, 4, 5]);
      deferred.resolve();
    },
  });

[5, 25, 100].forEach((concurrent) => {
  suite
    .add(`singleFetch / ${concurrent} concurrent`, {
      defer: true,
      fn: async (deferred: Benchmark.Deferred) => {
        const stack: Promise<number>[] = [];
        for (let i = 0; i < concurrent; i++) {
          stack.push(singleFetch.fetch(1));
        }
        await Promise.all(stack);
        deferred.resolve();
      },
    })
    .add(`arrayResult / ${concurrent} concurrent`, {
      defer: true,
      fn: async (deferred: Benchmark.Deferred) => {
        const stack: Promise<(number | Error)[]>[] = [];
        for (let i = 0; i < concurrent; i++) {
          stack.push(arrayResult.batch([1, 2, 3, 4, 5]));
        }
        await Promise.all(stack);
        deferred.resolve();
      },
    })
    .add(`mapResult / ${concurrent} concurrent`, {
      defer: true,
      fn: async (deferred: Benchmark.Deferred) => {
        const stack: Promise<(number | Error)[]>[] = [];
        for (let i = 0; i < concurrent; i++) {
          stack.push(mapResult.batch([1, 2, 3, 4, 5]));
        }
        await Promise.all(stack);
        deferred.resolve();
      },
    })
    .add(`earlyWriteValve / ${concurrent} concurrent`, {
      defer: true,
      fn: async (deferred: Benchmark.Deferred) => {
        const stack: Promise<(number | Error)[]>[] = [];
        for (let i = 0; i < concurrent; i++) {
          stack.push(earlyWriteValve.batch([1, 2, 3, 4, 5]));
        }
        await Promise.all(stack);
        deferred.resolve();
      },
    });
});

suite.on("cycle", (event: Benchmark.Event) => {
  if ((event.target.name as string).startsWith("singleFetch")) {
    console.log("----");
  }
  console.log(String(event.target));
});
suite.run({ async: true });
