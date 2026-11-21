import { NodeFileSystem } from "@effect/platform-node"
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem } from "effect"
import { Reactivity } from "effect/reactivity"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"

const makeClients = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const dir = yield* fs.makeTempDirectoryScoped()
  const filename = dir + "/test.db"

  return {
    lockClient: yield* SqliteClient.make({ filename }),
    migratorClient: yield* SqliteClient.make({ filename })
  }
}).pipe(Effect.provide([NodeFileSystem.layer, Reactivity.layer]))

describe("SqliteMigrator", () => {
  it.effect("fails with a typed MigrationError and rolls back failed migrations", () =>
    Effect.gen(function*() {
      const { migratorClient } = yield* makeClients

      const error = yield* Effect.flip(
        SqliteMigrator.run({
          loader: SqliteMigrator.fromRecord({
            "1_bad": Effect.gen(function*() {
              const sql = yield* SqlClient.SqlClient
              yield* sql`INSERT INTO missing_table (id) VALUES (1)`
            })
          })
        }).pipe(Effect.provideService(SqlClient.SqlClient, migratorClient))
      )

      assert(error._tag === "MigrationError")
      assert.strictEqual(error.kind, "Failed")
      assert(SqlError.isSqlError(error.cause))
      assert.deepStrictEqual(yield* migratorClient`SELECT migration_id FROM effect_sql_migrations`, [])
    }))

  it.effect("runs a migration with id 0 on a fresh database", () =>
    Effect.gen(function*() {
      const { migratorClient } = yield* makeClients

      const completed = yield* SqliteMigrator.run({
        loader: SqliteMigrator.fromRecord({
          "0000_a": Effect.gen(function*() {
            const sql = yield* SqlClient.SqlClient
            yield* sql`CREATE TABLE a (id integer)`
          }),
          "0001_b": Effect.gen(function*() {
            const sql = yield* SqlClient.SqlClient
            yield* sql`INSERT INTO a (id) VALUES (1)`
          })
        })
      }).pipe(Effect.provideService(SqlClient.SqlClient, migratorClient))

      assert.deepStrictEqual(completed, [[0, "a"], [1, "b"]])
      assert.deepStrictEqual(yield* migratorClient`SELECT id FROM a`, [{ id: 1 }])
      assert.deepStrictEqual(
        yield* migratorClient`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`,
        [{ migration_id: 0, name: "a" }, { migration_id: 1, name: "b" }]
      )
    }))

  it.effect("fails on lock errors", () =>
    Effect.gen(function*() {
      const { lockClient, migratorClient } = yield* makeClients

      yield* migratorClient`PRAGMA busy_timeout = 1`

      yield* SqliteMigrator.run({
        loader: SqliteMigrator.fromRecord({})
      }).pipe(Effect.provideService(SqlClient.SqlClient, migratorClient))

      yield* Effect.acquireRelease(
        lockClient`BEGIN IMMEDIATE`,
        () => lockClient`ROLLBACK`.pipe(Effect.ignore)
      )

      const error = yield* Effect.flip(
        SqliteMigrator.run({
          loader: SqliteMigrator.fromRecord({
            "1_test": Effect.void
          })
        }).pipe(Effect.provideService(SqlClient.SqlClient, migratorClient))
      )

      assert.strictEqual(error._tag, "SqlError")
      assert(SqlError.isSqlError(error))
      assert.strictEqual(error.reason._tag, "LockTimeoutError")
    }))
})
