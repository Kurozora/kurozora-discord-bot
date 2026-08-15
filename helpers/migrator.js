const fs = require('fs')
const path = require('path')
const { Database } = require('./database')

/** The table the applied migrations are tracked in. */
const table = 'migrations'

/** The extension a migration is written in. */
const extension = '.js'

class Schema {
	// MARK: - Properties
	/**
	 * @param {Database} db - db
	 */
	db

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Database} db - db
	 */
	constructor(db) {
		this.db = db
	}

	// MARK: - Functions
	/**
	 * Runs the statements.
	 *
	 * @param {string} sql - sql
	 */
	exec(sql) {
		this.db.exec(sql)
	}

	/**
	 * Whether the database carries the table.
	 *
	 * @param {string} name - name
	 *
	 * @returns {boolean} hasTable - has table
	 */
	hasTable(name) {
		return !!this.db.get('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?', 'table', name)
	}

	/**
	 * Whether a table carries the column.
	 *
	 * @param {string} name - name
	 * @param {string} column - column
	 *
	 * @returns {boolean} hasColumn - has column
	 */
	hasColumn(name, column) {
		return this.db.all(`PRAGMA table_info(${name})`).some(existing => existing.name === column)
	}

	/**
	 * Adds the column to the table.
	 *
	 * @param {string} name - name
	 * @param {string} column - column
	 * @param {string} declaration - declaration
	 */
	addColumn(name, column, declaration) {
		if (this.hasTable(name) && !this.hasColumn(name, column)) {
			this.db.exec(`ALTER TABLE ${name} ADD COLUMN ${column} ${declaration}`)
		}
	}

	/**
	 * Drops the column from the table.
	 *
	 * @param {string} name - name
	 * @param {string} column - column
	 */
	dropColumn(name, column) {
		if (this.hasTable(name) && this.hasColumn(name, column)) {
			this.db.exec(`ALTER TABLE ${name} DROP COLUMN ${column}`)
		}
	}

	/**
	 * Drops the tables.
	 *
	 * @param {...string} names - names
	 */
	dropTable(...names) {
		for (const name of names) {
			this.db.exec(`DROP TABLE IF EXISTS ${name}`)
		}
	}
}

class Migrator {
	// MARK: - Properties
	/**
	 * @param {Database} db - db
	 */
	db

	/**
	 * @param {string} directory - directory
	 */
	directory

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Database} db - db
	 * @param {string} directory - directory
	 */
	constructor(db, directory) {
		this.db = db
		this.directory = directory
	}

	// MARK: - Functions
	/**
	 * Runs every migration the database hasn’t run yet, oldest first.
	 *
	 * @returns {Promise<string[]>} migrations - migrations
	 */
	async migrate() {
		this.prepare()

		const pending = this.pending()

		if (!pending.length) {
			return []
		}

		const batch = this.batch() + 1
		const schema = new Schema(this.db)

		for (const migration of pending) {
			this.run(migration, schema, batch)
		}

		console.log(`🗄️ Ran ${pending.length} ${pending.length === 1 ? 'migration' : 'migrations'} in batch ${batch}.`)

		return pending
	}

	/**
	 * Runs a migration and tracks it.
	 *
	 * @param {string} migration - migration
	 * @param {Schema} schema - schema
	 * @param {number} batch - batch
	 */
	run(migration, schema, batch) {
		const { up } = require(path.resolve(this.directory, migration))

		this.db.exec('BEGIN')

		try {
			up(schema)
			this.db.run(`INSERT INTO ${table} (migration, batch, ranAt) VALUES (?, ?, ?)`, migration, batch, new Date().toISOString())
			this.db.exec('COMMIT')
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw new Error(`The migration ${migration} failed and was rolled back: ${error.message}`)
		}
	}

	/** Creates the table the applied migrations are tracked in. */
	prepare() {
		this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
			migration TEXT PRIMARY KEY,
			batch INTEGER NOT NULL,
			ranAt TEXT NOT NULL
		)`)
	}

	/**
	 * The migrations the database hasn’t run yet, oldest first.
	 *
	 * @returns {string[]} migrations - migrations
	 */
	pending() {
		const ran = new Set(this.db.all(`SELECT migration FROM ${table}`).map(row => row.migration))
		return this.migrations().filter(migration => !ran.has(migration))
	}

	/**
	 * Every migration the directory holds, oldest first.
	 *
	 * @returns {string[]} migrations - migrations
	 */
	migrations() {
		if (!fs.existsSync(this.directory)) {
			return []
		}

		return fs.readdirSync(this.directory)
			.filter(migration => migration.endsWith(extension))
			.sort()
	}

	/**
	 * The batch the last migration ran in.
	 *
	 * @returns {number} batch - batch
	 */
	batch() {
		return this.db.get(`SELECT COALESCE(MAX(batch), 0) AS batch FROM ${table}`).batch
	}
}

module.exports = {
	Migrator: Migrator,
	Schema: Schema
}
