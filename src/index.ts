/**
 * Promise callback storage format
 */
interface PromiseStore<Result> {
  resolve(value: Result): void;
  reject(error: Error): void;
}

/**
 * Method for running a single process
 * @type FetchResult Result type for the valve
 * @param subqueue Unique key of the subqueue being run
 */
export type FetcherProcess<
  FetchResult,
  SubqueueKeyType = string | number | symbol
> = (subqueue?: SubqueueKeyType) => Promise<FetchResult>;

/**
 * Concurrent queue for a single asynchronous action
 * @type DrainResult Result type when queue is drained
 * @type SubqueueKeyType Error type when queue is drained with an error
 */
export class BurstValve<
  DrainResult,
  SubqueueKeyType = string | number | symbol
> {
  /**
   * Display name for the queue
   */
  public readonly displayName: string;

  /**
   * Fetcher for single concurrent running of a function
   */
  private readonly fetcher: FetcherProcess<DrainResult, SubqueueKeyType>;

  /**
   * Queue of promise callbacks
   */
  private queue?: PromiseStore<DrainResult>[];

  /**
   * Keyed subqueues of promise callbacks
   */
  private subqueues: Record<
    string | number | symbol,
    PromiseStore<DrainResult>[] | undefined
  > = {};

  /**
   * Creates an instance of BurstValve with a custom fetcher
   * @param fetcher Fetcher process for single concurrency process running
   */
  constructor(fetcher: FetcherProcess<DrainResult, SubqueueKeyType>);

  /**
   * Creates an instance of BurstValve with a custom display name and fetcher
   * @param displayName Name for the valve
   * @param fetcher Fetcher process for single concurrency process running
   */
  constructor(
    displayName: string,
    fetcher: FetcherProcess<DrainResult, SubqueueKeyType>
  );

  /**
   * Creates an instance of BurstValve with a custom display name and fetcher
   * @param displayName Name for the valve
   * @param fetcher Fetcher process for single concurrency process running
   */
  constructor(
    displayName: string | FetcherProcess<DrainResult, SubqueueKeyType>,
    fetcher?: FetcherProcess<DrainResult, SubqueueKeyType>
  ) {
    if (typeof displayName === "function") {
      fetcher = displayName;
      displayName = "Burst Valve";
    }

    this.displayName = displayName;
    if (typeof fetcher === "function") {
      this.fetcher = fetcher;
    } else {
      throw new Error(`Fetcher process not found`);
    }
  }

  /**
   * Determines if queue (or subqueue) has an active action being taken
   * @param subqueue Name of queue to check activity. For non-global queues
   */
  public isActive(subqueue?: SubqueueKeyType): boolean {
    if (subqueue) {
      return this.subqueues[subqueue as string] ? true : false;
    } else {
      return this.queue ? true : false;
    }
  }

  /**
   * Leverages the current valve to only have a single running process of a function
   * @param subqueue Name of the subqueue
   */
  public async fetch(subqueue?: SubqueueKeyType): Promise<DrainResult> {
    return new Promise<DrainResult>((resolve, reject) => {
      if (subqueue) {
        const list = this.subqueues[subqueue as string];
        if (list) {
          return list.push({ resolve, reject });
        } else {
          this.subqueues[subqueue as string] = [{ resolve, reject }];
        }
      } else {
        if (this.queue) {
          return this.queue.push({ resolve, reject });
        } else {
          this.queue = [{ resolve, reject }];
        }
      }

      this.fetcher(subqueue)
        .then((value) => {
          this.getQueue(subqueue).forEach(({ resolve }) => resolve(value));
        })
        .catch((e) => {
          const error =
            e instanceof Error
              ? e
              : typeof e === "string"
              ? new Error(e)
              : new Error(`Unknown Fetcher Error: ${e}`);

          this.getQueue(subqueue).forEach(({ reject }) => reject(error));
        });
    });
  }

  /**
   * Returns the active queue (or subqueue) after clearing it
   * @param subqueue Subqueue identifier
   */
  private getQueue(subqueue?: SubqueueKeyType): PromiseStore<DrainResult>[] {
    let list: PromiseStore<DrainResult>[] = [];

    if (subqueue) {
      list = this.subqueues[subqueue as string] || [];

      if (list) {
        delete this.subqueues[subqueue as string];
      }
    } else if (this.queue) {
      list = this.queue;
      this.queue = undefined;
    }

    return list;
  }
}
