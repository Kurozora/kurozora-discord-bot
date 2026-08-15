const axios = require('axios')
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, Interaction, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js')
const { REST } = require('@discordjs/rest')
const appNickname = process.env['APP_NICKNAME']
const appURL = process.env['APP_URL']
const nekosBestAPIURL = process.env['NEKOS_BEST_API_URL']
const otakuGifsAPIURL = process.env['OTAKU_GIFS_API_URL']

/** The user agent sent with every provider request. */
const userAgent = `${appNickname} (${appURL})`

/** The duration a provider has to respond. */
const requestTimeout = 5000

/** The number of GIFs shown per picker page. */
const pickerSize = 10

/** The number of GIFs requested per fetch. */
const fetchSize = 20

/** The number of requests issued at once. */
const maxParallelRequests = 10

/** The number of buttons Discord accepts per action row. */
const maxButtonsPerRow = 5

/** The prefix on every picker button’s custom id. */
const buttonPrefix = 'gif_'

/** The duration a picker accepts input. */
const pickerTimeout = 2 * 60 * 1000

/** The nekos.best result type holding GIFs. */
const gifSearchType = 2

/** The number of results requested per search. */
const searchAmount = 25

/** The number of attempts made per search. */
const searchAttempts = 2

/** The number of choices Discord accepts per autocomplete response. */
const maxAutocompleteChoices = 25

/** The number of characters Discord accepts in a choice. */
const maxChoiceLength = 100

/** The reactions offered first in autocomplete. */
const featuredReactions = [
	'hug', 'pat', 'kiss', 'cuddle', 'slap', 'poke', 'laugh', 'cry', 'dance',
	'punch', 'happy', 'sad', 'blush', 'smug', 'bite', 'wave', 'stare', 'shrug',
	'thumbsup', 'sleep'
]

/** The reactions both providers serve under the same name. */
const sharedReactions = [
	'bite', 'bleh', 'blush', 'clap', 'confused', 'cry', 'cuddle', 'dance',
	'facepalm', 'handhold', 'happy', 'hug', 'kiss', 'laugh', 'nom', 'pat',
	'poke', 'pout', 'punch', 'run', 'shrug', 'sip', 'slap', 'sleep', 'smile',
	'smug', 'stare', 'thumbsup', 'tickle', 'wave', 'wink', 'yawn'
]

/** The OtakuGIFs name of every shared reaction it names differently. */
const sharedReactionAliases = {
	angry: 'angrystare',
	blowkiss: 'airkiss',
	bonk: 'smack',
	highfive: 'brofist',
	lurk: 'peek',
	nod: 'yes',
	nope: 'no',
	nya: 'nyah',
	shocked: 'surprised',
	spin: 'roll'
}

/** The reactions only nekos.best serves. */
const nekosBestReactions = [
	'baka', 'bored', 'carry', 'feed', 'handshake', 'kabedon', 'kick',
	'lappillow', 'peck', 'salute', 'shake', 'shoot', 'tableflip', 'teehee',
	'think', 'wag', 'yeet'
]

/** The reactions only OtakuGIFs serves, and the nearest nekos.best stand-in. */
const otakuGifsReactions = {
	celebrate: 'happy',
	cheers: null,
	cool: 'smug',
	drool: null,
	evillaugh: 'laugh',
	headbang: null,
	huh: 'confused',
	lick: null,
	love: null,
	mad: 'angry',
	nervous: null,
	nosebleed: null,
	nuzzle: 'cuddle',
	pinch: null,
	sad: 'cry',
	scared: 'shocked',
	shout: null,
	shy: 'blush',
	sigh: null,
	sing: null,
	slowclap: 'clap',
	sneeze: null,
	sorry: null,
	stop: null,
	sweat: null,
	tired: 'yawn',
	woah: 'shocked',
	yay: 'happy'
}

/**
 * Fetches a provider endpoint.
 *
 * @param {string} url - url
 * @param {string} provider - provider
 * @param {string} reaction - reaction
 *
 * @returns {Promise<*>} data - data
 */
async function request(url, provider, reaction) {
	return axios.get(url, {
		headers: { 'User-Agent': userAgent },
		timeout: requestTimeout
	})
		.then(response => response.data)
		.catch(error => {
			console.error(`[${provider}] Couldn’t fetch a “${reaction}” GIF: ${error.message}`)
			return null
		})
}

/**
 * The given GIFs, less any repeated URL.
 *
 * @param {Object[]} gifs - gifs
 *
 * @returns {Object[]} gifs - gifs
 */
function uniqueByURL(gifs) {
	const seen = new Set()

	return gifs.filter(gif => {
		if (seen.has(gif.url)) {
			return false
		}

		seen.add(gif.url)
		return true
	})
}

/**
 * Downloads the given GIF.
 *
 * @param {string} url - url
 *
 * @returns {Promise<?AttachmentBuilder>} attachment - attachment
 */
async function download(url) {
	const response = await axios.get(url, {
		headers: { 'User-Agent': userAgent },
		timeout: requestTimeout,
		responseType: 'arraybuffer'
	}).catch(error => {
		console.error(`Couldn’t download ${url}: ${error.message}`)
		return null
	})

	if (!response?.headers['content-type']?.startsWith('image/')) {
		console.error(`Couldn’t download ${url}: served ${response?.headers['content-type'] ?? 'nothing'}`)
		return null
	}

	return new AttachmentBuilder(Buffer.from(response.data), {
		name: url.split('/').pop()
	})
}

/** The providers a reaction can be served by. */
const providers = {
	nekosBest: {
		gifsFor: async (reaction, count) => {
			const data = await request(`${nekosBestAPIURL}/${reaction}?amount=${count}`, 'nekos.best', reaction)
			return (data?.results ?? [])
				.filter(result => result.url)
				.map(result => ({ url: result.url, title: result.anime_name ?? null }))
		}
	},
	otakuGifs: {
		gifsFor: async (reaction, count) => {
			const responses = await Promise.all(Array.from({ length: Math.min(count, maxParallelRequests) }, () =>
				request(`${otakuGifsAPIURL}/gif?reaction=${reaction}&format=gif`, 'OtakuGIFs', reaction)))
			return responses
				.filter(data => data?.url)
				.map(data => ({ url: data.url, title: null }))
		}
	}
}

/** Every reaction, mapped to the providers serving it. */
const reactionProviders = {}

for (const reaction of sharedReactions) {
	reactionProviders[reaction] = [['nekosBest', reaction], ['otakuGifs', reaction]]
}

for (const [reaction, otakuGifsReaction] of Object.entries(sharedReactionAliases)) {
	reactionProviders[reaction] = [['nekosBest', reaction], ['otakuGifs', otakuGifsReaction]]
}

for (const reaction of nekosBestReactions) {
	reactionProviders[reaction] = [['nekosBest', reaction]]
}

for (const [reaction, nekosBestReaction] of Object.entries(otakuGifsReactions)) {
	reactionProviders[reaction] = nekosBestReaction
		? [['otakuGifs', reaction], ['nekosBest', nekosBestReaction]]
		: [['otakuGifs', reaction]]
}

/** Every reaction the bot offers. */
const reactions = Object.keys(reactionProviders).sort()

/** The reactions an unattended drop may use. */
const dropReactions = [
	'angry', 'baka', 'bleh', 'blush', 'bonk', 'bored', 'celebrate', 'cheers',
	'clap', 'confused', 'cool', 'cry', 'dance', 'evillaugh', 'facepalm', 'feed',
	'handshake', 'happy', 'headbang', 'highfive', 'hug', 'huh', 'kick', 'laugh',
	'lurk', 'mad', 'nervous', 'nod', 'nom', 'nope', 'nya', 'pat', 'pinch',
	'poke', 'pout', 'punch', 'run', 'sad', 'salute', 'scared', 'shake',
	'shocked', 'shoot', 'shout', 'shrug', 'shy', 'sigh', 'sing', 'sip', 'slap',
	'sleep', 'slowclap', 'smile', 'smug', 'sneeze', 'sorry', 'spin', 'stare',
	'stop', 'tableflip', 'teehee', 'think', 'thumbsup', 'tired', 'wag', 'wave',
	'wink', 'woah', 'yawn', 'yay', 'yeet'
].filter(reaction => reactionProviders[reaction])

/**
 * The nekos.best name of the given reaction.
 *
 * @param {?string} reaction - reaction
 *
 * @returns {?string} name - name
 */
function nekosBestNameFor(reaction) {
	const entry = (reactionProviders[reaction] ?? []).find(([provider]) => provider === 'nekosBest')
	return entry?.[1] ?? null
}

/**
 * The sort rank of the given reaction.
 *
 * @param {string} reaction - reaction
 *
 * @returns {number} rank - rank
 */
function rankOf(reaction) {
	const rank = featuredReactions.indexOf(reaction)
	return rank === -1 ? featuredReactions.length : rank
}

/**
 * The heading above a picker.
 *
 * @param {?string} reaction - reaction
 * @param {?string} query - query
 * @param {number} page - page
 *
 * @returns {string} heading - heading
 */
function headingFor(reaction, query, page) {
	const parts = []

	if (reaction) {
		parts.push(`\`${reaction}\``)
	}

	if (query) {
		parts.push(`“${query}”`)
	}

	parts.push(`page ${page + 1}`)

	return parts.join(' · ')
}

/**
 * The picker’s heading, gallery and buttons.
 *
 * @param {string} heading - heading
 * @param {Object[]} gifs - gifs
 * @param {boolean} canGoBack - can go back
 * @param {boolean} canGoForward - can go forward
 *
 * @returns {Object[]} components - components
 */
function pickerComponents(heading, gifs, canGoBack, canGoForward) {
	const components = [
		new TextDisplayBuilder().setContent(heading),
		new MediaGalleryBuilder().addItems(gifs.map(gif => {
			const item = new MediaGalleryItemBuilder().setURL(gif.url)
			return gif.title ? item.setDescription(gif.title) : item
		}))
	]

	for (let offset = 0; offset < gifs.length; offset += maxButtonsPerRow) {
		components.push(new ActionRowBuilder().addComponents(
			gifs.slice(offset, offset + maxButtonsPerRow).map((gif, position) => new ButtonBuilder()
				.setCustomId(`${buttonPrefix}send_${offset + position}`)
				.setLabel(String(offset + position + 1))
				.setStyle(ButtonStyle.Secondary))
		))
	}

	components.push(new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`${buttonPrefix}previous`)
			.setLabel('◀ Previous')
			.setStyle(ButtonStyle.Primary)
			.setDisabled(!canGoBack),
		new ButtonBuilder()
			.setCustomId(`${buttonPrefix}next`)
			.setLabel('Next ▶')
			.setStyle(ButtonStyle.Primary)
			.setDisabled(!canGoForward),
		new ButtonBuilder()
			.setCustomId(`${buttonPrefix}cancel`)
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Danger)
	))

	return components
}

/**
 * A payload holding the given text.
 *
 * @param {string} text - text
 *
 * @returns {Object} payload - payload
 */
function notice(text) {
	return {
		flags: MessageFlags.IsComponentsV2,
		components: [new TextDisplayBuilder().setContent(text)]
	}
}

class GifManager {
	// MARK: - Properties
	/**
	 * @param {Client} client - client
	 */
	client

	/**
	 * @param {REST} rest - rest
	 */
	rest

	/**
	 * @type {?Object} kurozoraManager - kurozora manager
	 */
	kurozoraManager

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Client} client - Client
	 * @param {REST} rest - Rest
	 * @param {Object} kurozoraManager - Kurozora manager
	 */
	constructor(client, rest, kurozoraManager) {
		this.client = client
		this.rest = rest
		this.kurozoraManager = kurozoraManager
	}

	// MARK: - Functions
	/**
	 * Opens a picker of GIFs for the given reaction or anime title.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} query - query
	 *
	 * @returns {Promise<*>}
	 */
	async reply(interaction, query) {
		const term = query.trim()
		const reaction = reactionProviders[term.toLowerCase()] ? term.toLowerCase() : null
		const title = reaction ? null : term

		await interaction.reply({
			...notice(`Looking for ${headingFor(reaction, title, 0).replace(' · page 1', '')} GIFs…`),
			flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
		})

		const gifs = await this.gifs(reaction, title, title ? searchAmount : fetchSize)

		if (!gifs.length) {
			return interaction.editReply(notice(title
				? `Nothing found for “${title}”. Try a reaction like \`hug\`, or another anime title.`
				: `No \`${reaction}\` GIF could be fetched right now. Please try again later.`))
				.catch(error => console.error(error))
		}

		return this.#present(interaction, reaction, title, gifs)
	}

	/**
	 * Responds to the interaction with the reactions matching its focused value.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async autocomplete(interaction) {
		const term = interaction.options.getFocused().trim()
		const needle = term.toLowerCase()
		const searchable = term.length > 0 && term.length <= maxChoiceLength && !reactionProviders[needle]
		const matches = reactions
			.filter(reaction => reaction.includes(needle))
			.sort((lhs, rhs) => lhs.indexOf(needle) - rhs.indexOf(needle) || rankOf(lhs) - rankOf(rhs))
			.slice(0, maxAutocompleteChoices - (searchable ? 1 : 0))

		const choices = matches.map(reaction => ({
			name: reaction.charAt(0).toUpperCase() + reaction.slice(1),
			value: reaction
		}))

		if (searchable) {
			choices.push({
				name: `Search “${term}”`,
				value: term
			})
		}

		return interaction.respond(choices).catch(error => console.error(error))
	}

	/**
	 * A random reaction out of the ones an unattended drop may use.
	 *
	 * @returns {string} reaction - reaction
	 */
	randomDropReaction() {
		return dropReactions[Math.floor(Math.random() * dropReactions.length)]
	}

	/**
	 * The subtext credit for the given title and requester.
	 *
	 * @param {?string} title - title
	 * @param {Object} user - user
	 *
	 * @returns {Promise<string>} subtitle - subtitle
	 */
	async #subtitleFor(title, user) {
		const parts = []

		if (title) {
			const url = await this.kurozoraManager?.animeURL(title)
				.catch(error => console.error(error))

			parts.push(url ? `[${title}](${url})` : title)
		}

		parts.push(`sent by <@${user.id}>`)

		return `-# ${parts.join(' · ')}`
	}

	/**
	 * The given GIF as an attachment.
	 *
	 * @param {string} url - url
	 *
	 * @returns {Promise<?AttachmentBuilder>} attachment - attachment
	 */
	async attachment(url) {
		return download(url)
	}

	/**
	 * Up to `count` GIFs for the given reaction and query.
	 *
	 * @param {?string} reaction - reaction
	 * @param {?string} query - query
	 * @param {number} count - count
	 *
	 * @returns {Promise<Object[]>} gifs - gifs
	 */
	async gifs(reaction, query, count) {
		if (query) {
			return this.#search(reaction, query, count)
		}

		for (const [provider, providerReaction] of reactionProviders[reaction] ?? []) {
			const gifs = uniqueByURL(await providers[provider].gifsFor(providerReaction, count))

			if (gifs.length) {
				return gifs
			}
		}

		return []
	}

	/**
	 * Up to `count` GIFs whose anime title matches the query.
	 *
	 * @param {?string} reaction - reaction
	 * @param {string} query - query
	 * @param {number} count - count
	 *
	 * @returns {Promise<Object[]>} gifs - gifs
	 */
	async #search(reaction, query, count) {
		const category = nekosBestNameFor(reaction)
		const needle = query.toLowerCase()
		const parameters = new URLSearchParams({
			query: query,
			type: gifSearchType,
			amount: searchAmount
		})

		if (category) {
			parameters.set('category', category)
		}

		for (let attempt = 0; attempt < searchAttempts; attempt++) {
			const data = await request(`${nekosBestAPIURL}/search?${parameters}`, 'nekos.best', query)

			if (data) {
				return uniqueByURL((data.results ?? [])
					.filter(result => result.url && (result.anime_name ?? '').toLowerCase().includes(needle))
					.map(result => ({ url: result.url, title: result.anime_name })))
					.slice(0, count)
			}
		}

		return []
	}

	/**
	 * Shows the given GIFs until the user sends or dismisses one.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {?string} reaction - reaction
	 * @param {?string} query - query
	 * @param {Object[]} gifs - gifs
	 *
	 * @returns {Promise<*>}
	 */
	async #present(interaction, reaction, query, gifs) {
		const pool = [...gifs]
		const seen = new Set(pool.map(gif => gif.url))
		let page = 0
		let exhausted = Boolean(query)

		const pageOf = index => pool.slice(index * pickerSize, (index + 1) * pickerSize)

		const payload = () => ({
			flags: MessageFlags.IsComponentsV2,
			components: pickerComponents(
				headingFor(reaction, query, page),
				pageOf(page),
				page > 0,
				!exhausted || (page + 1) * pickerSize < pool.length
			)
		})

		const message = await interaction.editReply(payload())

		const collector = message.createMessageComponentCollector({
			filter: button => button.user.id === interaction.user.id,
			time: pickerTimeout
		})

		collector.on('collect', async button => {
			const action = button.customId.slice(buttonPrefix.length)

			if (action === 'cancel') {
				await button.deferUpdate().catch(error => console.error(error))
				return collector.stop('cancelled')
			}

			if (action === 'previous') {
				page = Math.max(0, page - 1)
				return button.update(payload()).catch(error => console.error(error))
			}

			if (action === 'next') {
				if ((page + 1) * pickerSize < pool.length) {
					page++
					return button.update(payload()).catch(error => console.error(error))
				}

				await button.deferUpdate().catch(error => console.error(error))

				const more = await this.gifs(reaction, query, fetchSize)
				more.filter(gif => !seen.has(gif.url)).forEach(gif => {
					seen.add(gif.url)
					pool.push(gif)
				})

				if ((page + 1) * pickerSize < pool.length) {
					page++
				} else {
					exhausted = true
				}

				return interaction.editReply(payload()).catch(error => console.error(error))
			}

			collector.stop('sent')
			await button.deferUpdate().catch(error => console.error(error))

			const choice = pageOf(page)[Number(action.slice('send_'.length))]
			const gif = await this.attachment(choice.url)

			if (!gif) {
				return interaction.editReply(notice('That GIF couldn’t be sent. Please try another one.'))
					.catch(error => console.error(error))
			}

			const sent = await interaction.channel?.send({
				content: await this.#subtitleFor(choice.title, interaction.user),
				files: [gif],
				flags: MessageFlags.SuppressEmbeds,
				allowedMentions: { parse: [] }
			}).catch(error => console.error(error))

			if (!sent) {
				return interaction.editReply(notice('That GIF couldn’t be sent. Please try another one.'))
					.catch(error => console.error(error))
			}

			return interaction.deleteReply().catch(error => console.error(error))
		})

		collector.on('end', (collected, reason) => {
			if (reason !== 'sent') {
				interaction.deleteReply().catch(error => console.error(error))
			}
		})
	}
}

module.exports = {
	GifManager: GifManager,
	gifButtonPrefix: buttonPrefix
}
