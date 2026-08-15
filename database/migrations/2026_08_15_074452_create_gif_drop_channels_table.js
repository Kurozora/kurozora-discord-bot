const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the channels GIFs drop in are configured in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS gif_drop_channels (
		guildID TEXT PRIMARY KEY,
		channelID TEXT NOT NULL,
		isEnabled INTEGER NOT NULL DEFAULT 1,
		configuredAt TEXT NOT NULL,
		droppedAt TEXT,
		messageID TEXT,
		jitter INTEGER NOT NULL DEFAULT 0,
		quietDrops INTEGER NOT NULL DEFAULT 0,
		isScored INTEGER NOT NULL DEFAULT 1,
		countedAt TEXT,
		awakeFrom INTEGER,
		awakeTo INTEGER
	)`)
}

module.exports = {
	up: up
}
