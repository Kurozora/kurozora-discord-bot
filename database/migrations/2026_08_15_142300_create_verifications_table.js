const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the members verifying their join are held in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS verifications (
		guildID TEXT NOT NULL,
		userID TEXT NOT NULL,
		joinedAt TEXT NOT NULL,
		verifiedAt TEXT,
		method TEXT,
		nonce TEXT,
		expiresAt TEXT,
		attempts INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (guildID, userID)
	)`)
	schema.exec('CREATE INDEX IF NOT EXISTS verifications_pending ON verifications (guildID, verifiedAt, joinedAt)')
	schema.exec('CREATE UNIQUE INDEX IF NOT EXISTS verifications_nonces ON verifications (nonce)')
}

module.exports = {
	up: up
}
