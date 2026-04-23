const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const mysql = require("mysql2/promise");

const STATE_KEY = "app_state";

class DatabaseService {
  constructor(userDataPath, runtimeConfig = {}) {
    this.userDataPath = userDataPath;
    this.sqlitePath = path.join(userDataPath, "teachaxo.sqlite");
    this.SQL = null;
    this.db = null;
    this.runtimeConfig = this.normalizeRuntimeConfig(runtimeConfig);
    this.remoteConfig = null;
  }

  async init() {
    if (this.runtimeConfig.mode === "remote") {
      await this.initRemote();
      return;
    }
    await this.initSqlite();
  }

  normalizeRuntimeConfig(config) {
    const mode = config?.mode === "remote" ? "remote" : "local";
    const remote = config?.remote || {};
    return {
      mode,
      remote: {
        host: String(remote.host || "").trim(),
        port: String(remote.port || "3306").trim() || "3306",
        user: String(remote.user || "").trim(),
        password: remote.password || "",
        database: String(remote.database || "").trim()
      }
    };
  }

  async initSqlite() {
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

  async initRemote() {
    const remote = this.normalizeRemoteConfig({
      mode: "remote",
      remote: this.runtimeConfig.remote
    });
    this.remoteConfig = remote;
    let connection;
    try {
      connection = await mysql.createConnection({
        host: remote.host,
        port: remote.port,
        user: remote.user,
        password: remote.password
      });
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${remote.database}\``);
      await connection.query(`USE \`${remote.database}\``);
      await connection.query(`CREATE TABLE IF NOT EXISTS teachaxo_state (
        key_name VARCHAR(64) PRIMARY KEY,
        value_json LONGTEXT NOT NULL,
        updated_at DATETIME NOT NULL
      )`);
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    } finally {
      if (connection) await connection.end();
    }
  }

  persist() {
    if (!this.db) return;
    const data = this.db.export();
    fs.writeFileSync(this.sqlitePath, Buffer.from(data));
  }

  getState() {
    if (this.runtimeConfig.mode === "remote") {
      throw new Error("Use getStateAsync for remote database mode.");
    }
    const statement = this.db.prepare("SELECT value_json FROM kv_store WHERE key_name = ?");
    statement.bind([STATE_KEY]);
    const hasRow = statement.step();
    if (!hasRow) return null;
    const row = statement.getAsObject();
    return row.value_json || null;
  }

  setState(stateObject) {
    if (this.runtimeConfig.mode === "remote") {
      throw new Error("Use setStateAsync for remote database mode.");
    }
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

  async getStateAsync() {
    if (this.runtimeConfig.mode !== "remote") {
      return this.getState();
    }
    const remote = this.remoteConfig || this.normalizeRemoteConfig({ mode: "remote", remote: this.runtimeConfig.remote });
    let connection;
    try {
      connection = await mysql.createConnection({
        host: remote.host,
        port: remote.port,
        user: remote.user,
        password: remote.password,
        database: remote.database
      });
      const [rows] = await connection.query(
        "SELECT value_json FROM teachaxo_state WHERE key_name = ? LIMIT 1",
        [STATE_KEY]
      );
      return rows?.[0]?.value_json || null;
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    } finally {
      if (connection) await connection.end();
    }
  }

  async setStateAsync(stateObject) {
    if (this.runtimeConfig.mode !== "remote") {
      this.setState(stateObject);
      return;
    }
    const remote = this.remoteConfig || this.normalizeRemoteConfig({ mode: "remote", remote: this.runtimeConfig.remote });
    let connection;
    try {
      connection = await mysql.createConnection({
        host: remote.host,
        port: remote.port,
        user: remote.user,
        password: remote.password,
        database: remote.database
      });
      const payload = JSON.stringify(stateObject);
      await connection.query(
        `INSERT INTO teachaxo_state (key_name, value_json, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
        [STATE_KEY, payload]
      );
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    } finally {
      if (connection) await connection.end();
    }
  }

  normalizeRemoteConfig(config) {
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
    return {
      host: String(remote.host).trim(),
      port: Number(remote.port),
      user: String(remote.user).trim(),
      password: remote.password || "",
      database: String(remote.database).trim()
    };
  }

  formatMysqlError(error, remote) {
    if (error?.code === "ECONNREFUSED") {
      return new Error(
        `Сервер MySQL недоступен по адресу ${remote.host}:${remote.port}. Проверьте host/port (обычно MySQL использует 3306), firewall и доступность сервера.`
      );
    }
    if (error?.code === "ER_ACCESS_DENIED_ERROR") {
      return new Error("Неверные логин или пароль для подключения к MySQL.");
    }
    return error;
  }

  async testMysqlConnection(config) {
    const remote = this.normalizeRemoteConfig(config);
    let connection;
    try {
      connection = await mysql.createConnection({
        host: remote.host,
        port: remote.port,
        user: remote.user,
        password: remote.password
      });
      await connection.query("SELECT 1");
      return { ok: true };
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    } finally {
      if (connection) await connection.end();
    }
  }

  async migrateToMysql(config) {
    const remote = this.normalizeRemoteConfig(config);

    let connection;
    try {
      connection = await mysql.createConnection({
        host: remote.host,
        port: remote.port,
        user: remote.user,
        password: remote.password
      });
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    }

    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${remote.database}\``);
      await connection.query(`USE \`${remote.database}\``);
      await connection.query(`CREATE TABLE IF NOT EXISTS teachaxo_state (
        key_name VARCHAR(64) PRIMARY KEY,
        value_json LONGTEXT NOT NULL,
        updated_at DATETIME NOT NULL
      )`);

      const stateJson = (await this.getStateAsync()) || "{}";
      await connection.query(
        `INSERT INTO teachaxo_state (key_name, value_json, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
        [STATE_KEY, stateJson]
      );
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    } finally {
      await connection.end();
    }
  }

  getInfo() {
    if (this.runtimeConfig.mode === "remote") {
      return {
        provider: "mysql",
        sqlitePath: this.sqlitePath,
        remoteHost: this.runtimeConfig.remote.host,
        remoteDatabase: this.runtimeConfig.remote.database
      };
    }
    return {
      provider: "sqlite",
      sqlitePath: this.sqlitePath
    };
  }
}

module.exports = { DatabaseService };
