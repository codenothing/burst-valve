/**
 * Promise callback storage format
 */
interface PromiseStore<Result> {
  resolve(value: Result): void;
  reject(error: Error): void;
}

/**
 * Method for running a single process
 * @param {SubqueueKeyType} [subqueue] Unique key of the subqueue being run
 * @returns {FetchResult} Result of the process
 */
export type FetcherProcess<
  FetchResult,
  SubqueueKeyType = string | number | symbol
> = (subqueue?: SubqueueKeyType) => Promise<FetchResult>;

/**
 * Method for running a batch fetch process
 * @param {SubqueueKeyType[]} subqueues Unique keys of the subqueues being run
 * @param {Function} earlyWrite Mechanism for unblocking subqueues as the data is available
 * @returns {FetchResult[] | Error[] | Map | void} Results in array/map format. Nothing should be returned when using the earlyWrite mechanism
 */
export type BatchFetcherProcess<
  FetchResult,
  SubqueueKeyType = string | number | symbol
> = (
  subqueues: SubqueueKeyType[],
  earlyWrite: (subqueue: SubqueueKeyType, result: FetchResult | Error) => void
) => Promise<
  Array<FetchResult | Error> | Map<SubqueueKeyType, FetchResult | Error> | void
>;

/**
 * Configurable parameters when creating a new instance of BurstValve
 */
export interface BurstValveParams<DrainResult, SubqueueKeyType> {
  /**
   * Display name for the valve (useful for debugging exceptions)
   */
  displayName?: string;

  /**
   * Fetcher process for single concurrency process running
   */
  fetch?: FetcherProcess<DrainResult, SubqueueKeyType>;

  /**
   * Fetcher process for single concurrency on a list
   * of unique identifiers
   */
  batch?: BatchFetcherProcess<DrainResult, SubqueueKeyType>;
}

/**
 * Only wraps non Error instances in an exception
 * @param {unknown} error Unknown error raised
 * @param {string} messagePrefix Prefix string when error is not an exception
 * @returns {Error} Error instance of the exception passed, wrapped if non exception
 */
const optionallyWrapError = (error: unknown, messagePrefix: string): Error =>
  error instanceof Error
    ? error
    : new Error(`${messagePrefix}: ${error}`, { cause: error });

/**
 * Concurrent queue for a single (or batch) asynchronous action
 */
export class BurstValve<
  DrainResult,
  SubqueueKeyType = string | number | symbol
> {
  /**
   * Display name for the valve
   * @type {string}
   * @readonly
   */
  public readonly displayName: string;

  /**
   * Fetcher for single concurrent running of a function
   * @type {FetcherProcess | undefined}
   * @readonly
   * @private
   */
  private readonly fetcher?: FetcherProcess<DrainResult, SubqueueKeyType>;

  /**
   * Fetcher for batch of unique identifiers to run once
   * @type {BatchFetcherProcess | undefined}
   * @readonly
   * @private
   */
  private readonly batchFetcher?: BatchFetcherProcess<
    DrainResult,
    SubqueueKeyType
  >;

  /**
   * Queue of promise callbacks
   * @type {PromiseStore[]}
   * @private
   */
  private queue?: PromiseStore<DrainResult>[];

  /**
   * Keyed subqueues of promise callbacks
   * @type {Map}
   * @private
   */
  private subqueues = new Map<SubqueueKeyType, PromiseStore<DrainResult>[]>();

  /**
   * Creates an instance of BurstValve with a custom fetcher
   * @param {FetcherProcess} fetcher Fetcher process for single concurrency process running
   */
  constructor(fetcher: FetcherProcess<DrainResult, SubqueueKeyType>);

  /**
   * Creates an instance of BurstValve with a custom display name and fetcher
   * @param {string} displayName Name for the valve
   * @param {FetcherProcess} fetcher Fetcher process for single concurrency process running
   */
  constructor(
    displayName: string,
    fetcher: FetcherProcess<DrainResult, SubqueueKeyType>
  );

  /**
   * Creates an instance of BurstValve with configurable parameters
   * @param {BurstValveParams} config Burst value configuration
   */
  constructor(config: BurstValveParams<DrainResult, SubqueueKeyType>);

  /**
   * Creates an instance of BurstValve with a custom display name and fetcher
   * @param {string | FetcherProcess | BurstValveParams} displayName Name for the valve, fetcher process, or burst configuration
   * @param {FetcherProcess} [fetcher] Fetcher process for single concurrency process running
   */
  constructor(
    displayName:
      | string
      | FetcherProcess<DrainResult, SubqueueKeyType>
      | BurstValveParams<DrainResult, SubqueueKeyType>,
    fetcher?: FetcherProcess<DrainResult, SubqueueKeyType>
  ) {
    // (displayName, fetcher)
    if (typeof displayName === "string") {
      this.displayName = displayName;
      this.fetcher = fetcher;
    }
    // (fetcher)
    else if (typeof displayName === "function") {
      this.displayName = "Burst Valve";
      this.fetcher = displayName;
    }
    // (params)
    else {
      this.displayName = displayName.displayName || "Burst Valve";
      this.fetcher = displayName.fetch;
      this.batchFetcher = displayName.batch;
    }

    // Ensure some fetching process is defined
    if (!this.fetcher && !this.batchFetcher) {
      throw new Error(`No fetcher process defined on ${this.displayName}`);
    }
    // Ensure there is only one fetcher process
    else if (this.fetcher && this.batchFetcher) {
      throw new Error(
        `Cannot define both a batch fetcher and a single fetcher at the same time for ${this.displayName}`
      );
    }
  }

  /**
   * Determines if queue (or subqueue) has an active action being taken
   * @param {SubqueueKeyType} [subqueue] Unique identifier of the subqueue to check activity.
   * @returns {Boolean} True/False indicating if queue (or subqueue) is active
   */
  public isActive(subqueue?: SubqueueKeyType): boolean {
    if (subqueue !== undefined) {
      return this.subqueues.has(subqueue);
    } else {
      return this.queue ? true : false;
    }
  }

  /**
   * Leverages the current valve to only have a single running process of a function
   * @param {SubqueueKeyType} [subqueue] Unique identifier of the subqueue to fetch data for
   * @returns {DrainResult} Result of the fetch
   */
  public async fetch(subqueue?: SubqueueKeyType): Promise<DrainResult> {
    if (this.batchFetcher) {
      if (subqueue === undefined) {
        throw new Error(
          `Cannot make un-identified fetch requests when batching is enabled for ${this.displayName}`
        );
      }

      return (await this.unsafeBatch([subqueue]))[0];
    }

    // Type safety for fetcher process
    const fetcher = this.fetcher;
    if (!fetcher) {
      throw new Error(`Fetch process not defined for ${this.displayName}`);
    }

    return new Promise<DrainResult>((resolve, reject) => {
      // Subqueue defined
      if (subqueue) {
        const list = this.subqueues.get(subqueue);
        if (list) {
          return list.push({ resolve, reject });
        } else {
          this.subqueues.set(subqueue, [{ resolve, reject }]);
        }
      }
      // Global queue
      else {
        if (this.queue) {
          return this.queue.push({ resolve, reject });
        } else {
          this.queue = [{ resolve, reject }];
        }
      }

      // Run the fetcher process and flush the results
      fetcher(subqueue)
        .then((value) => this.flushResult(subqueue, value))
        .catch((e) =>
          this.flushResult(
            subqueue,
            optionallyWrapError(e, `Fetcher error for ${this.displayName}`)
          )
        );
    });
  }

  /**
   * Batches fetching of unique identifiers into a single process, waiting
   * for existing queues if they already exist
   * @param {SubqueueKeyType[]} subqueues List of unique identifiers to fetch at once
   * @returns {Array<DrainResult | Error>} List of fetch results or exceptions
   */
  public async batch(
    subqueues: SubqueueKeyType[]
  ): Promise<Array<DrainResult | Error>> {
    return this.runBatch(subqueues);
  }

  /**
   * Same as batch, except throws any errors that are found during the fetching
   * process rather returning them. Simplifies the return array to only results
   * @param {SubqueueKeyType[]} subqueues List of unique identifiers to fetch at once
   * @returns {DrainResult[]} List of batch results
   */
  public async unsafeBatch(
    subqueues: SubqueueKeyType[]
  ): Promise<Array<DrainResult>> {
    return this.runBatch(subqueues, true);
  }

  /**
   * Exposes results for fetching each unique identifier as the data becomes available
   * @param {SubqueueKeyType[]} subqueues List of unique identifiers to fetch at once
   * @param {Function} streamResultCallback Iterative callback for each result as it is available
   */
  public async stream(
    subqueues: SubqueueKeyType[],
    streamResultCallback: (
      subqueue: SubqueueKeyType,
      result: DrainResult | Error
    ) => Promise<void>
  ): Promise<void> {
    const uniqueKeys = new Set<SubqueueKeyType>(subqueues);
    const fetchBatchKeys: SubqueueKeyType[] = [];
    const streamResponses: Promise<void>[] = [];

    // Look for active subqueue for each identifier before creating one
    for (const id of uniqueKeys) {
      let list = this.subqueues.get(id);

      if (!list) {
        this.subqueues.set(id, (list = []));
        fetchBatchKeys.push(id);
      }

      streamResponses.push(
        new Promise<void>((resolve, reject) => {
          (list as PromiseStore<DrainResult>[]).push({
            resolve: (value) => {
              streamResultCallback(id, value).then(resolve).catch(reject);
            },
            reject: (error) => {
              streamResultCallback(id, error).then(resolve).catch(reject);
            },
          });
        })
      );
    }

    // Only trigger batch fetcher if there are inactive keys to fetch
    const batchPromise =
      fetchBatchKeys.length > 0
        ? this.runBatchFetcher(fetchBatchKeys)
        : Promise.resolve();

    // Wait for all queues to resolve
    await Promise.all([batchPromise, ...streamResponses]);
  }

  /**
   * Normalized runner for batch and batchUnsafe
   * @param {SubqueueKeyType[]} subqueues List of unique identifiers to fetch at once
   * @returns {Array<DrainResult | Error>} List of batch results or exceptions
   */
  private async runBatch(
    subqueues: SubqueueKeyType[]
  ): Promise<Array<DrainResult | Error>>;

  /**
   * Normalized runner for batch and batchUnsafe
   * @param {SubqueueKeyType} subqueues List of unique identifiers to fetch at once
   * @param {Boolean} raiseExceptions Indicates if exceptions should be raised when found
   * @returns {DrainResult[]} List of batch results
   */
  private async runBatch(
    subqueues: SubqueueKeyType[],
    raiseExceptions: true
  ): Promise<Array<DrainResult>>;

  /**
   * Normalized runner for batch and batchUnsafe
   * @param {SubqueueKeyType[]} subqueues List of unique identifiers to fetch at once
   * @param {Boolean} [raiseExceptions] Indicates if exceptions should be raised when found
   * @returns {Array<DrainResult | Error>} List of batch results or exceptions
   */
  private async runBatch(
    subqueues: SubqueueKeyType[],
    raiseExceptions?: true
  ): Promise<Array<DrainResult | Error>> {
    const results = new Map<SubqueueKeyType, DrainResult | Error>();
    const fetchBatchKeys: SubqueueKeyType[] = [];
    const fetchPromises: Promise<void>[] = [];

    // Look for active subqueue for each identifier before creating one
    for (const id of subqueues) {
      const list = this.subqueues.get(id);

      // Dedupe fetch keys
      if (fetchBatchKeys.includes(id)) {
        continue;
      }
      // Wait for existing queue if it exists
      else if (list) {
        fetchPromises.push(
          new Promise<void>((queuedResolve, queuedReject) => {
            list.push({
              resolve: (value) => {
                if (!results.has(id)) {
                  results.set(id, value);
                }
                queuedResolve();
              },
              reject: (error) => {
                if (raiseExceptions) {
                  return queuedReject(error);
                } else if (!results.has(id)) {
                  results.set(id, error);
                }
                queuedResolve();
              },
            });
          })
        );
      }
      // Mark subqueue as active before adding fetch key
      else {
        this.subqueues.set(id, []);
        fetchBatchKeys.push(id);
      }
    }

    // Only trigger batch fetcher if there are inactive keys to fetch
    const batcherPromise =
      fetchBatchKeys.length > 0
        ? this.runBatchFetcher(fetchBatchKeys, results, raiseExceptions)
        : Promise.resolve();

    // Wait for all queues to resolve
    await Promise.all([...fetchPromises, batcherPromise]);

    // Return the results
    return subqueues.map((id) => results.get(id) as DrainResult | Error);
  }

  /**
   * Runs the user defined batch fetcher process
   * @param {SubqueueKeyType[]} subqueues List of unique identifiers to fetch at once
   * @param {Map} [results] Optional list of shared results
   * @param {Boolean} [raiseExceptions] Indicates if errors should be thrown rather than returned
   */
  private async runBatchFetcher(
    subqueues: SubqueueKeyType[],
    results?: Map<SubqueueKeyType, DrainResult | Error>,
    raiseExceptions?: true
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.batchFetcher) {
        return reject(
          new Error(`Batch Fetcher Process not defined for ${this.displayName}`)
        );
      }

      // Keep reference to completed queues
      const responses = new Set<SubqueueKeyType>();

      // Trigger the batch fetching process
      let finished = false;
      this.batchFetcher(subqueues, (key, value) => {
        // Ignore any writes once the actual fetch process has completed
        if (finished) {
          throw new Error(
            `Batch fetcher process has already completed for ${this.displayName}`
          );
        }
        // Do not override previous results as they have already been flushed
        else if (!responses.has(key)) {
          if (raiseExceptions && value instanceof Error) {
            throw value;
          }

          responses.add(key);
          results?.set(key, value);
          this.flushResult(key, value);
        }
      })
        .then((batchResult) => {
          finished = true;

          if (batchResult) {
            // Batch process returns array of results matching the index list it was sent
            if (Array.isArray(batchResult)) {
              // Enforce array results length must match number of keys passed
              if (batchResult.length !== subqueues.length) {
                return reject(
                  new Error(
                    `Batch fetcher result array length does not match key length for ${this.displayName}`
                  )
                );
              }

              // Assign results
              subqueues.forEach((id, index) => {
                if (!responses.has(id)) {
                  const value = batchResult[index];

                  responses.add(id);
                  results?.set(id, value);
                  this.flushResult(id, value);
                }
              });

              return resolve();
            }
            // Batch process returns map of results
            else if (batchResult instanceof Map) {
              batchResult.forEach((value, id) => {
                if (!responses.has(id)) {
                  responses.add(id);
                  results?.set(id, value);
                  this.flushResult(id, value);
                }
              });
            }
          }

          // Mark error for each unresolved subqueue key
          subqueues.forEach((id) => {
            if (!responses.has(id)) {
              const error = new Error(
                `Batch fetcher result not found for '${id}' subqueue in ${this.displayName}`
              );
              responses.add(id);
              results?.set(id, error);
              this.flushResult(id, error);
            }
          });

          resolve();
        })
        .catch((e) => {
          finished = true;

          const error = optionallyWrapError(
            e,
            `Batch fetcher error for ${this.displayName}`
          );

          subqueues.forEach((id) => {
            if (!responses.has(id)) {
              responses.add(id);
              results?.set(id, error);
              this.flushResult(id, error);
            }
          });

          if (raiseExceptions) {
            reject(error);
          } else {
            resolve();
          }
        });
    });
  }

  /**
   * Flushes the queue specified with the result passed
   * @param {SubqueueKeyType | undefined} subqueue Unique identifier tied to the fetch process
   * @param {DrainResult | Error} result Successful/Failed result of the fetch process
   */
  private flushResult(
    subqueue: SubqueueKeyType | undefined,
    result: DrainResult | Error
  ): void {
    // Find the relevant queue
    let list: PromiseStore<DrainResult>[] = [];
    if (subqueue !== undefined) {
      const sublist = this.subqueues.get(subqueue);
      if (sublist) {
        list = sublist;
        this.subqueues.delete(subqueue);
      }
    } else if (this.queue) {
      list = this.queue;
      this.queue = undefined;
    }

    // Send result/error
    if (result instanceof Error) {
      list.forEach(({ reject }) => reject(result));
    } else {
      list.forEach(({ resolve }) => resolve(result));
    }
  }
}
