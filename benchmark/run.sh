#!/bin/bash
cd "$(dirname "$0")"

mysql -u $MYSQL_BENCHMARK_USER -p$MYSQL_BENCHMARK_PASSWORD $MYSQL_BENCHMARK_DATABASE < setup.sql

echo "Running Baseline..."
../node_modules/.bin/ts-node --project ../tsconfig.benchmark.json ./baseline.ts

echo ""
echo "Running MySQL single id fetching..."
../node_modules/.bin/ts-node --project ../tsconfig.benchmark.json ./mysql-single-fetch.ts

echo ""
echo "Running MySQL batch id fetching..."
../node_modules/.bin/ts-node --project ../tsconfig.benchmark.json ./mysql-batch-fetch.ts

echo ""
echo "Running Memcached single id fetching..."
../node_modules/.bin/ts-node --project ../tsconfig.benchmark.json ./memcached-single-fetch.ts

echo ""
echo "Running Memcached batch fetching..."
../node_modules/.bin/ts-node --project ../tsconfig.benchmark.json ./memcached-batch-fetch.ts