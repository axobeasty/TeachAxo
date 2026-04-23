const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const mysql = require("mysql2/promise");

const STATE_KEY = "app_state";
const REL_SCHEMA_VERSION = "2";

class DatabaseService {
  constructor(userDataPath, runtimeConfig = {}) {
    this.userDataPath = userDataPath;
    this.runtimeConfig = this.normalizeRuntimeConfig(runtimeConfig);
    this.sqlitePath = path.join(userDataPath, this.resolveLocalDbFileName(this.runtimeConfig.localName));
    this.SQL = null;
    this.db = null;
    this.remoteConfig = null;
    this.remoteSchemaReady = false;
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
    const localName = String(config?.localName || "teachaxo.sqlite").trim() || "teachaxo.sqlite";
    return {
      mode,
      localName,
      remote: {
        host: String(remote.host || "").trim(),
        port: String(remote.port || "3306").trim() || "3306",
        user: String(remote.user || "").trim(),
        password: remote.password || "",
        database: String(remote.database || "").trim()
      }
    };
  }

  resolveLocalDbFileName(fileName) {
    const fallback = "teachaxo.sqlite";
    const normalized = String(fileName || "").trim();
    if (!normalized) return fallback;
    const baseName = path.basename(normalized);
    const safeName = baseName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
    if (!safeName) return fallback;
    if (safeName.includes(".")) return safeName;
    return `${safeName}.sqlite`;
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
    this.ensureSqliteRelationalSchema();
    this.persist();
  }

  ensureSqliteRelationalSchema() {
    this.db.run(
      `CREATE TABLE IF NOT EXISTS meta_store (
        key_name TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS classes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT ''
      )`
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      )`
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS grades (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        value TEXT NOT NULL,
        date TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT ''
      )`
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS schedule_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        day TEXT NOT NULL,
        lesson_number INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        class_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        room TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      )`
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0
      )`
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        role_id TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0
      )`
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS state_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schedule_settings_json TEXT NOT NULL,
        database_config_json TEXT NOT NULL,
        auth_json TEXT NOT NULL,
        current_user_id TEXT
      )`
    );
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
      await this.ensureRemoteRelationalSchema(connection);
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    } finally {
      if (connection) await connection.end();
    }
  }

  async ensureRemoteRelationalSchema(connection) {
    if (this.remoteSchemaReady) return;
    await connection.query(`CREATE TABLE IF NOT EXISTS meta_store (
      key_name VARCHAR(128) PRIMARY KEY,
      value_json LONGTEXT NOT NULL,
      updated_at DATETIME NOT NULL
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS classes (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      note TEXT NOT NULL
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS students (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      class_name VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      contact VARCHAR(255) NOT NULL,
      notes TEXT NOT NULL
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS grades (
      id VARCHAR(64) PRIMARY KEY,
      student_id VARCHAR(64) NOT NULL,
      value VARCHAR(16) NOT NULL,
      date VARCHAR(32) NOT NULL,
      comment TEXT NOT NULL
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS schedule_entries (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      day VARCHAR(32) NOT NULL,
      lesson_number INT NOT NULL,
      start_time VARCHAR(8) NOT NULL,
      end_time VARCHAR(8) NOT NULL,
      class_name VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      room VARCHAR(255) NOT NULL,
      notes TEXT NOT NULL
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS roles (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      permissions_json LONGTEXT NOT NULL,
      is_system TINYINT(1) NOT NULL DEFAULT 0
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      role_id VARCHAR(64) NOT NULL,
      is_system TINYINT(1) NOT NULL DEFAULT 0
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS state_settings (
      id INT PRIMARY KEY,
      schedule_settings_json LONGTEXT NOT NULL,
      database_config_json LONGTEXT NOT NULL,
      auth_json LONGTEXT NOT NULL,
      current_user_id VARCHAR(64) NULL
    )`);
    this.remoteSchemaReady = true;
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
    const relational = this.readSqliteRelationalState();
    if (relational) {
      return JSON.stringify(relational);
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
    this.writeSqliteRelationalState(stateObject || {});
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

  getDefaultState() {
    return {
      classes: [],
      students: [],
      grades: [],
      schedule: [],
      scheduleSettings: { firstLessonStart: "08:00", lessonDurationMin: 45 },
      databaseConfig: {
        mode: "local",
        localName: "teachaxo.sqlite",
        remote: { host: "", port: "3306", user: "", password: "", database: "" }
      },
      roles: [],
      users: [],
      currentUserId: null,
      auth: { rememberSession: false, rememberedUserId: null }
    };
  }

  parseJsonSafe(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  upsertSqliteMeta(key, value) {
    this.db.run(
      `INSERT INTO meta_store (key_name, value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key_name) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      [key, value]
    );
  }

  readSqliteMeta(key) {
    const statement = this.db.prepare("SELECT value_json FROM meta_store WHERE key_name = ?");
    statement.bind([key]);
    if (!statement.step()) return null;
    return statement.getAsObject().value_json || null;
  }

  readSqliteRelationalState() {
    const version = this.readSqliteMeta("schema_version");
    if (version !== REL_SCHEMA_VERSION) return null;
    const base = this.getDefaultState();
    const toRows = (query) => {
      const statement = this.db.prepare(query);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    };
    base.classes = toRows("SELECT id, name, note FROM classes ORDER BY name");
    base.students = toRows(
      "SELECT id, name, class_name as className, subject, contact, notes FROM students ORDER BY name"
    );
    base.grades = toRows("SELECT id, student_id as studentId, value, date, comment FROM grades ORDER BY date DESC");
    base.schedule = toRows(
      "SELECT id, user_id as userId, day, lesson_number as lessonNumber, start_time as start, end_time as end, class_name as className, subject, room, notes FROM schedule_entries"
    );
    base.roles = toRows("SELECT id, name, permissions_json, is_system as isSystem FROM roles").map((row) => ({
      id: row.id,
      name: row.name,
      permissions: this.parseJsonSafe(row.permissions_json, []),
      isSystem: Boolean(row.isSystem)
    }));
    base.users = toRows("SELECT id, username, password, role_id as roleId, is_system as isSystem FROM users").map((row) => ({
      id: row.id,
      username: row.username,
      password: row.password,
      roleId: row.roleId,
      isSystem: Boolean(row.isSystem)
    }));
    const settingsRow = toRows(
      "SELECT schedule_settings_json, database_config_json, auth_json, current_user_id as currentUserId FROM state_settings WHERE id = 1 LIMIT 1"
    )[0];
    if (settingsRow) {
      base.scheduleSettings = this.parseJsonSafe(settingsRow.schedule_settings_json, base.scheduleSettings);
      base.databaseConfig = this.parseJsonSafe(settingsRow.database_config_json, base.databaseConfig);
      base.auth = this.parseJsonSafe(settingsRow.auth_json, base.auth);
      base.currentUserId = settingsRow.currentUserId || null;
    }
    return base;
  }

  writeSqliteRelationalState(stateObject) {
    const state = { ...this.getDefaultState(), ...(stateObject || {}) };
    this.db.run("BEGIN");
    try {
      this.db.run("DELETE FROM classes");
      this.db.run("DELETE FROM students");
      this.db.run("DELETE FROM grades");
      this.db.run("DELETE FROM schedule_entries");
      this.db.run("DELETE FROM roles");
      this.db.run("DELETE FROM users");

      for (const cls of state.classes || []) {
        this.db.run("INSERT INTO classes (id, name, note) VALUES (?, ?, ?)", [cls.id, cls.name || "", cls.note || ""]);
      }
      for (const student of state.students || []) {
        this.db.run(
          "INSERT INTO students (id, name, class_name, subject, contact, notes) VALUES (?, ?, ?, ?, ?, ?)",
          [student.id, student.name || "", student.className || "", student.subject || "", student.contact || "", student.notes || ""]
        );
      }
      for (const grade of state.grades || []) {
        this.db.run("INSERT INTO grades (id, student_id, value, date, comment) VALUES (?, ?, ?, ?, ?)", [
          grade.id,
          grade.studentId || "",
          String(grade.value || ""),
          grade.date || "",
          grade.comment || ""
        ]);
      }
      for (const entry of state.schedule || []) {
        this.db.run(
          "INSERT INTO schedule_entries (id, user_id, day, lesson_number, start_time, end_time, class_name, subject, room, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            entry.id,
            entry.userId || "",
            entry.day || "",
            Number(entry.lessonNumber || 0),
            entry.start || "",
            entry.end || "",
            entry.className || "",
            entry.subject || "",
            entry.room || "",
            entry.notes || ""
          ]
        );
      }
      for (const role of state.roles || []) {
        this.db.run("INSERT INTO roles (id, name, permissions_json, is_system) VALUES (?, ?, ?, ?)", [
          role.id,
          role.name || "",
          JSON.stringify(Array.isArray(role.permissions) ? role.permissions : []),
          role.isSystem ? 1 : 0
        ]);
      }
      for (const user of state.users || []) {
        this.db.run("INSERT INTO users (id, username, password, role_id, is_system) VALUES (?, ?, ?, ?, ?)", [
          user.id,
          user.username || "",
          user.password || "",
          user.roleId || "",
          user.isSystem ? 1 : 0
        ]);
      }

      this.db.run(
        `INSERT INTO state_settings (id, schedule_settings_json, database_config_json, auth_json, current_user_id)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           schedule_settings_json = excluded.schedule_settings_json,
           database_config_json = excluded.database_config_json,
           auth_json = excluded.auth_json,
           current_user_id = excluded.current_user_id`,
        [
          JSON.stringify(state.scheduleSettings || this.getDefaultState().scheduleSettings),
          JSON.stringify(state.databaseConfig || this.getDefaultState().databaseConfig),
          JSON.stringify(state.auth || this.getDefaultState().auth),
          state.currentUserId || null
        ]
      );
      this.upsertSqliteMeta("schema_version", REL_SCHEMA_VERSION);
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
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
      await this.ensureRemoteRelationalSchema(connection);
      const relational = await this.readRemoteRelationalState(connection);
      if (relational) return JSON.stringify(relational);
      const [rows] = await connection.query("SELECT value_json FROM teachaxo_state WHERE key_name = ? LIMIT 1", [STATE_KEY]);
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
      await this.ensureRemoteRelationalSchema(connection);
      await this.writeRemoteRelationalState(connection, stateObject || {});
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    } finally {
      if (connection) await connection.end();
    }
  }

  async readRemoteRelationalState(connection) {
    const [metaRows] = await connection.query("SELECT value_json FROM meta_store WHERE key_name = ? LIMIT 1", ["schema_version"]);
    const version = metaRows?.[0]?.value_json || null;
    if (version !== REL_SCHEMA_VERSION) return null;
    const base = this.getDefaultState();
    const [classes] = await connection.query("SELECT id, name, note FROM classes ORDER BY name");
    const [students] = await connection.query(
      "SELECT id, name, class_name AS className, subject, contact, notes FROM students ORDER BY name"
    );
    const [grades] = await connection.query(
      "SELECT id, student_id AS studentId, value, date, comment FROM grades ORDER BY date DESC"
    );
    const [schedule] = await connection.query(
      "SELECT id, user_id AS userId, day, lesson_number AS lessonNumber, start_time AS start, end_time AS end, class_name AS className, subject, room, notes FROM schedule_entries"
    );
    const [rolesRaw] = await connection.query("SELECT id, name, permissions_json, is_system AS isSystem FROM roles");
    const [usersRaw] = await connection.query(
      "SELECT id, username, password, role_id AS roleId, is_system AS isSystem FROM users"
    );
    const [settingsRows] = await connection.query(
      "SELECT schedule_settings_json, database_config_json, auth_json, current_user_id AS currentUserId FROM state_settings WHERE id = 1 LIMIT 1"
    );
    base.classes = classes;
    base.students = students;
    base.grades = grades;
    base.schedule = schedule;
    base.roles = rolesRaw.map((row) => ({
      id: row.id,
      name: row.name,
      permissions: this.parseJsonSafe(row.permissions_json, []),
      isSystem: Boolean(row.isSystem)
    }));
    base.users = usersRaw.map((row) => ({
      id: row.id,
      username: row.username,
      password: row.password,
      roleId: row.roleId,
      isSystem: Boolean(row.isSystem)
    }));
    const settings = settingsRows?.[0];
    if (settings) {
      base.scheduleSettings = this.parseJsonSafe(settings.schedule_settings_json, base.scheduleSettings);
      base.databaseConfig = this.parseJsonSafe(settings.database_config_json, base.databaseConfig);
      base.auth = this.parseJsonSafe(settings.auth_json, base.auth);
      base.currentUserId = settings.currentUserId || null;
    }
    return base;
  }

  async writeRemoteRelationalState(connection, stateObject) {
    const state = { ...this.getDefaultState(), ...(stateObject || {}) };
    await connection.beginTransaction();
    try {
      await connection.query("DELETE FROM classes");
      await connection.query("DELETE FROM students");
      await connection.query("DELETE FROM grades");
      await connection.query("DELETE FROM schedule_entries");
      await connection.query("DELETE FROM roles");
      await connection.query("DELETE FROM users");

      await this.bulkInsertRemote(
        connection,
        "classes",
        ["id", "name", "note"],
        (state.classes || []).map((cls) => [cls.id, cls.name || "", cls.note || ""])
      );
      await this.bulkInsertRemote(
        connection,
        "students",
        ["id", "name", "class_name", "subject", "contact", "notes"],
        (state.students || []).map((student) => [
          student.id,
          student.name || "",
          student.className || "",
          student.subject || "",
          student.contact || "",
          student.notes || ""
        ])
      );
      await this.bulkInsertRemote(
        connection,
        "grades",
        ["id", "student_id", "value", "date", "comment"],
        (state.grades || []).map((grade) => [
          grade.id,
          grade.studentId || "",
          String(grade.value || ""),
          grade.date || "",
          grade.comment || ""
        ])
      );
      await this.bulkInsertRemote(
        connection,
        "schedule_entries",
        ["id", "user_id", "day", "lesson_number", "start_time", "end_time", "class_name", "subject", "room", "notes"],
        (state.schedule || []).map((entry) => [
          entry.id,
          entry.userId || "",
          entry.day || "",
          Number(entry.lessonNumber || 0),
          entry.start || "",
          entry.end || "",
          entry.className || "",
          entry.subject || "",
          entry.room || "",
          entry.notes || ""
        ])
      );
      await this.bulkInsertRemote(
        connection,
        "roles",
        ["id", "name", "permissions_json", "is_system"],
        (state.roles || []).map((role) => [
          role.id,
          role.name || "",
          JSON.stringify(Array.isArray(role.permissions) ? role.permissions : []),
          role.isSystem ? 1 : 0
        ])
      );
      await this.bulkInsertRemote(
        connection,
        "users",
        ["id", "username", "password", "role_id", "is_system"],
        (state.users || []).map((user) => [
          user.id,
          user.username || "",
          user.password || "",
          user.roleId || "",
          user.isSystem ? 1 : 0
        ])
      );
      await connection.query(
        `INSERT INTO state_settings (id, schedule_settings_json, database_config_json, auth_json, current_user_id)
         VALUES (1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           schedule_settings_json = VALUES(schedule_settings_json),
           database_config_json = VALUES(database_config_json),
           auth_json = VALUES(auth_json),
           current_user_id = VALUES(current_user_id)`,
        [
          JSON.stringify(state.scheduleSettings || this.getDefaultState().scheduleSettings),
          JSON.stringify(state.databaseConfig || this.getDefaultState().databaseConfig),
          JSON.stringify(state.auth || this.getDefaultState().auth),
          state.currentUserId || null
        ]
      );
      await connection.query(
        `INSERT INTO meta_store (key_name, value_json, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
        ["schema_version", REL_SCHEMA_VERSION]
      );
      await connection.query(
        `INSERT INTO teachaxo_state (key_name, value_json, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
        [STATE_KEY, JSON.stringify(state)]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  async bulkInsertRemote(connection, tableName, columns, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const chunkSize = 500;
    const columnsSql = columns.map((column) => `\`${column}\``).join(", ");
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
      const params = chunk.flat();
      await connection.query(`INSERT INTO \`${tableName}\` (${columnsSql}) VALUES ${placeholders}`, params);
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
      await this.ensureRemoteRelationalSchema(connection);

      const stateJson = (await this.getStateAsync()) || "{}";
      const stateObject = this.parseJsonSafe(stateJson, this.getDefaultState());
      await this.writeRemoteRelationalState(connection, stateObject);
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

  async ping() {
    if (this.runtimeConfig.mode !== "remote") {
      return { ok: true };
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
      await connection.query("SELECT 1");
      return { ok: true };
    } catch (error) {
      throw this.formatMysqlError(error, remote);
    } finally {
      if (connection) await connection.end();
    }
  }
}

module.exports = { DatabaseService };
