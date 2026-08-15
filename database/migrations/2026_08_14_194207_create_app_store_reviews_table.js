const { Schema } = require('../../helpers/migrator')

/**
 * Creates the table the posted reviews are tracked in.
 *
 * @param {Schema} schema - schema
 */
function up(schema) {
	schema.exec(`CREATE TABLE IF NOT EXISTS app_store_reviews (
		reviewID TEXT NOT NULL,
		storefront TEXT NOT NULL,
		postedAt TEXT NOT NULL,
		PRIMARY KEY (reviewID, storefront)
	)`)
}

module.exports = {
	up: up
}
