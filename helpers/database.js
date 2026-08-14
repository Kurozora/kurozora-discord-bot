const { DatabaseSync } = require('node:sqlite')

class Database {
	// MARK: - Properties
	/**
	 * @param {DatabaseSync} handle - handle
	 */
	handle

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {string} filename - filename
	 */
	constructor(filename) {
		this.handle = new DatabaseSync(filename)
	}

	// MARK: - Functions
	/**
	 * Runs the statements.
	 *
	 * @param {string} sql - sql
	 */
	exec(sql) {
		this.handle.exec(sql)
	}

	/**
	 * The first row the statement returns.
	 *
	 * @param {string} sql - sql
	 * @param {...*} parameters - parameters
	 *
	 * @returns {Object|undefined}
	 */
	get(sql, ...parameters) {
		return this.handle.prepare(sql).get(...this.bindings(parameters))
	}

	/**
	 * Every row the statement returns.
	 *
	 * @param {string} sql - sql
	 * @param {...*} parameters - parameters
	 *
	 * @returns {Object[]}
	 */
	all(sql, ...parameters) {
		return this.handle.prepare(sql).all(...this.bindings(parameters))
	}

	/**
	 * Runs the statement.
	 *
	 * @param {string} sql - sql
	 * @param {...*} parameters - parameters
	 *
	 * @returns {Object}
	 */
	run(sql, ...parameters) {
		return this.handle.prepare(sql).run(...this.bindings(parameters))
	}

	/** Closes the database. */
	close() {
		this.handle.close()
	}

	/**
	 * The parameters a statement is bound with.
	 *
	 * @param {Array} parameters - parameters
	 *
	 * @returns {Array}
	 */
	bindings(parameters) {
		return parameters.length === 1 && Array.isArray(parameters[0]) ? parameters[0] : parameters
	}
}

module.exports = {
	Database: Database
}
