import { createPool } from "mysql";
import { BurstValve } from "../src";

export interface Customer {
  id: string;
  name: string;
}

export const pool = createPool({
  connectionLimit: 10,
  host: process.env.MYSQL_BENCHMARK_HOST || "127.0.0.1",
  user: process.env.MYSQL_BENCHMARK_USER,
  password: process.env.MYSQL_BENCHMARK_PASSWORD,
  database: process.env.MYSQL_BENCHMARK_DATABASE,
});

export const getCustomers = async (ids: string[]) => {
  return new Promise<Customer[]>((resolve, reject) => {
    pool.query(
      `SELECT id, name FROM customers WHERE id IN (?)`,
      [ids],
      (e, results?: Customer[]) => {
        if (e || !results || !results.length) {
          reject(e || new Error(`Customers not found`));
        } else {
          resolve(results);
        }
      }
    );
  });
};

export const fetchValve = new BurstValve<Customer, string>({
  displayName: "Single Fetch",
  fetch: async (id) => {
    if (id) {
      return await getCustomers([id])[0];
    } else {
      throw new Error(`No subqueue id found`);
    }
  },
});

export const batchValve = new BurstValve<Customer, string>({
  displayName: "Batch Fetch",
  batch: async (ids, earlyWrite) => {
    const results = await getCustomers(ids);
    results.forEach((row) => {
      earlyWrite(row.id, row);
    });
  },
});
