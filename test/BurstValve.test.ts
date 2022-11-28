import { BurstValve, FetcherProcess } from "../src";

const wait = () => new Promise((resolve) => setTimeout(resolve, 10));

interface FetchResult {
  foo?: string;
  bar?: boolean;
}

jest.setTimeout(250);

describe("BurstValve", () => {
  const defaultFetcher: FetcherProcess<FetchResult> = async () => ({
    foo: "bar",
    bar: false,
  });

  describe("constructor", () => {
    test("should use the display name passed in", () => {
      const valve = new BurstValve<FetchResult>(
        `Custom Display Name`,
        defaultFetcher
      );
      expect(valve.displayName).toEqual(`Custom Display Name`);
    });

    test("should use the display name passed in the config object", () => {
      const valve = new BurstValve<FetchResult>({
        displayName: `Custom Display Name`,
        fetcher: defaultFetcher,
      });
      expect(valve.displayName).toEqual(`Custom Display Name`);
    });

    test("should throw an error if fetcher process is not defined", async () => {
      expect(() => new BurstValve<FetchResult>({})).toThrow(
        `No fetcher process defined on Burst Valve`
      );
    });

    test("should throw an error if both a batch and single fetcher process is defined", async () => {
      expect(
        () =>
          new BurstValve<number, number>({
            fetcher: async () => 5,
            batch: async () => undefined,
          })
      ).toThrow(
        `Cannot define both a batch fetcher and a single fetcher at the same time`
      );
    });
  });

  describe("isActive", () => {
    test("should mark the global queue activity based on active fetches", async () => {
      const resultValue: FetchResult = { foo: "foobar" };
      const valve = new BurstValve<FetchResult>(async () => {
        await wait();
        return resultValue;
      });

      expect(valve.isActive()).toStrictEqual(false);
      const fetchPromise = valve.fetch();
      expect(valve.isActive()).toStrictEqual(true);
      await fetchPromise;
      expect(valve.isActive()).toStrictEqual(false);
    });

    test("should mark individual subqueue's activity based on active fetches", async () => {
      const resultValue: FetchResult = { foo: "foobar" };
      const valve = new BurstValve<FetchResult>(async () => {
        await wait();
        return resultValue;
      });

      expect(valve.isActive("foo")).toStrictEqual(false);
      expect(valve.isActive("bar")).toStrictEqual(false);
      const fooFetchPromise = valve.fetch("foo");
      expect(valve.isActive("foo")).toStrictEqual(true);
      expect(valve.isActive("bar")).toStrictEqual(false);
      const barFetchPromise = valve.fetch("bar");
      expect(valve.isActive("foo")).toStrictEqual(true);
      expect(valve.isActive("bar")).toStrictEqual(true);
      await fooFetchPromise;
      expect(valve.isActive("foo")).toStrictEqual(false);
      expect(valve.isActive("bar")).toStrictEqual(true);
      await barFetchPromise;
      expect(valve.isActive("foo")).toStrictEqual(false);
      expect(valve.isActive("bar")).toStrictEqual(false);
    });
  });

  describe("fetch", () => {
    describe("global queue", () => {
      test("should only run the fetcher once during it's execution", async () => {
        let ran = 0;
        const resultValue: FetchResult = { foo: "foobar" };
        const valve = new BurstValve<FetchResult>(async () => {
          ran++;
          await wait();
          return resultValue;
        });

        const [run1, run2] = await Promise.all([valve.fetch(), valve.fetch()]);
        expect(run1).toEqual(resultValue);
        expect(run2).toEqual(resultValue);
        expect(ran).toStrictEqual(1);
      });

      test("should proxy all errors to each fetcher in the queue", async () => {
        let ran = 0;
        const error = new Error(`Drain Error`);
        const valve = new BurstValve<FetchResult>(async () => {
          ran++;
          await wait();
          throw error;
        });

        const [run1, run2] = await Promise.all([
          valve.fetch().catch((reason) => reason),
          valve.fetch().catch((reason) => reason),
        ]);
        expect(run1).toEqual(error);
        expect(run2).toEqual(error);
        expect(ran).toStrictEqual(1);
      });
    });

    describe("subqueue", () => {
      test("should only run the fetcher once per subqueue during it's execution", async () => {
        const runners: Record<string, number> = {};
        const valve = new BurstValve<FetchResult, string>(async (subqueue) => {
          if (!subqueue) {
            throw new Error(`Subqueue not defined`);
          } else if (runners[subqueue]) {
            runners[subqueue]++;
          } else {
            runners[subqueue] = 1;
          }

          await wait();

          return {
            foo: subqueue,
          };
        });

        const [run1, run2, run3, run4] = await Promise.all([
          valve.fetch(`subqueue1`),
          valve.fetch(`subqueue1`),
          valve.fetch(`subqueue2`),
          valve.fetch(`subqueue2`),
        ]);
        expect(run1).toEqual({ foo: "subqueue1" });
        expect(run2).toEqual({ foo: "subqueue1" });
        expect(run3).toEqual({ foo: "subqueue2" });
        expect(run4).toEqual({ foo: "subqueue2" });
        expect(runners).toEqual({
          subqueue1: 1,
          subqueue2: 1,
        });
      });

      test("should proxy all errors to each fetcher in the queue", async () => {
        const runners: Record<string, number> = {};
        const valve = new BurstValve<FetchResult, string>(
          "Base Fetcher",
          async (subqueue?: string) => {
            if (!subqueue) {
              throw new Error(`Subqueue not defined`);
            } else if (runners[subqueue]) {
              runners[subqueue]++;
            } else {
              runners[subqueue] = 1;
            }

            await wait();
            throw new Error(`Drain ${subqueue} Error`);
          }
        );

        const [run1, run2, run3, run4] = await Promise.all([
          valve.fetch(`subqueue1`).catch((reason) => reason),
          valve.fetch(`subqueue1`).catch((reason) => reason),
          valve.fetch(`subqueue2`).catch((reason) => reason),
          valve.fetch(`subqueue2`).catch((reason) => reason),
        ]);
        expect((run1 as Error).message).toEqual(`Drain subqueue1 Error`);
        expect((run2 as Error).message).toEqual(`Drain subqueue1 Error`);
        expect((run3 as Error).message).toEqual(`Drain subqueue2 Error`);
        expect((run4 as Error).message).toEqual(`Drain subqueue2 Error`);
        expect(runners).toEqual({
          subqueue1: 1,
          subqueue2: 1,
        });
      });
    });

    describe("error", () => {
      test("should proxy error objects directly to callers", async () => {
        const error = new Error("Some Service Error");
        const valve = new BurstValve<string>(async () => {
          throw error;
        });

        await expect(valve.fetch()).rejects.toThrow(error);
      });

      test("should wrap strings thrown from the fetcher process into an error object", async () => {
        const valve = new BurstValve<string>(async () => {
          throw `Some String Error`;
        });

        await expect(valve.fetch()).rejects.toThrow(`Some String Error`);
      });

      test("should wrap unknown thrown objects from the fetcher process into an error object", async () => {
        const valve = new BurstValve<string>(async () => {
          throw { foo: "bar" };
        });

        await expect(valve.fetch()).rejects.toThrow(
          `Fetcher Error: [object Object]`
        );
      });
    });
  });

  describe("batch", () => {
    test("should only run the batch fetcher once for all the keys", async () => {
      let ran = 0;
      const resultValue: FetchResult = { foo: "foobar" };
      const valve = new BurstValve<FetchResult>({
        batch: async (ids) => {
          expect(ids).toEqual(["a", "b", "c"]);
          ran++;
          return ids.map(() => resultValue);
        },
      });

      expect(await valve.batch(["a", "b", "c"])).toEqual([
        { foo: "foobar" },
        { foo: "foobar" },
        { foo: "foobar" },
      ]);
      expect(ran).toStrictEqual(1);
    });

    test("should allow returning of results in a Map for subqueue->result assignment", async () => {
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids) => {
          runs.push([...ids]);
          await wait();
          return new Map(ids.map((id) => [id, id * 2]));
        },
      });

      expect(await valve.batch([1, 2, 3])).toEqual([2, 4, 6]);
      expect(runs).toEqual([[1, 2, 3]]);
    });

    test("should allow early writing of results, of which can not be overwritten", async () => {
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids, earlyWrite) => {
          runs.push([...ids]);
          await wait();
          earlyWrite(1, 10);
          await wait();
          earlyWrite(2, 20);
          await wait();
          return [2, 4, 6];
        },
      });

      expect(await valve.batch([1, 2, 3])).toEqual([10, 20, 6]);
      expect(runs).toEqual([[1, 2, 3]]);
    });

    test("should not duplicate fetching when multiple batch keys overlap", async () => {
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids) => {
          runs.push([...ids]);
          await wait();
          return new Map(ids.map((id) => [id, id * 2]));
        },
      });

      const [run1, run2, run3] = await Promise.all([
        valve.batch([1, 2, 3]),
        valve.batch([3, 5, 8]),
        valve.batch([1, 5, 10]),
      ]);
      expect(run1).toEqual([2, 4, 6]);
      expect(run2).toEqual([6, 10, 16]);
      expect(run3).toEqual([2, 10, 20]);
      expect(runs).toEqual([[1, 2, 3], [5, 8], [10]]);
    });

    test("should not intermix and proxy fetch calls to the batch", async () => {
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids, earlyWrite) => {
          runs.push([...ids]);
          await wait();
          ids.forEach((id) => earlyWrite(id, id * 2));
        },
      });

      const [run1, run2, run3, run4] = await Promise.all([
        valve.batch([1, 2, 3]),
        valve.fetch(2),
        valve.fetch(8),
        valve.batch([6, 2, 8]),
      ]);
      expect(run1).toEqual([2, 4, 6]);
      expect(run2).toEqual(4);
      expect(run3).toEqual(16);
      expect(run4).toEqual([12, 4, 16]);
      expect(runs).toEqual([[1, 2, 3], [8], [6]]);
    });

    test("should ignore duplicate keys", async () => {
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids, earlyWrite) => {
          runs.push([...ids]);
          await wait();
          ids.forEach((id) => earlyWrite(id, id * 2));
        },
      });

      expect(await valve.batch([5, 2, 5, 8, 2])).toEqual([10, 4, 10, 16, 4]);
      expect(runs).toEqual([[5, 2, 8]]);
    });

    test("should stream results as soon as they are ready", async () => {
      const runs: number[][] = [];
      const results: string[] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids, earlyWrite) => {
          runs.push([...ids]);
          await wait();
          earlyWrite(3, 6);
          await wait();
          earlyWrite(5, 10);
          await wait();
          earlyWrite(1, 2);
          await wait();
        },
      });

      await Promise.all([
        valve.batch([5, 3, 1]).then(() => results.push("batch")),
        valve.fetch(5).then(() => results.push("fetch:5")),
        valve.fetch(3).then(() => results.push("fetch:3")),
        valve.fetch(1).then(() => results.push("fetch:1")),
      ]);

      expect(runs).toEqual([[5, 3, 1]]);
      expect(results).toEqual([`fetch:3`, `fetch:5`, `fetch:1`, `batch`]);
    });

    test("should send thrown error into each result", async () => {
      const mockError = new Error("Mock Error");
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids) => {
          runs.push([...ids]);
          await wait();
          throw mockError;
        },
      });

      const [run1, run2] = await Promise.all([
        valve.batch([1, 2, 3]),
        valve.batch([6, 2, 8]),
      ]);
      expect(run1).toEqual([mockError, mockError, mockError]);
      expect(run2).toEqual([mockError, mockError, mockError]);
      expect(runs).toEqual([
        [1, 2, 3],
        [6, 8],
      ]);
    });

    test("should reject fetch when error is found during a batch triggered process", async () => {
      const mockError = new Error(`Mock Error`);
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids, earlyWrite) => {
          runs.push([...ids]);
          await wait();
          ids.forEach((id) => earlyWrite(id, id === 2 ? mockError : id * 2));
        },
      });

      const [run1, run2, run3] = await Promise.all([
        valve.batch([1, 2, 3]),
        valve.fetch(2).catch((reason) => reason),
        valve.batch([6, 2, 8]),
      ]);
      expect(run1).toEqual([2, mockError, 6]);
      expect(run2).toEqual(mockError);
      expect(run3).toEqual([12, mockError, 16]);
      expect(runs).toEqual([
        [1, 2, 3],
        [6, 8],
      ]);
    });

    test("should send thrown error as rejection in fetch calls", async () => {
      const mockError = new Error("Mock Error");
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids) => {
          runs.push([...ids]);
          await wait();
          throw mockError;
        },
      });

      await expect(valve.fetch(5)).rejects.toThrow(mockError);
      expect(runs).toEqual([[5]]);
    });

    test("should throw error when returned array length does not match key length", async () => {
      const valve = new BurstValve<number, number>({
        batch: async () => {
          await wait();
          return [2, 4];
        },
      });

      await expect(valve.batch([1, 2, 3])).rejects.toThrow(
        `Batch fetch result array length does not match key length for Burst Valve`
      );
    });

    test("should throw error for global fetch when fetcher is not defined", async () => {
      const runs: number[][] = [];
      const valve = new BurstValve<number, number>({
        batch: async (ids, earlyWrite) => {
          runs.push([...ids]);
          await wait();
          ids.forEach((id) => earlyWrite(id, id * 2));
        },
      });

      await expect(valve.fetch()).rejects.toThrow(
        `Cannot make un-identified fetch requests when batching is enabled`
      );
      expect(runs).toEqual([]);
    });

    test("should throw error for batch when only fetcher is defined", async () => {
      let runs = 0;
      const valve = new BurstValve<number, number>({
        fetcher: async () => {
          runs++;
          await wait();
          return 25;
        },
      });

      await expect(valve.batch([1, 2, 3])).rejects.toThrow(
        `Batch Fetcher Process not defined`
      );
      expect(runs).toStrictEqual(0);
    });

    test("should throw error when attempting to early write a fetch process that has already completed", async () => {
      return new Promise<void>((resolve, reject) => {
        const valve = new BurstValve<number, number>({
          batch: async (ids, earlyWrite) => {
            return new Promise<void>((fetchResolve) => {
              earlyWrite(1, 2);
              fetchResolve();
              wait().then(() => {
                try {
                  expect(() => earlyWrite(2, 4)).toThrow(
                    `Batch fetch process has already completed for Burst Valve`
                  );
                } catch (e) {
                  reject(e);
                }
              });
            });
          },
        });

        valve
          .batch([1, 2])
          .catch(reject)
          .then((results) => {
            wait()
              .then(() => wait())
              .then(() => {
                try {
                  expect(results).toEqual([2, expect.any(Error)]);
                  expect((results as Error[])[1].message).toEqual(
                    `Batch fetch result not found for '2' subqueue in Burst Valve`
                  );
                  resolve();
                } catch (e) {
                  reject(e);
                }
              });
          });
      });
    });
  });
});
