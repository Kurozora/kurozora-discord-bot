const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the verification decisions are recorded in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS verification_events (
		guildID TEXT NOT NULL,
		userID TEXT,
		event TEXT NOT NULL,
		detail TEXT,
		createdAt TEXT NOT NULL
	)`)
	schema.exec('CREATE INDEX IF NOT EXISTS verification_events_history ON verification_events (guildID, createdAt)')
}

module.exports = {
	up: up
}
