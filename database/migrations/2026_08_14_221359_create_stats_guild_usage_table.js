const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the commands a server ran are counted in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS stats_guild_usage (
		day TEXT NOT NULL,
		guildID TEXT NOT NULL,
		invocations INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (day, guildID)
	)`)
}

module.exports = {
	up: up
}
