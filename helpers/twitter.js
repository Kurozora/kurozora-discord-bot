const axios = require('axios')
const ffmpeg = require('ffmpeg-static')
const youtubeDL = require('youtube-dl-exec')
const { spawn } = require('child_process')
const { AttachmentBuilder, Guild, GuildPremiumTier, Interaction, Message, MessageFlags } = require('discord.js')

/** The hosts a post is linked by. */
const postHosts = new Set([
	'twitter.com',
	'x.com',
	'fxtwitter.com',
	'fixupx.com',
	'vxtwitter.com',
	'fixvx.com',
	'twittpr.com'
])

/** The subdomains a post link carries. */
const postSubdomain = /^(?:www|mobile|m)\./i

/** The path a post is found at. */
const postPath = /^\/(?<handle>[A-Za-z0-9_]{1,15})\/status(?:es)?\/(?<id>\d+)/

/** The links found in a message. */
const linkPattern = /https?:\/\/\S+/g

/** The cookies a lookup authenticates with. */
const cookiesFile = process.env['X_COOKIES_FILE']

/** The flags every yt-dlp lookup runs with. */
const youtubeDLFlags = {
	dumpSingleJson: true,
	noWarnings: true,
	noProgress: true,
	...(cookiesFile ? { cookies: cookiesFile } : {})
}

/** The bytes a message may carry, by the server’s boost level. */
const uploadLimits = {
	[GuildPremiumTier.None]: 10 * 1024 * 1024,
	[GuildPremiumTier.Tier1]: 10 * 1024 * 1024,
	[GuildPremiumTier.Tier2]: 50 * 1024 * 1024,
	[GuildPremiumTier.Tier3]: 100 * 1024 * 1024
}

/** The bytes held back from the upload limit. */
const uploadReserve = 64 * 1024

/** The videos posted per post. */
const maxVideos = 4

/** The path a post’s GIF is served from. */
const gifPath = '/tweet_video/'

/** The scale and frame rate a GIF is converted at, highest quality first. */
const gifQualities = [
	{ scale: 1, fps: null },
	{ scale: 0.75, fps: 20 },
	{ scale: 0.5, fps: 15 },
	{ scale: 0.35, fps: 12 }
]

/** The duration a conversion has to finish. */
const conversionTimeout = 60000

/** The uploads attempted per post. */
const maxUploadAttempts = 2

/** The duration a lookup has to answer. */
const lookupTimeout = 20000

/** The duration a download has to finish. */
const downloadTimeout = 180000

/** The age a post is blurred from. */
const spoilerAge = 18

/** The replies given for the errors a lookup reports. */
const lookupReplies = [
	{ error: /no video could be found|there.?s no video/i, reply: 'That post doesn’t hold a video.' },
	{ error: /nsfw|age.?restricted|sensitive/i, reply: 'That post is age restricted, so X only serves it to a signed-in account.' },
	{ error: /log ?in|login|authenticat|not authorized|protected/i, reply: 'That post is only visible to a signed-in account.' },
	{ error: /unavailable|not found|suspended|does ?n.?t exist|404/i, reply: 'That post is gone, or the account is suspended.' },
	{ error: /rate.?limit|429|too many requests/i, reply: 'X is rate limiting the lookups. Try again in a minute.' }
]

/** The reply given when no other reply applies. */
const lookupFallbackReply = 'Couldn’t read that post. Try again in a moment.'

/**
 * The given link as a post link, or nothing when it doesn’t point at a post.
 *
 * @param {string} link - link
 *
 * @returns {?string} link - link
 */
function canonical(link) {
	let url

	try {
		url = new URL(link)
	} catch {
		return null
	}

	if (!postHosts.has(url.hostname.toLowerCase().replace(postSubdomain, ''))) {
		return null
	}

	const post = postPath.exec(url.pathname)

	return post ? `https://x.com/${post.groups.handle}/status/${post.groups.id}` : null
}

/**
 * The bytes the given guild accepts per message.
 *
 * @param {?Guild} guild - guild
 *
 * @returns {number} limit - limit
 */
function uploadLimit(guild) {
	const limit = uploadLimits[guild?.premiumTier] ?? uploadLimits[GuildPremiumTier.None]
	return limit - uploadReserve
}

/**
 * The given video’s formats, highest quality first.
 *
 * @param {Object} video - video
 *
 * @returns {Object[]} formats - formats
 */
function qualities(video) {
	return (video?.formats ?? [])
		.filter(format => format.url && format.protocol === 'https' && format.ext === 'mp4')
		.sort((first, second) => (second.height ?? 0) - (first.height ?? 0) || (second.tbr ?? 0) - (first.tbr ?? 0))
}

/**
 * The bytes the given format weighs, or nothing when unknown.
 *
 * @param {Object} format - format
 *
 * @returns {Promise<?number>} weight - weight
 */
async function weight(format) {
	if (format.filesize) {
		return format.filesize
	}

	const response = await axios.head(format.url, {
		headers: format.http_headers,
		timeout: lookupTimeout
	}).catch(error => {
		console.error(`[X] Couldn’t weigh ${format.format_id}: ${error.message}`)
		return null
	})

	const length = Number(response?.headers['content-length'])

	return Number.isFinite(length) && length > 0 ? length : format.filesize_approx ?? null
}

/**
 * The given format, downloaded, or nothing when it outgrows `budget`.
 *
 * @param {Object} format - format
 * @param {number} budget - budget
 *
 * @returns {Promise<?Buffer>} video - video
 */
async function download(format, budget) {
	const response = await axios.get(format.url, {
		headers: format.http_headers,
		timeout: downloadTimeout,
		responseType: 'arraybuffer',
		maxContentLength: budget,
		maxBodyLength: budget
	}).catch(error => {
		console.error(`[X] Couldn’t download ${format.format_id}: ${error.message}`)
		return null
	})

	return response ? Buffer.from(response.data) : null
}

/**
 * Whether the given format holds a GIF.
 *
 * @param {Object} format - format
 *
 * @returns {boolean} isAnimation - is animation
 */
function isAnimation(format) {
	return format.url.includes(gifPath)
}

/**
 * The filters converting a video to a GIF at the given quality.
 *
 * @param {Object} quality - quality
 *
 * @returns {string} filters - filters
 */
function gifFilters({ scale, fps }) {
	const steps = [
		fps ? `fps='min(source_fps,${fps})'` : null,
		scale < 1 ? `scale='trunc(iw*${scale})':-1:flags=lanczos` : null,
		'split[a][b]'
	].filter(Boolean)

	return `${steps.join(',')};[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`
}

/**
 * The given video as a GIF, or nothing when it outgrows `budget`.
 *
 * @param {Buffer} video - video
 * @param {Object} quality - quality
 * @param {number} budget - budget
 *
 * @returns {Promise<?Buffer>} gif - gif
 */
async function convert(video, quality, budget) {
	return new Promise(resolve => {
		const converter = spawn(ffmpeg, [
			'-hide_banner',
			'-loglevel', 'error',
			'-i', 'pipe:0',
			'-filter_complex', gifFilters(quality),
			'-loop', '0',
			'-f', 'gif',
			'pipe:1'
		])
		const output = []
		const errors = []
		let size = 0
		let settled = false

		const finish = value => {
			if (settled) {
				return
			}

			settled = true
			clearTimeout(timer)
			converter.kill('SIGKILL')
			resolve(value)
		}

		const timer = setTimeout(() => {
			console.error(`[X] Timed out converting a GIF at scale ${quality.scale}`)
			finish(null)
		}, conversionTimeout)

		converter.stdout.on('data', chunk => {
			size += chunk.length

			if (size > budget) {
				return finish(null)
			}

			output.push(chunk)
		})

		converter.stderr.on('data', chunk => errors.push(chunk))

		converter.on('error', error => {
			console.error(`[X] Couldn’t run ${ffmpeg}: ${error.message}`)
			finish(null)
		})

		converter.on('close', code => {
			if (settled) {
				return
			}

			if (code !== 0) {
				console.error(`[X] Converting a GIF exited with ${code}: ${Buffer.concat(errors).toString().trim()}`)
				return finish(null)
			}

			finish(Buffer.concat(output))
		})

		converter.stdin.on('error', () => {})
		converter.stdin.end(video)
	})
}

/**
 * The given size, in kilobytes or megabytes.
 *
 * @param {number} bytes - bytes
 *
 * @returns {string} size - size
 */
function formatted(bytes) {
	const megabytes = bytes / (1024 * 1024)
	return megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * The reply given for the given lookup error.
 *
 * @param {string} error - error
 *
 * @returns {string} reply - reply
 */
function replyFor(error) {
	return lookupReplies.find(({ error: pattern }) => pattern.test(error))?.reply ?? lookupFallbackReply
}

class TwitterManager {
	// MARK: - Functions
	/**
	 * Posts the video the given link points at.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} link - link
	 *
	 * @returns {Promise<*>}
	 */
	async post(interaction, link) {
		const url = canonical(link)

		if (!url) {
			return interaction.reply({
				content: 'That’s not a post link. It should look like `https://x.com/user/status/1234567890`.',
				flags: MessageFlags.Ephemeral
			})
		}

		await interaction.deferReply()

		return this.#reply(interaction, url)
	}

	/**
	 * Posts the video the first post link in the given message points at.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {Message} message - message
	 *
	 * @returns {Promise<*>}
	 */
	async postFrom(interaction, message) {
		const url = ((message.content ?? '').match(linkPattern) ?? [])
			.map(link => canonical(link))
			.find(Boolean)

		if (!url) {
			return interaction.reply({
				content: 'That message doesn’t hold a Twitter/X post link.',
				flags: MessageFlags.Ephemeral
			})
		}

		await interaction.deferReply()

		return this.#reply(interaction, url)
	}

	/**
	 * Replies to the given interaction with the videos the given post holds.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} url - url
	 *
	 * @returns {Promise<*>}
	 */
	async #reply(interaction, url) {
		const { post, error } = await this.#lookup(url)

		if (error) {
			return this.#fail(interaction, error)
		}

		const videos = (post._type === 'playlist' ? post.entries ?? [] : [post])
			.filter(video => qualities(video).length)
			.slice(0, maxVideos)

		if (!videos.length) {
			return this.#fail(interaction, 'That post doesn’t hold a video.')
		}

		let budget = uploadLimit(interaction.guild)

		for (let attempt = 1; attempt <= maxUploadAttempts; attempt++) {
			const uploads = await this.#uploads(post, videos, budget)

			if (!uploads.length) {
				return this.#linked(interaction, post, url, videos)
			}

			try {
				return await interaction.editReply({
					content: this.#credit(post, url, uploads, videos.length),
					files: uploads.map(upload => upload.attachment),
					flags: MessageFlags.SuppressEmbeds,
					allowedMentions: { parse: [] }
				})
			} catch (uploadError) {
				if (uploadError.code !== 40005 || attempt === maxUploadAttempts) {
					console.error(`[X] Couldn’t post ${url}: ${uploadError.message}`)
					return this.#fail(interaction, 'The video couldn’t be posted here.')
				}

				budget = Math.floor(budget / 2)
			}
		}
	}

	/**
	 * The given post, looked up, or the reply given when the lookup fails.
	 *
	 * @param {string} url - url
	 *
	 * @returns {Promise<{post: ?Object, error: ?string}>} post - post
	 */
	async #lookup(url) {
		const post = await youtubeDL(url, youtubeDLFlags, { timeout: lookupTimeout })
			.catch(error => error)

		if (post instanceof Error) {
			const reported = (post.stderr ?? '')
				.split('\n')
				.find(line => line.startsWith('ERROR:')) ?? post.message

			console.error(`[X] Couldn’t look up ${url}: ${reported}`)

			return { post: null, error: replyFor(reported) }
		}

		return { post: post, error: null }
	}

	/**
	 * The given videos, downloaded at the highest quality `budget` holds.
	 *
	 * @param {Object} post - post
	 * @param {Object[]} videos - videos
	 * @param {number} budget - budget
	 *
	 * @returns {Promise<Object[]>} uploads - uploads
	 */
	async #uploads(post, videos, budget) {
		const spoiler = (post.age_limit ?? 0) >= spoilerAge
		const uploads = []
		let remaining = budget

		for (const video of videos) {
			const format = await this.#quality(video, remaining)

			if (!format) {
				continue
			}

			const data = await download(format, remaining)

			if (!data?.length) {
				continue
			}

			const animation = isAnimation(format)
			const gif = animation ? await this.#gif(data, remaining) : null
			const media = gif ?? data

			uploads.push({
				attachment: new AttachmentBuilder(media, { name: `${spoiler ? 'SPOILER_' : ''}${video.id}.${gif ? 'gif' : 'mp4'}` }),
				format: format,
				size: media.length,
				animation: animation,
				gif: Boolean(gif)
			})

			remaining -= media.length
		}

		return uploads
	}

	/**
	 * The given video as a GIF at the highest quality fitting in `budget`.
	 *
	 * @param {Buffer} video - video
	 * @param {number} budget - budget
	 *
	 * @returns {Promise<?Buffer>} gif - gif
	 */
	async #gif(video, budget) {
		for (const quality of gifQualities) {
			const gif = await convert(video, quality, budget)

			if (gif?.length) {
				return gif
			}
		}

		return null
	}

	/**
	 * The given video’s highest quality format fitting in `budget`.
	 *
	 * @param {Object} video - video
	 * @param {number} budget - budget
	 *
	 * @returns {Promise<?Object>} format - format
	 */
	async #quality(video, budget) {
		for (const format of qualities(video)) {
			const size = await weight(format)

			if (size !== null && size <= budget) {
				return format
			}
		}

		return null
	}

	/**
	 * Replies to the given interaction with the post’s video link.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {Object} post - post
	 * @param {string} url - url
	 * @param {Object[]} videos - videos
	 *
	 * @returns {Promise<*>}
	 */
	async #linked(interaction, post, url, videos) {
		const format = qualities(videos[0])[0]
		const limit = formatted(uploadLimit(interaction.guild))

		return interaction.editReply({
			content: `${format.url}\n-# 🎬 by [${post.uploader_id}](<${url}>) · posted as a link, this server accepts up to ${limit}`,
			allowedMentions: { parse: [] }
		})
	}

	/**
	 * Replies to the given interaction with the given failure, privately.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} message - message
	 *
	 * @returns {Promise<*>}
	 */
	async #fail(interaction, message) {
		await interaction.deleteReply()
			.catch(error => console.error(error))

		return interaction.followUp({
			content: message,
			flags: MessageFlags.Ephemeral
		})
	}

	/**
	 * The credit line posted under the given uploads.
	 *
	 * @param {Object} post - post
	 * @param {string} url - url
	 * @param {Object[]} uploads - uploads
	 * @param {number} count - count
	 *
	 * @returns {string} credit - credit
	 */
	#credit(post, url, uploads, count) {
		const size = uploads.reduce((total, upload) => total + upload.size, 0)
		const quality = uploads.length === 1
			? uploads[0].gif ? 'GIF' : uploads[0].format.height ? `${uploads[0].format.height}p` : uploads[0].format.resolution
			: `${uploads.length} ${uploads.every(upload => upload.gif) ? 'GIFs' : 'videos'}`
		const parts = [`[${post.uploader_id}](<${url}>)`, quality, formatted(size)]

		if (uploads.some(upload => upload.animation && !upload.gif)) {
			parts.push('too large as a GIF, posted as video')
		}

		if (count > uploads.length) {
			parts.push(`${count - uploads.length} left out, too large`)
		}

		return `-# 🎬 ${parts.filter(Boolean).join(' · ')}`
	}
}

module.exports = {
	TwitterManager: TwitterManager
}
