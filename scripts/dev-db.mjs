// Local PostgreSQL without Docker: `yarn db:start` (Ctrl+C to stop). Data lives in .data/pg.
import fs from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const DB = process.env.DEV_DB_NAME ?? "department";
const dir = ".data/pg";

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error(String(e).trim()),
});

if (!fs.existsSync(`${dir}/PG_VERSION`)) {
  console.log("Initialising a new local Postgres cluster…");
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase(DB);
  console.log(`Created database "${DB}"`);
} catch {
  /* already exists */
}
console.log(`\nPostgres ready → postgres://postgres:postgres@localhost:${PORT}/${DB}\nCtrl+C to stop.`);

const stop = async () => {
  console.log("\nStopping Postgres…");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
