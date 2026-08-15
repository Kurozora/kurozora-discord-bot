const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the commands are counted in, by the day they ran on.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS stats_commands (
		day TEXT NOT NULL,
		command TEXT NOT NULL,
		invocations INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (day, command)
	)`)
}

module.exports = {
	up: up
}
