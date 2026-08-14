const axios = require('axios')
const { Client, EmbedBuilder, escapeMarkdown } = require('discord.js')
const allStorefronts = require('../resources/app_store_storefronts.json')

/** The host the reviews are read from. */
const feedHost = 'https://itunes.apple.com'

/** The app the reviews belong to. */
const appID = process.env['APP_STORE_APP_ID']

/** The server the reviews are posted in. */
const guildID = process.env['GUILD_ID']

/** The channel the reviews are posted in. */
const channelID = process.env['APP_STORE_REVIEWS_CHANNEL_ID']

/** The storefronts the reviews are read from. Every storefront is read when unset. */
const configuredStorefronts = (process.env['APP_STORE_STOREFRONTS'] ?? '')
	.split(',')
	.map(storefront => storefront.trim().toLowerCase())
	.filter(Boolean)

/** The storefronts the reviews are read from. */
const storefronts = configuredStorefronts.length ? configuredStorefronts : allStorefronts

/** The minutes between two reads of the storefronts that carry reviews. */
const pollMinutes = Number(process.env['APP_STORE_POLL_INTERVAL_MINUTES'] ?? 30)

/** The hours between two reads of every storefront. */
const discoveryHours = Number(process.env['APP_STORE_DISCOVERY_INTERVAL_HOURS'] ?? 6)

/** The newest reviews posted on the first run. Nothing is posted when unset. */
const backfillLimit = Number(process.env['APP_STORE_BACKFILL_LIMIT'] ?? 0)

/** The seconds a storefront read may take. */
const requestTimeout = 20

/** The characters a review title carries. */
const maxTitleLength = 256

/** The characters a review body carries. */
const maxBodyLength = 1024

/** The color a review is embedded with, by rating. */
const ratingColors = {
	1: 0xD0021B,
	2: 0xE8642F,
	3: 0xF5A623,
	4: 0x7ED321,
	5: 0x2ECC71
}

/** The offset a regional indicator symbol sits at. */
const regionalIndicatorOffset = 127397

class AppStoreManager {
	// MARK: - Properties
	/**
	 * @param {Client} client - client
	 */
	client

	/**
	 * @param {Database} db - db
	 */
	db

	/**
	 * @param {NodeJS.Timeout} pollTimer - poll timer
	 */
	pollTimer

	/**
	 * @param {NodeJS.Timeout} discoveryTimer - discovery timer
	 */
	discoveryTimer

	/**
	 * @param {boolean} isReading - is reading
	 */
	isReading = false

	/**
	 * @param {Promise<void>} prepared - prepared
	 */
	prepared

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Client} client - client
	 * @param {Database} db - db
	 */
	constructor(client, db) {
		this.client = client
		this.db = db
		this.prepared = this.prepare()
	}

	// MARK: - Functions
	/**
	 * Starts reading the storefronts on an interval.
	 *
	 * @returns {Promise<void>}
	 */
	async start() {
		if (!appID || !channelID) {
			console.log('App Store reviews are off. Set APP_STORE_APP_ID and APP_STORE_REVIEWS_CHANNEL_ID to turn them on.')
			return
		}

		await this.prepared

		if (!this.client.isReady()) {
			await new Promise(resolve => this.client.once('clientReady', resolve))
		}

		if (!await this.channel()) {
			return
		}

		if (await this.isFirstRun()) {
			await this.backfill()
		} else {
			await this.read(storefronts)
		}

		this.pollTimer = setInterval(() => {
			this.activeStorefronts()
				.then(active => this.read(active))
				.catch(error => console.error(error))
		}, pollMinutes * 60 * 1000)

		this.discoveryTimer = setInterval(() => {
			this.read(storefronts)
				.catch(error => console.error(error))
		}, discoveryHours * 60 * 60 * 1000)

		console.log(`📱 Reading App Store reviews from ${storefronts.length} storefronts every ${discoveryHours}h, and the ones that carry reviews every ${pollMinutes}m.`)
	}

	/** Stops reading the storefronts. */
	stop() {
		clearInterval(this.pollTimer)
		clearInterval(this.discoveryTimer)
		this.pollTimer = null
		this.discoveryTimer = null
	}

	/**
	 * The channel the reviews are posted in, or null when it is unusable.
	 *
	 * @returns {Promise<TextChannel|null>}
	 */
	async channel() {
		const channel = await this.client.channels.fetch(channelID)
			.catch(error => console.error(error))

		if (!channel) {
			console.error(`App Store reviews are off. The channel ${channelID} was not found.`)
			return null
		}

		if (channel.guild?.id !== guildID) {
			console.error(`App Store reviews are off. The channel ${channelID} is outside the server ${guildID}.`)
			return null
		}

		return channel
	}

	/**
	 * Creates the tables the posted reviews and read storefronts are tracked in.
	 *
	 * @returns {Promise<void>}
	 */
	async prepare() {
		await this.db.exec(`CREATE TABLE IF NOT EXISTS app_store_reviews (
			reviewID TEXT NOT NULL,
			storefront TEXT NOT NULL,
			postedAt TEXT NOT NULL,
			PRIMARY KEY (reviewID, storefront)
		)`)
		await this.db.exec(`CREATE TABLE IF NOT EXISTS app_store_storefronts (
			storefront TEXT PRIMARY KEY,
			readAt TEXT NOT NULL
		)`)
	}

	/**
	 * Whether no storefront has been read yet.
	 *
	 * @returns {Promise<boolean>}
	 */
	async isFirstRun() {
		const row = await this.db.get('SELECT 1 FROM app_store_storefronts LIMIT 1')
		return !row
	}

	/**
	 * Reads every storefront once, then posts as many of the newest reviews as
	 * the backfill limit allows.
	 *
	 * @returns {Promise<void>}
	 */
	async backfill() {
		if (this.isReading) {
			return
		}

		await this.prepared
		this.isReading = true

		try {
			const channel = await this.channel()

			if (!channel) {
				return
			}

			const found = []

			for (const storefront of storefronts) {
				const reviews = await this.reviews(storefront)
					.catch(error => {
						console.error(`Failed reading the ${storefront} storefront.`, error.message)
						return []
					})

				for (const review of reviews) {
					found.push({ review, storefront })
					await this.markPosted(review.id, storefront)
				}

				await this.markSeeded(storefront)
			}

			console.log(`📱 Seeded ${found.length} App Store reviews from ${storefronts.length} storefronts.`)

			if (!backfillLimit) {
				return
			}

			const newest = found
				.sort((first, second) => this.postedAt(first.review) - this.postedAt(second.review))
				.slice(-backfillLimit)

			for (const { review, storefront } of newest) {
				await channel.send({ embeds: [this.embed(review, storefront)] })
					.catch(error => console.error(error))
			}

			console.log(`📱 Posted the newest ${newest.length} reviews.`)
		} finally {
			this.isReading = false
		}
	}

	/**
	 * The moment a review was written.
	 *
	 * @param {Object} review - review
	 *
	 * @returns {number}
	 */
	postedAt(review) {
		return new Date(review.updatedAt ?? 0).getTime() || 0
	}

	/**
	 * The storefronts that have carried a review.
	 *
	 * @returns {Promise<string[]>}
	 */
	async activeStorefronts() {
		const rows = await this.db.all('SELECT DISTINCT storefront FROM app_store_reviews')
		return rows.map(row => row.storefront)
	}

	/**
	 * Reads the storefronts and posts the reviews that are new.
	 *
	 * @param {string[]} targets - targets
	 *
	 * @returns {Promise<void>}
	 */
	async read(targets) {
		if (this.isReading || !targets.length) {
			return
		}

		await this.prepared
		this.isReading = true

		try {
			const channel = await this.channel()

			if (!channel) {
				return
			}

			for (const storefront of targets) {
				await this.readStorefront(storefront, channel)
					.catch(error => console.error(`Failed reading the ${storefront} storefront.`, error.message))
			}
		} finally {
			this.isReading = false
		}
	}

	/**
	 * Reads a storefront and posts the reviews that are new.
	 *
	 * @param {string} storefront - storefront
	 * @param {TextChannel} channel - channel
	 *
	 * @returns {Promise<void>}
	 */
	async readStorefront(storefront, channel) {
		const reviews = await this.reviews(storefront)
		const isSeeded = await this.isSeeded(storefront)

		for (const review of reviews.reverse()) {
			if (await this.isPosted(review.id, storefront)) {
				continue
			}

			if (isSeeded) {
				await channel.send({ embeds: [this.embed(review, storefront)] })
					.catch(error => console.error(error))
			}

			await this.markPosted(review.id, storefront)
		}

		await this.markSeeded(storefront)
	}

	/**
	 * The reviews a storefront carries, newest first.
	 *
	 * @param {string} storefront - storefront
	 *
	 * @returns {Promise<Array>}
	 */
	async reviews(storefront) {
		const url = `${feedHost}/${storefront}/rss/customerreviews/id=${appID}/sortBy=mostRecent/json`
		const response = await axios.get(url, { timeout: requestTimeout * 1000 })
		const entries = response.data?.feed?.entry

		if (!entries) {
			return []
		}

		return (Array.isArray(entries) ? entries : [entries])
			.filter(entry => entry['im:rating'] && entry.id)
			.map(entry => ({
				id: entry.id.label,
				rating: Number(entry['im:rating'].label),
				version: entry['im:version']?.label,
				author: entry.author?.name?.label,
				title: entry.title?.label,
				body: entry.content?.label,
				updatedAt: entry.updated?.label
			}))
	}

	/**
	 * Whether a storefront has been read before.
	 *
	 * @param {string} storefront - storefront
	 *
	 * @returns {Promise<boolean>}
	 */
	async isSeeded(storefront) {
		const row = await this.db.get('SELECT 1 FROM app_store_storefronts WHERE storefront = ?', storefront)
		return !!row
	}

	/**
	 * Marks a storefront as read.
	 *
	 * @param {string} storefront - storefront
	 *
	 * @returns {Promise<void>}
	 */
	async markSeeded(storefront) {
		await this.db.run(
			'INSERT OR REPLACE INTO app_store_storefronts (storefront, readAt) VALUES (?, ?)',
			storefront,
			new Date().toISOString()
		)
	}

	/**
	 * Whether a review has been posted before.
	 *
	 * @param {string} reviewID - review id
	 * @param {string} storefront - storefront
	 *
	 * @returns {Promise<boolean>}
	 */
	async isPosted(reviewID, storefront) {
		const row = await this.db.get('SELECT 1 FROM app_store_reviews WHERE reviewID = ? AND storefront = ?', reviewID, storefront)
		return !!row
	}

	/**
	 * Marks a review as posted.
	 *
	 * @param {string} reviewID - review id
	 * @param {string} storefront - storefront
	 *
	 * @returns {Promise<void>}
	 */
	async markPosted(reviewID, storefront) {
		await this.db.run(
			'INSERT OR IGNORE INTO app_store_reviews (reviewID, storefront, postedAt) VALUES (?, ?, ?)',
			reviewID,
			storefront,
			new Date().toISOString()
		)
	}

	/**
	 * The embed a review is posted as.
	 *
	 * @param {Object} review - review
	 * @param {string} storefront - storefront
	 *
	 * @returns {EmbedBuilder}
	 */
	embed(review, storefront) {
		const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)
		const embed = new EmbedBuilder()
			.setColor(ratingColors[review.rating] ?? ratingColors[3])
			.setTitle(this.truncate(escapeMarkdown(review.title ?? 'Review'), maxTitleLength))
			.setURL(`https://apps.apple.com/${storefront}/app/id${appID}`)
			.setDescription(`${stars}\n\n${this.truncate(escapeMarkdown(review.body ?? ''), maxBodyLength)}`)
			.setFooter({ text: `${this.flag(storefront)} ${storefront.toUpperCase()}${review.version ? ` · v${review.version}` : ''}` })

		if (review.author) {
			embed.setAuthor({ name: this.truncate(escapeMarkdown(review.author), maxTitleLength) })
		}

		if (review.updatedAt) {
			embed.setTimestamp(new Date(review.updatedAt))
		}

		return embed
	}

	/**
	 * The flag a storefront is marked with.
	 *
	 * @param {string} storefront - storefront
	 *
	 * @returns {string}
	 */
	flag(storefront) {
		return storefront
			.toUpperCase()
			.replace(/./g, character => String.fromCodePoint(regionalIndicatorOffset + character.charCodeAt(0)))
	}

	/**
	 * The text cut to a length.
	 *
	 * @param {string} text - text
	 * @param {number} length - length
	 *
	 * @returns {string}
	 */
	truncate(text, length) {
		return text.length > length ? `${text.slice(0, length - 1)}…` : text
	}
}

module.exports = {
	AppStoreManager: AppStoreManager
}
