const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the hours a channel is awake at are counted in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS gif_drop_hours (
		guildID TEXT NOT NULL,
		hour INTEGER NOT NULL,
		messages INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (guildID, hour)
	)`)
}

module.exports = {
	up: up
}
