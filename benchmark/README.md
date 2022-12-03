## Running benchmark suite

To run the suite, a few packages will need to be installed first:

1. [Memcached](https://formulae.brew.sh/formula/memcached)
2. [MySQL](https://formulae.brew.sh/formula/mysql)
3. Add the following env variables to the path:

```
export MYSQL_BENCHMARK_USER="[USER_HERE]";
export MYSQL_BENCHMARK_PASSWORD="[PASSWORD_HERE]";
export MYSQL_BENCHMARK_DATABASE="[DB_NAME_HERE]";
```

Once all is setup, run the following command from the root:

```sh
$ yarn benchmark
```
