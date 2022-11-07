/* eslint-disable @typescript-eslint/no-explicit-any */
import { BurstValve, FetcherProcess } from "../src";

const wait = (time: number) =>
  new Promise((resolve) => setTimeout(resolve, time));

interface FetchResult {
  foo?: string;
  bar?: boolean;
}

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

    test("should throw an error if fetcher process is not defined", async () => {
      expect(() => new BurstValve<FetchResult>(undefined as any)).toThrow(
        `Fetcher process not found`
      );
    });
  });

  describe("isActive", () => {
    test("should mark the global queue activity based on active fetches", async () => {
      const resultValue: FetchResult = { foo: "foobar" };
      const valve = new BurstValve<FetchResult>(async () => {
        await wait(50);
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
        await wait(50);
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
      test("should only run the fetcher once during it's execution", () => {
        return new Promise((resolve, reject) => {
          let ran = 0;
          const resultValue: FetchResult = { foo: "foobar" };
          const valve = new BurstValve<FetchResult>(async () => {
            ran++;
            await wait(50);
            return resultValue;
          });

          valve
            .fetch()
            .then((result) => {
              try {
                expect(result).toEqual(resultValue);
                expect(ran).toEqual(1);
                resolve(null);
              } catch (e) {
                reject(e);
              }
            })
            .catch((e) => reject(e));

          valve
            .fetch()
            .then((result) => {
              try {
                expect(result).toEqual(resultValue);
                expect(ran).toEqual(1);
              } catch (e) {
                reject(e);
              }
            })
            .catch((e) => reject(e));
        });
      });

      test("should proxy all errors to each fetcher in the queue", () => {
        return new Promise((resolve, reject) => {
          let ran = 0;
          const error = new Error(`Drain Error`);
          const valve = new BurstValve<FetchResult>(async () => {
            ran++;
            await wait(50);
            throw error;
          });

          valve
            .fetch()
            .then(() => {
              reject(new Error(`Fetcher process should not have run`));
            })
            .catch((e) => {
              try {
                expect(e).toEqual(error);
                expect(ran).toEqual(1);
                resolve(null);
              } catch (subError) {
                reject(subError);
              }
            });

          valve
            .fetch()
            .then(() => {
              reject(new Error(`Fetcher process should not have run`));
            })
            .catch((e) => {
              try {
                expect(e).toEqual(error);
                expect(ran).toEqual(1);
              } catch (subError) {
                reject(subError);
              }
            });
        });
      });
    });

    describe("subqueue", () => {
      test("should only run the fetcher once per subqueue during it's execution", () => {
        return new Promise((resolve, reject) => {
          const runners: Record<string, number> = {};
          const fetcher = async (subqueue?: string) => {
            if (!subqueue) {
              throw new Error(`Subqueue not defined`);
            } else if (runners[subqueue]) {
              runners[subqueue]++;
            } else {
              runners[subqueue] = 1;
            }

            await wait(50);

            return {
              foo: subqueue,
            };
          };
          const valve = new BurstValve<FetchResult>(fetcher as any);

          valve
            .fetch("subqueue1")
            .then((result) => {
              try {
                expect(result).toEqual({ foo: "subqueue1" });
                expect(runners).toEqual({
                  subqueue1: 1,
                  subqueue2: 1,
                });
              } catch (e) {
                reject(e);
              }
            })
            .catch((e) => reject(e));

          valve
            .fetch("subqueue1")
            .then((result) => {
              try {
                expect(result).toEqual({ foo: "subqueue1" });
                expect(runners).toEqual({
                  subqueue1: 1,
                  subqueue2: 1,
                });
              } catch (e) {
                reject(e);
              }
            })
            .catch((e) => reject(e));

          valve
            .fetch("subqueue2")
            .then((result) => {
              try {
                expect(result).toEqual({ foo: "subqueue2" });
                expect(runners).toEqual({
                  subqueue1: 1,
                  subqueue2: 1,
                });
              } catch (e) {
                reject(e);
              }
            })
            .catch((e) => reject(e));

          valve
            .fetch("subqueue2")
            .then((result) => {
              try {
                expect(result).toEqual({ foo: "subqueue2" });
                expect(runners).toEqual({
                  subqueue1: 1,
                  subqueue2: 1,
                });
                resolve(null);
              } catch (e) {
                reject(e);
              }
            })
            .catch((e) => reject(e));
        });
      });

      test("should proxy all errors to each fetcher in the queue", () => {
        return new Promise((resolve, reject) => {
          const runners: Record<string, number> = {};
          const fetcher = async (subqueue?: string) => {
            if (!subqueue) {
              throw new Error(`Subqueue not defined`);
            } else if (runners[subqueue]) {
              runners[subqueue]++;
            } else {
              runners[subqueue] = 1;
            }

            await wait(50);
            throw new Error(`Drain ${subqueue} Error`);
          };
          const valve = new BurstValve<FetchResult>(
            "Base Fetcher",
            fetcher as any
          );

          valve
            .fetch("subqueue1")
            .then(() => {
              reject(new Error(`Fetcher process should not have run`));
            })
            .catch((e) => {
              try {
                expect(e).toEqual(new Error(`Drain subqueue1 Error`));
                expect(runners).toEqual({
                  subqueue1: 1,
                  subqueue2: 1,
                });
              } catch (subError) {
                reject(subError);
              }
            });

          valve
            .fetch("subqueue1")
            .then(() => {
              reject(new Error(`Fetcher process should not have run`));
            })
            .catch((e) => {
              try {
                expect(e).toEqual(new Error(`Drain subqueue1 Error`));
                expect(runners).toEqual({
                  subqueue1: 1,
                  subqueue2: 1,
                });
              } catch (subError) {
                reject(subError);
              }
            });

          valve
            .fetch("subqueue2")
            .then(() => {
              reject(new Error(`Fetcher process should not have run`));
            })
            .catch((e) => {
              try {
                expect(e).toEqual(new Error(`Drain subqueue2 Error`));
                expect(runners).toEqual({
                  subqueue1: 1,
                  subqueue2: 1,
                });
              } catch (subError) {
                reject(subError);
              }
            });

          valve
            .fetch("subqueue2")
            .then(() => {
              reject(new Error(`Fetcher process should not have run`));
            })
            .catch((e) => {
              try {
                expect(e).toEqual(new Error(`Drain subqueue2 Error`));
                expect(runners).toEqual({
                  subqueue1: 1,
                  subqueue2: 1,
                });
                resolve(null);
              } catch (subError) {
                reject(subError);
              }
            });
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
          `Unknown Fetcher Error: [object Object]`
        );
      });
    });
  });
});
