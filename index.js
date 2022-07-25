require('dotenv').config();
const axios = require('axios')
const fs = require('fs')
const { Client, Intents, MessageEmbed } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')
const { ActivityManager } = require('./helpers/activities')
const { KurozoraManager } = require('./helpers/kurozora')
const { MusicManager } = require('./helpers/music')
const { StreamManager } = require('./helpers/stream')
const { UtilsManager } = require('./helpers/utils')
const { Player } = require('discord-player');
const { registerEvents } = require('./events/events')

// MARK: - Properties
const prefix = 'k!'
const webhookName = 'Kurozora_webhook'
const token = process.env['TOKEN']
const appID = process.env['APP_ID']

const commands = []
const commandFiles = fs.readdirSync('./commands')
	.filter(file => file.endsWith('.js'))

// Initialize client
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

// Initialize managers
const activityManager = new ActivityManager(client, rest)
const kurozoraManager = new KurozoraManager(client, rest)
const musicManager = new MusicManager(client, rest, client.player)
const streamManager = new StreamManager(client, rest)
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

	switch (commandName) {
		case 'cat': {
			await interaction.deferReply()
			const {file} = await getCat()
			return interaction.editReply({files: [file]})
		}
		case 'dog': {
			await interaction.deferReply()
			const {url} = await axios.get('https://random.dog/woof.json')
				.then(response => response.data)
			return interaction.editReply({files: [url]})
		}
		case 'fox': {
			await interaction.deferReply()
			const {image} = await axios.get('https://randomfox.ca/floof')
				.then(response => response.data)
			return interaction.editReply({files: [image]})
		}
		case 'search': {
			// await interaction.deferReply()
			let type = interaction.options.getString('type')
			let query = interaction.options.getString('query')
			return await kurozoraManager.search(interaction, type, query)
			// return interaction.reply({
			// 	content: 'Dang, caught red handed. Update in progress...',
			// 	ephemeral: true
			// })
			// const reply = await find(interaction.options.getString('title'))
			// return interaction.editReply(reply)
		}
		case 'play': {
			await interaction.deferReply()
			let activity = interaction.options.getString('activity')
			let voiceChannel = interaction.member.voice.channel

			if (!voiceChannel) return interaction.editReply('Connect to a voice channel first.')

			let code = await activityManager.activityInvite(voiceChannel, activity)

			if (code) {
				return interaction.editReply('https://discord.gg/' + code)
			}

			return interaction.editReply('An invite link can’t be generated at this moment.')
		}
		case 'stream': {
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
		}
		case 'music': {
			let voiceChannel = interaction.member.voice.channel
			let command = interaction.options.getSubcommand()

			if (command != 'search') {
				if (!confirmConnectedToVC(voiceChannel, interaction)) {
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
						content: 'This command is work in progress, or **<@259790276602626058>** made a typo so it wasn’t recognized. Please notify.',
						ephemeral: true
					})
			}
		}
		case 'flip': {
			return utilsManager.flipCoin(interaction)
		}
		default:
			return interaction.reply({
				content: 'This command is work in progress, or **<@259790276602626058>** made a typo so it wasn’t recognized. Please notify.',
				ephemeral: true
			})
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

// Login client
client.login(token)
