import { createPool } from "mysql";
import Memcached from "memcached";

export interface Customer {
  id: string;
  name: string;
}

export const cache = new Memcached("127.0.0.1:11211");

export const pool = createPool({
  connectionLimit: 10,
  host: process.env.MYSQL_BENCHMARK_HOST || "127.0.0.1",
  user: process.env.MYSQL_BENCHMARK_USER,
  password: process.env.MYSQL_BENCHMARK_PASSWORD,
  database: process.env.MYSQL_BENCHMARK_DATABASE,
});

export const getCustomer = async (id: string) => {
  return new Promise<Customer>((resolve, reject) => {
    pool.query(
      `SELECT id, name FROM customers WHERE id = ?`,
      [id],
      (e, results?: Customer[]) => {
        if (e || !results || !results[0]) {
          reject(e || new Error(`Customer ${id} not found`));
        } else {
          resolve(results[0]);
        }
      }
    );
  });
};

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
