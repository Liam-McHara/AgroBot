#!/bin/sh
# Creates the extra databases listed in POSTGRES_MULTIPLE_DATABASES (the official image only
# creates POSTGRES_DB). Runs once, when the data volume is first initialised.
set -eu

for database in $(echo "${POSTGRES_MULTIPLE_DATABASES:-}" | tr ',' ' '); do
  echo "creating database ${database}"
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-SQL
	CREATE DATABASE "${database}" OWNER "${POSTGRES_USER}";
SQL
done
