const fs = require('fs')
const path = require('path')
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Interaction } = require('discord.js')
const appName = process.env['APP_NAME']
const appNickname = process.env['APP_NICKNAME']
const websiteURL = process.env['APP_URL']
const privacyPolicyURL = process.env['PRIVACY_POLICY_URL']
const termsOfUseURL = process.env['TERMS_OF_USE_URL']
const supportServerURL = process.env['SUPPORT_SERVER_URL']
const appColor = parseInt(process.env['APP_COLOR'].replace('#', ''), 16)
const privacyPolicyPath = path.join(__dirname, '../resources/privacy_policy.md')

/** The values the `{{placeholders}}` in the copy resolve to. */
const placeholders = {
	app: appName,
	bot: appNickname,
	website: websiteURL,
	privacyPolicyURL: privacyPolicyURL,
	termsOfUseURL: termsOfUseURL,
	supportServerURL: supportServerURL,
}

class LegalManager {
	// MARK: - Properties
	/**
	 * @type {ActionRowBuilder} legalButtons - legal buttons
	 */
	legalButtons = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setLabel('Privacy Policy')
				.setStyle(ButtonStyle.Link)
				.setURL(privacyPolicyURL),
			new ButtonBuilder()
				.setLabel('Terms of Use')
				.setStyle(ButtonStyle.Link)
				.setURL(termsOfUseURL),
			new ButtonBuilder()
				.setLabel('Ask for Support')
				.setStyle(ButtonStyle.Link)
				.setURL(supportServerURL),
		)

	/**
	 * @type {{description: string, fields: {name: string, value: string}[]}} document - the privacy copy
	 */
	document

	// MARK: - Initializers
	/**
	 * @constructor
	 */
	constructor() {
		try {
			this.document = readPrivacyPolicy()
		} catch (error) {
			console.error(`[legal] could not read ${privacyPolicyPath}: ${error.message}`)
			this.document = {
				description: `Read the [${appName} Privacy Policy](${privacyPolicyURL}).`,
				fields: []
			}
		}
	}

	// MARK: - Functions
	/**
	 * Share the privacy policy along with a summary of the data the bot handles.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async privacyPolicy(interaction) {
		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle('Privacy Policy')
			.setURL(privacyPolicyURL)
			.setDescription(this.document.description)
			.addFields(this.document.fields)
			.setTimestamp()

		return interaction.reply({
			embeds: [embed],
			components: [this.legalButtons]
		}).catch(error => console.error(error))
	}
}

// MARK: - Functions
/**
 * Reads the privacy copy, filling in the placeholders.
 *
 * The text before the first `##` heading becomes the embed description, and
 * every heading after it becomes a field.
 *
 * @returns {{description: string, fields: {name: string, value: string}[]}}
 */
function readPrivacyPolicy() {
	const markdown = fs.readFileSync(privacyPolicyPath, 'utf8')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/{{(\w+)}}/g, (match, key) => placeholders[key] ?? match)
	const [description, ...sections] = markdown.split(/^## /m)

	return {
		description: description.trim(),
		fields: sections.map(section => {
			const [name, ...body] = section.split('\n')
			return {
				name: name.trim(),
				value: body.join('\n').trim()
			}
		})
	}
}

module.exports = {
	LegalManager: LegalManager
}
