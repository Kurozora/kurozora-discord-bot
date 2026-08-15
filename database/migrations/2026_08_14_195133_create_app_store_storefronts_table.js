const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the read storefronts are tracked in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS app_store_storefronts (
		storefront TEXT PRIMARY KEY,
		readAt TEXT NOT NULL
	)`)
}

module.exports = {
	up: up
}
