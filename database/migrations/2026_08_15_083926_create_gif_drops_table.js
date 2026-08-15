const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the dropped GIFs are remembered in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS gif_drops (
		guildID TEXT NOT NULL,
		url TEXT NOT NULL,
		title TEXT,
		droppedAt TEXT NOT NULL,
		PRIMARY KEY (guildID, url)
	)`)
	schema.exec('CREATE INDEX IF NOT EXISTS gif_drops_titles ON gif_drops (guildID, title, droppedAt)')
}

module.exports = {
	up: up
}
