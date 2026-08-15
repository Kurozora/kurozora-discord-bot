const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the servers are tracked in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS stats_guilds (
		guildID TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		members INTEGER NOT NULL DEFAULT 0,
		joinedAt TEXT,
		leftAt TEXT
	)`)
}

module.exports = {
	up: up
}
