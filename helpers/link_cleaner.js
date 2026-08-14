const { spawn } = require('child_process')
const path = require('path')
const { Message, MessageFlags, PermissionsBitField } = require('discord.js')
const urlShorteners = require('../resources/url_shorteners.json')

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
	// MARK: - Functions
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

		const tracked = candidates.some(link => this.isShortenedLink(link) || this.hasTrackedParameters(link))
		const suppressing = tracked ? this.suppressEmbeds(message, true) : Promise.resolve()
		const cleaned = await Promise.all(candidates.map(link => this.cleanedLink(link)))
		const changed = cleaned.filter(Boolean)

		await suppressing

		if (!changed.length) {
			return tracked ? this.suppressEmbeds(message, false) : undefined
		}

		if (!tracked) {
			await this.suppressEmbeds(message, true)
		}

		const notice = `-# 🧹 Tracking removed from ${changed.length === 1 ? 'link' : 'links'}`

		return message.channel.send({
			content: `${changed.join('\n')}\n${notice}`,
			flags: MessageFlags.SuppressNotifications,
			allowedMentions: { parse: [] }
		}).catch(error => console.error(`[LinkCleaner] Couldn’t post the cleaned links: ${error.message}`))
	}

	/**
	 * Hides or restores the link previews on the given message.
	 *
	 * @param {Message} message - message
	 * @param {boolean} suppress - suppress
	 *
	 * @returns {Promise<void>}
	 */
	async suppressEmbeds(message, suppress) {
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
}

module.exports = {
	LinkCleaner: LinkCleaner
}
