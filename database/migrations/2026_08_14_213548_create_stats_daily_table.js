const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the reach is written to once an hour.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS stats_daily (
		day TEXT PRIMARY KEY,
		guilds INTEGER NOT NULL DEFAULT 0,
		members INTEGER NOT NULL DEFAULT 0
	)`)
}

module.exports = {
	up: up
}
