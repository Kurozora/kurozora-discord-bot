const fs = require('fs')
const { spawn } = require('child_process')
const path = require('path')
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Interaction, Message, MessageFlags, PermissionsBitField } = require('discord.js')
const { Database } = require('./database')
const urlShorteners = require('../resources/url_shorteners.json')

/** The color a report is embedded with. */
const appColor = parseInt(process.env['APP_COLOR'].replace('#', ''), 16)

/** The user an unrecognized control is reported to. */
const ownerID = process.env['OWNER_ID']

/** The interpreter the cleaner scripts run under. */
const interpreter = path.join(__dirname, '..', 'python', '.venv', 'bin', 'python')

/** The script stripping tracking parameters off a url. */
const cleanScript = path.join(__dirname, '..', 'python', 'CleanUrlTracking.py')

/** The script unshortening a url before stripping its tracking parameters. */
const unshortScript = path.join(__dirname, '..', 'python', 'UnshortAndCleanUrlTracking.py')

/** The number of links cleaned per message. */
const maxLinks = 5

/** The duration a cleaner script has to answer. */
const cleanTimeout = 10000

/** The links left untouched. */
const skippedLink = /^https?:\/\/cdn\.discordapp\.com\b/i

/** The links cleaned further by Twitter’s rules. */
const twitterLink = /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|t\.co)\b/i

/** The links cleaned further by YouTube’s rules. */
const youtubeLink = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\b/i

/** The links found in a message. */
const linkPattern = /https?:\/\/\S+/g

/** The query parameters marking a link as tracked. */
const trackingParameters = new Set([
	'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid',
	'ttclid', 'igshid', 'igsh', 'mc_cid', 'mc_eid', 'mkt_tok', 'epik', 'li_fat_id',
	's_kwcid', 'vero_id', 'oly_enc_id', 'oly_anon_id', '_hsenc', '_hsmi', '_ga',
	'ref_src', 'ref_url', 'spm', 'scm', 'ck_subscriber_id'
])

/** The query parameters tracking a link on a particular host. */
const hostTrackingParameters = [
	{ host: twitterLink, parameters: ['t', 's'] },
	{ host: youtubeLink, parameters: ['si'] }
]

/** The prefix on every link cleaner control’s custom id. */
const componentPrefix = 'linkcleaner_'

/**
 * The given url, parsed.
 *
 * @param {string} url - url
 *
 * @returns {?URL} url - url
 */
function parsed(url) {
	try {
		return new URL(url)
	} catch {
		return null
	}
}

class LinkCleaner {
	// MARK: - Properties
	/**
	 * @param {Database} db - db
	 */
	db

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Database} db - db
	 */
	constructor(db) {
		this.db = db
	}

	// MARK: - Functions
	/**
	 * Starts cleaning the links posted in every server it is turned on in.
	 *
	 * @returns {Promise<void>}
	 */
	async start() {
		if (!this.isInstalled()) {
			console.log('🧹 Link cleaning is off. Run ./install.sh to turn it on.')
			return
		}

		const configured = this.db.get('SELECT COUNT(*) AS servers FROM link_cleaner_settings WHERE isEnabled = 1')

		console.log(`🧹 Cleaning the links posted in ${configured.servers} servers. Run /linkcleaner on to add one.`)
	}

	/**
	 * Whether the interpreter the cleaner scripts run under is installed.
	 *
	 * @returns {boolean} isInstalled - is installed
	 */
	isInstalled() {
		return fs.existsSync(interpreter)
	}

	// MARK: - Settings
	/**
	 * A server’s link cleaning, or null when it has none.
	 *
	 * @param {?string} guildID - guild id
	 *
	 * @returns {?Object} config - config
	 */
	config(guildID) {
		return this.db.get('SELECT * FROM link_cleaner_settings WHERE guildID = ?', guildID) ?? null
	}

	/**
	 * Turns a server’s link cleaning on.
	 *
	 * @param {string} guildID - guild id
	 *
	 * @returns {Object} config - config
	 */
	enable(guildID) {
		this.db.run(`INSERT INTO link_cleaner_settings (guildID, isEnabled, configuredAt)
			VALUES (?, 1, ?)
			ON CONFLICT (guildID) DO UPDATE SET isEnabled = 1`,
		guildID,
		new Date().toISOString())

		return this.config(guildID)
	}

	/**
	 * Turns a server’s link cleaning off.
	 *
	 * @param {string} guildID - guild id
	 */
	disable(guildID) {
		this.db.run('UPDATE link_cleaner_settings SET isEnabled = 0 WHERE guildID = ?', guildID)
	}

	// MARK: - Cleaning
	/**
	 * Posts cleaned copies of the links the given message holds.
	 *
	 * @param {Message} message - message
	 *
	 * @returns {Promise<*>}
	 */
	async clean(message) {
		const links = this.linksIn(message.content)

		if (!links.length) {
			return
		}

		const candidates = links.filter(link => this.isShortenedLink(link) || this.containsParameters(link))

		if (!candidates.length) {
			return
		}

		const config = this.config(message.guildId)

		if (!config?.isEnabled) {
			return
		}

		const tracked = candidates.some(link => this.isShortenedLink(link) || this.hasTrackedParameters(link))
		const suppressing = tracked ? this.suppressEmbeds(message, config, true) : Promise.resolve()
		const cleaned = await Promise.all(candidates.map(link => this.cleanedLink(link)))
		const changed = cleaned.filter(Boolean)

		await suppressing

		if (!changed.length) {
			return tracked ? this.suppressEmbeds(message, config, false) : undefined
		}

		if (!tracked) {
			await this.suppressEmbeds(message, config, true)
		}

		this.record(config, changed.length)

		const notice = `-# 🧹 Tracking removed from ${changed.length === 1 ? 'link' : 'links'}`

		return message.channel.send({
			content: `${changed.join('\n')}\n${notice}`,
			flags: MessageFlags.SuppressNotifications,
			allowedMentions: { parse: [] }
		}).catch(error => console.error(`[LinkCleaner] Couldn’t post the cleaned links: ${error.message}`))
	}

	/**
	 * Counts the links a server had cleaned.
	 *
	 * @param {Object} config - config
	 * @param {number} links - links
	 */
	record(config, links) {
		this.db.run('UPDATE link_cleaner_settings SET cleanedLinks = cleanedLinks + ?, cleanedAt = ? WHERE guildID = ?',
			links,
			new Date().toISOString(),
			config.guildID)
	}

	/**
	 * Hides or restores the link previews on the given message.
	 *
	 * @param {Message} message - message
	 * @param {Object} config - config
	 * @param {boolean} suppress - suppress
	 *
	 * @returns {Promise<void>}
	 */
	async suppressEmbeds(message, config, suppress) {
		if (!config.hidesPreviews) {
			return
		}

		if (!message.guild?.members?.me?.permissionsIn(message.channel).has(PermissionsBitField.Flags.ManageMessages)) {
			return
		}

		await message.suppressEmbeds(suppress)
			.catch(error => console.error(`[LinkCleaner] Couldn’t ${suppress ? 'hide' : 'restore'} the previews: ${error.message}`))
	}

	/**
	 * The links the given text holds, less the ones inside code or angle brackets.
	 *
	 * @param {string} text - text
	 *
	 * @returns {string[]} links - links
	 */
	linksIn(text) {
		const sanitized = (text ?? '')
			.replace(/```[\s\S]*?```/g, '')
			.replace(/`[^`]*`/g, '')
			.replace(/<https?:\/\/[^>]+>/g, '')

		const links = [...sanitized.matchAll(linkPattern)].map(match => match[0].trim())

		return [...new Set(links)]
			.filter(link => parsed(link))
			.slice(0, maxLinks)
	}

	/**
	 * The given link, cleaned, or nothing when it is already clean.
	 *
	 * @param {string} link - link
	 *
	 * @returns {Promise<?string>} link - link
	 */
	async cleanedLink(link) {
		const isShortened = this.isShortenedLink(link)

		if (!isShortened && !this.containsParameters(link)) {
			return null
		}

		const cleaned = await this.cleanUrlTracking(link, isShortened)

		if (!cleaned || skippedLink.test(cleaned)) {
			return null
		}

		let result = cleaned

		if (twitterLink.test(result)) {
			result = this.cleanTwitterLink(result)
		} else if (youtubeLink.test(result)) {
			result = this.cleanYouTubeLink(result)
		}

		const original = link.toLowerCase()

		if (original === result.toLowerCase() || original === this.safeDecode(result).toLowerCase()) {
			return null
		}

		return result
	}

	/**
	 * The given url, stripped of its tracking parameters.
	 *
	 * Unshortens the url first when `unshort` is set.
	 *
	 * @param {string} url - url
	 * @param {boolean} unshort - unshort
	 *
	 * @returns {Promise<?string>} url - url
	 */
	async cleanUrlTracking(url, unshort = false) {
		return new Promise(resolve => {
			const cleaner = spawn(interpreter, [unshort ? unshortScript : cleanScript, url])
			const output = []
			const errors = []
			let settled = false

			const finish = value => {
				if (settled) {
					return
				}

				settled = true
				clearTimeout(timer)
				cleaner.kill('SIGKILL')
				resolve(value)
			}

			const timer = setTimeout(() => {
				console.error(`[LinkCleaner] Timed out cleaning ${url}`)
				finish(null)
			}, cleanTimeout)

			cleaner.stdout.on('data', chunk => output.push(chunk))
			cleaner.stderr.on('data', chunk => errors.push(chunk))

			cleaner.on('error', error => {
				console.error(`[LinkCleaner] Couldn’t run ${interpreter}: ${error.message}`)
				finish(null)
			})

			cleaner.on('close', code => {
				if (code !== 0) {
					console.error(`[LinkCleaner] Cleaning ${url} exited with ${code}: ${Buffer.concat(errors).toString().trim()}`)
					return finish(null)
				}

				finish(Buffer.concat(output).toString().trim() || null)
			})
		})
	}

	/**
	 * Whether the given url carries query parameters.
	 *
	 * @param {string} url - url
	 *
	 * @returns {boolean} containsParameters - contains parameters
	 */
	containsParameters(url) {
		return Boolean(parsed(url)?.searchParams.toString().length)
	}

	/**
	 * Whether the given url carries a known tracking parameter.
	 *
	 * @param {string} url - url
	 *
	 * @returns {boolean} hasTrackedParameters - has tracked parameters
	 */
	hasTrackedParameters(url) {
		const parsedURL = parsed(url)

		if (!parsedURL) {
			return false
		}

		for (const key of parsedURL.searchParams.keys()) {
			const parameter = key.toLowerCase()

			if (parameter.startsWith('utm_') || trackingParameters.has(parameter)) {
				return true
			}
		}

		return hostTrackingParameters.some(({ host, parameters }) =>
			host.test(url) && parameters.some(parameter => parsedURL.searchParams.has(parameter)))
	}

	/**
	 * Whether the given url points at a link shortener.
	 *
	 * @param {string} url - url
	 *
	 * @returns {boolean} isShortenedLink - is shortened link
	 */
	isShortenedLink(url) {
		const hostname = parsed(url)?.hostname.toLowerCase()

		if (!hostname) {
			return false
		}

		return urlShorteners.domains.some(domain => {
			const shortener = domain.toLowerCase()
			return hostname === shortener || hostname.endsWith(`.${shortener}`)
		})
	}

	/**
	 * The given url, decoded, or unchanged when it cannot be decoded.
	 *
	 * @param {string} url - url
	 *
	 * @returns {string} url - url
	 */
	safeDecode(url) {
		try {
			return decodeURIComponent(url)
		} catch {
			return url
		}
	}

	/**
	 * The given Twitter url, stripped of its share parameters.
	 *
	 * @param {string} link - link
	 *
	 * @returns {string} link - link
	 */
	cleanTwitterLink(link) {
		const url = parsed(link)

		if (!url) {
			return link
		}

		url.searchParams.delete('t')
		url.searchParams.delete('s')

		return url.href
	}

	/**
	 * The given YouTube url, stripped of its share parameters.
	 *
	 * @param {string} link - link
	 *
	 * @returns {string} link - link
	 */
	cleanYouTubeLink(link) {
		const url = parsed(link)

		if (!url) {
			return link
		}

		url.searchParams.delete('si')

		return url.href
	}

	// MARK: - Commands
	/**
	 * Handles the selected subcommand.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async handle(interaction) {
		if (!interaction.inGuild()) {
			return interaction.reply({
				content: 'Link cleaning is set up per server.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		switch (interaction.options.getSubcommand()) {
			case 'on': {
				return this.turnOn(interaction)
			}
			case 'off': {
				return this.turnOff(interaction)
			}
			case 'test': {
				return this.test(interaction)
			}
			default: {
				return this.report(interaction)
			}
		}
	}

	/**
	 * Turns a server’s link cleaning on, and reports it.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async turnOn(interaction) {
		if (!this.isInstalled()) {
			return this.reportMissingInterpreter(interaction)
		}

		const config = this.enable(interaction.guildId)

		return interaction.reply({
			content: 'Tracked links are answered with a clean copy.',
			...this.payload(config),
			flags: MessageFlags.Ephemeral
		}).catch(error => console.error(error))
	}

	/**
	 * Turns a server’s link cleaning off, and reports it.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async turnOff(interaction) {
		const config = this.config(interaction.guildId)

		if (!config?.isEnabled) {
			return interaction.reply({
				content: 'Links are already left alone.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		this.disable(interaction.guildId)

		return interaction.reply({
			content: 'Links are left alone.',
			...this.payload(this.config(interaction.guildId)),
			flags: MessageFlags.Ephemeral
		}).catch(error => console.error(error))
	}

	/**
	 * Reports a server’s link cleaning.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async report(interaction) {
		const config = this.config(interaction.guildId)

		if (!config) {
			return interaction.reply({
				content: 'Links aren’t cleaned here. Run `/linkcleaner on` to have every tracked link answered with a clean copy.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		return interaction.reply({
			...this.payload(config),
			flags: MessageFlags.Ephemeral
		}).catch(error => console.error(error))
	}

	/**
	 * Reports what a link is cleaned down to, without posting it.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async test(interaction) {
		if (!this.isInstalled()) {
			return this.reportMissingInterpreter(interaction)
		}

		const link = interaction.options.getString('link').trim()

		if (!parsed(link)) {
			return interaction.reply({
				content: 'That isn’t a link.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })

		const cleaned = await this.cleanedLink(link)

		return interaction.editReply({
			content: cleaned ? `That link is posted as:\n${cleaned}` : 'That link carries no tracking, and is left alone.',
			allowedMentions: { parse: [] }
		}).catch(error => console.error(error))
	}

	/**
	 * Reports that the interpreter the cleaner scripts run under is missing.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async reportMissingInterpreter(interaction) {
		return interaction.reply({
			content: 'Links can’t be cleaned until `./install.sh` is run on this instance.',
			flags: MessageFlags.Ephemeral
		}).catch(error => console.error(error))
	}

	/**
	 * A server’s link cleaning, and the controls it is changed with.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {Object} payload - payload
	 */
	payload(config) {
		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle('Link Cleaner')
			.addFields({
				name: 'State',
				value: config.isEnabled ? 'On' : 'Off',
				inline: true
			}, {
				name: 'Previews',
				value: config.hidesPreviews ? 'Hidden on the tracked message' : 'Left as they are',
				inline: true
			}, {
				name: 'Links cleaned',
				value: `${config.cleanedLinks}`,
				inline: true
			}, {
				name: 'Last cleaned',
				value: config.cleanedAt ? `<t:${Math.floor(new Date(config.cleanedAt).getTime() / 1000)}:R>` : 'Never',
				inline: true
			})
			.setFooter({ text: [
				`Up to ${maxLinks} links per message`,
				'Shortened links are followed first'
			].join(' · ') })

		if (!this.isInstalled()) {
			embed.addFields({
				name: 'Cleaner',
				value: 'Not installed — nothing is cleaned until `./install.sh` is run on this instance.'
			})
		}

		return { embeds: [embed], components: [this.controls(config)] }
	}

	/**
	 * The controls a server’s link cleaning is changed with.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {ActionRowBuilder} controls - controls
	 */
	controls(config) {
		return new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}toggle`)
				.setLabel(config.isEnabled ? 'Turn off' : 'Turn on')
				.setStyle(config.isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}previews`)
				.setLabel(config.hidesPreviews ? 'Keep previews' : 'Hide previews')
				.setStyle(ButtonStyle.Secondary)
		)
	}

	// MARK: - Controls
	/**
	 * Handles the selected control.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async handleComponent(interaction) {
		const config = this.config(interaction.guildId)

		if (!config) {
			return interaction.reply({
				content: 'Links aren’t cleaned here. Run `/linkcleaner on` to turn it on.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		switch (interaction.customId.slice(componentPrefix.length)) {
			case 'toggle': {
				this.db.run('UPDATE link_cleaner_settings SET isEnabled = ? WHERE guildID = ?', config.isEnabled ? 0 : 1, config.guildID)
				break
			}
			case 'previews': {
				this.db.run('UPDATE link_cleaner_settings SET hidesPreviews = ? WHERE guildID = ?', config.hidesPreviews ? 0 : 1, config.guildID)
				break
			}
			default: {
				return interaction.reply({
					content: `This control is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
					flags: MessageFlags.Ephemeral
				}).catch(error => console.error(error))
			}
		}

		return this.refresh(interaction)
	}

	/**
	 * Writes the report the control was pressed on again.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async refresh(interaction) {
		await interaction.deferUpdate()
			.catch(error => console.error(error))

		return interaction.editReply(this.payload(this.config(interaction.guildId)))
			.catch(error => console.error(error))
	}
}

module.exports = {
	LinkCleaner: LinkCleaner,
	linkCleanerComponentPrefix: componentPrefix
}
