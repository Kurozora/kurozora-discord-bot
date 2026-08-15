const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table each server’s verification is set up in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS verification_settings (
		guildID TEXT PRIMARY KEY,
		channelID TEXT NOT NULL,
		roleID TEXT NOT NULL,
		logChannelID TEXT,
		inviteURL TEXT,
		challengeMinutes INTEGER NOT NULL DEFAULT 15,
		kickHours INTEGER NOT NULL DEFAULT 24,
		establishedDays INTEGER NOT NULL DEFAULT 730,
		passesEstablished INTEGER NOT NULL DEFAULT 1,
		raidJoins INTEGER NOT NULL DEFAULT 10,
		raidWindowSeconds INTEGER NOT NULL DEFAULT 60,
		raidCooldownMinutes INTEGER NOT NULL DEFAULT 30,
		raidUntil TEXT,
		raidLevel INTEGER,
		isEnabled INTEGER NOT NULL DEFAULT 1
	)`)
}

module.exports = {
	up: up
}
