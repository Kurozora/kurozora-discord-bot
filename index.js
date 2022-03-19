const axios = require('axios')
const fs = require('fs')
const { Client, Intents, MessageEmbed, Constants } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')

// MARK: - Properties
const prefix = 'k!'
const token = process.env['token']
const appID = process.env['app_id']

const commands = []
const commandFiles = fs.readdirSync('./commands')
	.filter(file => file.endsWith('.js'))

const client = new Client({
	intents: [
		Intents.FLAGS.GUILDS,
		Intents.FLAGS.GUILD_MESSAGES
	]
})
const rest = new REST({ version: '9' })
	.setToken(token);

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

// MARK: - Listeners
/** Runs one when the bot is online. */
client.once('ready', c => {
	console.log(`🚀 [${c.user.tag}] Running...`)
	client.user.setActivity('https://kurozora.app', { type: Constants.ActivityTypes.PLAYING })
})

/** Runs one when the bot is reconnecting. */
client.once("reconnecting", c => {
	console.log(`🔃 [${c.user.tag}] Reconnecting...`)
})

/** Runs one when the bot offline. */
client.once("disconnect", c => {
	console.log(`[${c.user.tag}] Disconnect!`)
})

/** Runs when a message is created by a user. */
client.on('messageCreate', async message => {
	// Don't do anything if it's from a bot or doesn't start with the prefix
	if (message.author.bot) return
	if (!message.content.startsWith(prefix)) return

	// Perform the requested command
	if (message.content.startsWith(`${prefix}find`)) {
		const args = message.content.slice(`${prefix}find`.length).trim();

		if (!args.length) {
			return message.channel.send(`Please provide a title.`, { ephemeral: true });
		}

		const anime = await find(args)
		message.channel.send(anime)
		return
	} else {
		message.channel.send("You need to enter a valid command!")
	}
})

/** Runs when an interaction is created by a user. */
client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) return

	const { commandName } = interaction

	if (commandName === 'cat') {
		await interaction.deferReply()
		const { file } = await axios.get('https://aws.random.cat/meow')
			.then(response => response.data)
		interaction.editReply({ files: [file] })
		return
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
		const data = await find(interaction.options.getString('title'))
		interaction.editReply(data)
		return
	}
})

// MARK: - Functions
/** Find the requested anime on Kurozora.app */
async function find(query) {
	const data = await axios.get('https://api.kurozora.app/v1/anime/search', {
		params: {
			'query': query
		}
	})
		.then(function(response) {
			const { data } = response.data

			if (data.length != 0) {
				return `https://kurozora.app/anime/${data[0].attributes.slug}`
			}

			return `No results were found for ${query} :(`;
		})
		.catch(function(error) {
			console.log(error);
		})

	return data
}

// Login client
client.login(token)
