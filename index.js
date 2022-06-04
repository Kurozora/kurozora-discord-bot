const axios = require('axios')
const fs = require('fs')
const { Client, Intents, MessageEmbed } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')
const { ActivityManager } = require('./helpers/activities')
const { StreamManager } = require('./helpers/stream')
const { MusicManager } = require('./helpers/music')
const { UtilsManager } = require('./helpers/utils')
const { Player } = require('discord-player');
const { registerEvents } = require('./events/events')

// MARK: - Properties
const prefix = 'k!'
const webhookName = 'Kurozora_webhook'
const token = process.env['token']
const appID = process.env['app_id']

const commands = []
const commandFiles = fs.readdirSync('./commands')
	.filter(file => file.endsWith('.js'))

const client = new Client({
	intents: [
		Intents.FLAGS.GUILDS,
		Intents.FLAGS.GUILD_MESSAGES,
		Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS,
		Intents.FLAGS.GUILD_VOICE_STATES,
	]
})
client.player = new Player(client)
const rest = new REST({ version: '9' })
	.setToken(token)
const activityManager = new ActivityManager(client, rest)
const streamManager = new StreamManager(client, rest)
const musicManager = new MusicManager(client, rest, client.player)
const utilsManager = new UtilsManager(client, rest)

// Add commands
for (const file of commandFiles) {
	const command = require(`./commands/${file}`)
	commands.push(command.data.toJSON())
}

(async () => {
	try {
		console.log('Started refreshing application (/) commands.')
		await rest.put(
			Routes.applicationCommands(appID),
			{
				body: commands
			},
		)
		console.log('Successfully reloaded application (/) commands.')
	} catch (error) {
		console.error(error)
	}
})()

// MARK: - Event Listeners
registerEvents(client)

/** Runs when a message is created by a user. */
client.on('messageCreate', async message => {
	// Don't do anything if it's from a bot or doesn't start with the prefix
	if (message.author.bot) return
	if (!message.content.startsWith(prefix)) return

	// Perform the requested command
	if (message.content === `${prefix}setup`) {
		const args = message.content.slice(`${prefix.length}setup`).trim().split(/ +/g)

		let webhooks = await message.guild.fetchWebhooks()
			.then(webhook => webhook)
			.catch(console.error)

		if (webhooks.find(function(webhook) {
			console.log(webhook)
			return webhook.name === webhookName
		})) {
			return message.reply(`Webhook with the name "${webhookName}" already exists.`)
		}

		// Check for permissions because we don't need everyone making webhooks!
		if (!message.member.permissions.has('MANAGE_WEBHOOKS')) {
			return message.channel.send('You are not authorized to do this!')
		}

		// What if the bot can't do it?
		if (!message.guild.me.permissions.has('MANAGE_WEBHOOKS')) {
			return message.channel.send(`I don't have the proper permission (Manage Webhooks) to make webhooks!`)
		}

		message.channel.createWebhook(webhookName)
			.then(webhook => console.log(`Created webhook ${webhook}`))
			.catch(console.error)

		message.channel.send(`Kurozora is all set up. Enjoy!`)
	} else if (message.content.startsWith(`${prefix}test`)) {
		sendMessageUsingWebhook(message)
	} else {
		message.channel.send('You need to enter a valid command!')
	}
})

/** Runs when an interaction is created by a user. */
client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) return

	const { commandName } = interaction

	if (commandName === 'cat') {
		await interaction.deferReply()
		const { file } = await getCat()
		return interaction.editReply({ files: [file] })
	} else if (commandName === 'dog') {
		await interaction.deferReply()
		const { url } = await axios.get('https://random.dog/woof.json')
			.then(response => response.data)
		interaction.editReply({ files: [url] })
		return
	} else if (commandName === 'fox') {
		await interaction.deferReply()
		const { image } = await axios.get('https://randomfox.ca/floof')
			.then(response => response.data)
		interaction.editReply({ files: [image] })
		return
	} else if (commandName === 'find') {
		await interaction.deferReply()
		const reply = await find(interaction.options.getString('title'))
		interaction.editReply(reply)
		return
	} else if (commandName === 'play') {
		await interaction.deferReply()
		let activity = interaction.options.getString('activity')
		let voiceChannel = interaction.member.voice.channel
		if (!voiceChannel) return interaction.editReply('Connect to a voice channel first.')

		let code = await activityManager.activityInvite(voiceChannel, activity)
		if (code) {
			interaction.editReply('https://discord.gg/' + code)
		} else {
			interaction.editReply('An invite link can’t be generated at this moment.')
		}
		return
	} else if (commandName == 'stream') {
		let user = interaction.member
		let voiceChannel = interaction.member.voice.channel
		if (!voiceChannel) {
			return interaction.reply({
				content: '❌ | Connect to a voice channel first.',
				ephemeral: true
			})
		}

		await interaction.deferReply()
		let code = await streamManager.streamInvite(voiceChannel, user)

		if (code) {
			return interaction.editReply('https://discord.gg/' + code)
		}

		return interaction.editReply('An invite link can‘t be generated at this moment.')
	} else if (commandName == 'music') {
		let voiceChannel = interaction.member.voice.channel
		let command = interaction.options.getSubcommand()

		if (command != 'search') {
			if (! confirmConnectedToVC(voiceChannel, interaction)) {
				return
			}
		}

		switch (command) {
			case 'queue': {
				let target = interaction.options.getString('target')
				return await musicManager.queue(voiceChannel, interaction, target)
			}
			case 'search': {
				let target = interaction.options.getString('target')
				return await musicManager.search(interaction, target)
			}
			case 'play': {
				return musicManager.play(interaction)
			}
			case 'pause': {
				return musicManager.pause(interaction)
			}
			case 'forwards': {
				return musicManager.forwards(interaction)
			}
			case 'backwards': {
				return musicManager.backwards(interaction)
			}
			case 'shuffle': {
				return musicManager.shuffle(interaction)
			}
			case 'loop': {
				return musicManager.loop(interaction)
			}
			case 'volume': {
				return musicManager.volume(interaction)
			}
			case 'clear': {
				return musicManager.clear(interaction)
			}
			case 'list': {
				return musicManager.list(interaction)
			}
			default:
				return interaction.reply({
					content: 'This command is work in progress, or **<@259790276602626058>** made a typo so it wasn’t recognized.',
					ephemeral: true
				})
		}
	} else if (commandName == 'flip') {
		return utilsManager.flipCoin(interaction)
	}
})

// MARK: - Functions
/**
 * Get a random cat picture and return the response.
 */
async function getCat() {
	const response = await axios.get('https://aws.random.cat/meow')
			.then(response => response.data)
			.catch(error => console.error(error))

	if (!response) {
		return getCat()
	}

	return response
}

/**
 * Confirms the user has joined a voice channel.
 *
 * @param {VoiceChannle} voiceChannel - voice channel
 * @param {Interaction} interaction - interaction
 */
function confirmConnectedToVC(voiceChannel, interaction) {
	if (!voiceChannel) {
		interaction.reply({
			content: '❌ | Connect to a voice channel first.',
			ephemeral: true
		}).catch(e => console.error(e))
		return false
	}
	return true
} 

/** 
 * Find the requested anime on Kurozora.app 
 *
 * @param {string} query - query
 */
async function find(query) {
	const data = await axios.get('https://api.kurozora.app/v1/anime/search', {
		params: {
			'query': query,
			'limit': 1
		}
	})
		.then(function(response) {
			const { data } = response.data

			if (data.length != 0) {
				let animeEmbed = generateEmbedFor(data[0])
				return { embeds: [animeEmbed] }
			}

			return `No results were found for ${query} :(`
		})
		.catch(function(error) {
			console.error(error)
			return `No results were found for ${query} :(`
		})

	return data
}

/** Generates a message embed for the given anime. */
function generateEmbedFor(anime) {
	const synopsis = anime.attributes.synopsis
	const poster = anime.attributes.poster
	const banner = anime.attributes.banner
	const kurozoraUrl = `https://kurozora.app/anime/${anime.attributes.slug}`
	const copyright = anime.attributes.copyright
	const broadcast = getBroadcast(anime)
	const aired = getAirDates(anime)
	const airSeasonEmoji = getAirSeasonEmoji(anime)
	const rating = getRating(anime)
	const genres = getGenres(anime)
	const themes = getThemes(anime)

	const messageEmbed = new MessageEmbed()
		.setTitle(anime.attributes.title)
		.setURL(kurozoraUrl)
	// .setAuthor({
	// 	name: anime.,
	// 	iconURL: 'https://i.imgur.com/AfFp7pu.png',
	// 	url: 'https://discord.js.org'
	// })

	if (synopsis) {
		messageEmbed.setDescription(synopsis)
	}

	if (poster) {
		messageEmbed.setThumbnail(poster.url)
			.setColor(poster.backgroundColor)
	} else {
		messageEmbed.setColor('#FF9300')
	}

	messageEmbed.addFields(
		{
			name: '⏳ Status',
			value: anime.attributes.status.name,
			inline: true
		},
		{
			name: `${airSeasonEmoji} Season`,
			value: anime.attributes.airSeason,
			inline: true
		},
		{
			name: '📺 Type',
			value: anime.attributes.type.name,
			inline: true
		},
		{
			name: '🎯 Source',
			value: anime.attributes.source.name,
			inline: true
		},
		{
			name: '🔣 TV Rating',
			value: anime.attributes.tvRating.name,
			inline: true
		},
		{
			name: '\u200B',
			value: '\u200B',
			inline: true
		},
		{
			name: '🎭 Genres',
			value: genres
		},
		{
			name: '🎡 Themes',
			value: themes
		}
	)

	if (broadcast) {
		messageEmbed.addField('📡 Broadcast', broadcast, true)
	}

	if (aired) {
		messageEmbed.addField('📆 Aired', aired, true)
	}

	messageEmbed.addFields(
		{
			name: '\u200B',
			value: '\u200B',
			inline: true
		},
		{
			name: '🧂 Seasons',
			value: `${anime.attributes.seasonCount}`,
			inline: true
		},
		{
			name: '🎞 Episodes',
			value: `${anime.attributes.episodeCount}`,
			inline: true
		},
		{
			name: '⏱ Duration',
			value: anime.attributes.duration,
			inline: true
		},
		{
			name: '⏱ Duration Total',
			value: anime.attributes.durationTotal,
		}
	)

	if (rating) {
		messageEmbed.addField('⭐️ Rating', rating)
	}

	if (banner) {
		messageEmbed.setImage(banner.url)
	}

	if (copyright) {
		messageEmbed.setFooter({
			text: copyright,
		})
	}

	return messageEmbed
}

/** Get the broadcast of the given anime. */
function getBroadcast(anime) {
	var broadcast = ''
	const airDay = anime.attributes.airDay
	const airTime = anime.attributes.airTime

	if (airDay) {
		broadcast += `${airDay} `
	}

	if (airTime) {
		broadcast += `at ${airTime}UTC`
	}

	return broadcast
}

/** Get the air dates of the given anime. */
function getAirDates(anime) {
	var aired = ''
	const firstAired = anime.attributes.firstAired
	const lastAired = anime.attributes.lastAired

	if (firstAired) {
		const date = new Date(firstAired * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
		aired += `🚀 ${date}`
	}

	if (lastAired) {
		const date = new Date(lastAired * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
		aired += `\n╰╍╍╍╍╍╍╍╍╮\n${date} 🏁`
	}

	return aired
}

/** Get the air season emoji of the given anime. */
function getAirSeasonEmoji(anime) {
	switch (anime.attributes.airSeason) {
		case 'Spring':
			return '🍃'
		case 'Summer':
			return '☀️'
		case 'Fall':
			return '🍁'
		default:
			return '❄️'
	}
}

/** Get the rating of the given anime. */
function getRating(anime) {
	var rating = null
	const stats = anime.attributes.stats

	if (stats) {
		rating = `**${stats.ratingAverage}**/5.0 with **${abbreviateNumber(stats.ratingCount)}** Ratings`
	}

	return rating
}

/** Get the genres of the given anime. */
function getGenres(anime) {
	var genres = 'N/A'
	const genresArray = anime.attributes.genres ?? []

	if (genresArray.length) {
		genres = genresArray.join(', ')
	}

	return genres
}

/** Get the themes of the given anime. */
function getThemes(anime) {
	var themes = 'N/A'
	const themesArray = anime.attributes.themes ?? []

	if (themesArray.length) {
		themes = themesArray.join(', ')
	}

	return themes
}

async function sendMessageUsingWebhook(message) {
	let webhooks = await message.guild.fetchWebhooks()
		.then(webhook => webhook)
		.catch(console.error)

	let kWebhook = webhooks.find(function(webhook) {
		return webhook.name === webhookName
	})

	if (kWebhook) {
		const emoji = client.emojis.cache.find(emoji => emoji.name === 'lsd_')

		kWebhook.send({
			content: `${message.content} ${emoji}`,
			username: message.author.username,
			avatarURL: message.author.avatarURL(),
		})
	}
	// message.channel.createWebhook(message.author.username, {avatar: message.author.avatarURL()}).then(webhook => {
	// 	webhook.send(msg).then(() => {
	// 		webhook.delete()
	// 	})
	// })
}

/** Abbreviates the given number to a more readable value. */
function abbreviateNumber(value) {
	return Intl.NumberFormat('en-US', {
		maximumFractionDigits: 1,
		notation: 'compact',
		compactDisplay: 'short'
	}).format(value)
}

// Login client
client.login(token)
