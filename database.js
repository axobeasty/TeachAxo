const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const mysql = require("mysql2/promise");

const STATE_KEY = "app_state";

class DatabaseService {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.sqlitePath = path.join(userDataPath, "teachaxo.sqlite");
    this.SQL = null;
    this.db = null;
  }

  async init() {
    if (this.db) return;
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    this.SQL = await initSqlJs({
      locateFile: () => wasmPath
    });

    const hasFile = fs.existsSync(this.sqlitePath);
    const fileBuffer = hasFile ? fs.readFileSync(this.sqlitePath) : null;
    this.db = fileBuffer ? new this.SQL.Database(fileBuffer) : new this.SQL.Database();

    this.db.run(
      `CREATE TABLE IF NOT EXISTS kv_store (
        key_name TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );
    this.persist();
  }

  persist() {
    if (!this.db) return;
    const data = this.db.export();
    fs.writeFileSync(this.sqlitePath, Buffer.from(data));
  }

  getState() {
    const statement = this.db.prepare("SELECT value_json FROM kv_store WHERE key_name = ?");
    statement.bind([STATE_KEY]);
    const hasRow = statement.step();
    if (!hasRow) return null;
    const row = statement.getAsObject();
    return row.value_json || null;
  }

  setState(stateObject) {
    const payload = JSON.stringify(stateObject);
    this.db.run(
      `INSERT INTO kv_store (key_name, value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key_name) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      [STATE_KEY, payload]
    );
    this.persist();
  }

  async migrateToMysql(config) {
    const mode = config?.mode;
    if (mode !== "remote") {
      throw new Error("Для миграции в MySQL выберите режим удаленной БД.");
    }
    const remote = config.remote || {};
    const required = ["host", "port", "user", "database"];
    const missing = required.filter((key) => !String(remote[key] || "").trim());
    if (missing.length) {
      throw new Error(`Не заполнены обязательные поля: ${missing.join(", ")}`);
    }

    const connection = await mysql.createConnection({
      host: remote.host,
      port: Number(remote.port),
      user: remote.user,
      password: remote.password || ""
    });

    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${remote.database}\``);
      await connection.query(`USE \`${remote.database}\``);
      await connection.query(`CREATE TABLE IF NOT EXISTS teachaxo_state (
        key_name VARCHAR(64) PRIMARY KEY,
        value_json LONGTEXT NOT NULL,
        updated_at DATETIME NOT NULL
      )`);

      const stateJson = this.getState() || "{}";
      await connection.query(
        `INSERT INTO teachaxo_state (key_name, value_json, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
        [STATE_KEY, stateJson]
      );
    } finally {
      await connection.end();
    }
  }

  getInfo() {
    return {
      provider: "sqlite",
      sqlitePath: this.sqlitePath
    };
  }
}

module.exports = { DatabaseService };
