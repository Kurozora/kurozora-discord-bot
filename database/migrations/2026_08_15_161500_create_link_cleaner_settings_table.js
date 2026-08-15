const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table each server’s link cleaning is set up in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS link_cleaner_settings (
		guildID TEXT PRIMARY KEY,
		isEnabled INTEGER NOT NULL DEFAULT 1,
		hidesPreviews INTEGER NOT NULL DEFAULT 1,
		cleanedLinks INTEGER NOT NULL DEFAULT 0,
		configuredAt TEXT NOT NULL,
		cleanedAt TEXT
	)`)
}

module.exports = {
	up: up
}
