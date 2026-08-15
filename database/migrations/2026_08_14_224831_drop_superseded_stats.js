const { Schema } = require('../../helpers/migrator')

/**
 * Drops the tables and the column an earlier version of the report wrote.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.dropTable('stats_active_guilds', 'stats_actors', 'stats_salt')
	schema.dropColumn('stats_daily', 'activeGuilds')
}

module.exports = {
	up: up
}
