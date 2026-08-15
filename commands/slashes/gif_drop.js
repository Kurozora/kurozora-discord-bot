const { SlashCommandBuilder } = require('@discordjs/builders')
const { ChannelType, PermissionFlagsBits } = require('discord.js')

const data = new SlashCommandBuilder()
	.setName('gifdrop')
	.setDescription('Drop a random anime GIF in a channel when it goes quiet.')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.addSubcommand(subcommand => subcommand
		.setName('set')
		.setDescription('Choose the channel the GIFs drop in.')
		.addChannelOption(option => option
			.setName('channel')
			.setDescription('The channel the GIFs drop in.')
			.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread)
			.setRequired(true)))
	.addSubcommand(subcommand => subcommand
		.setName('off')
		.setDescription('Stop dropping GIFs.'))
	.addSubcommand(subcommand => subcommand
		.setName('status')
		.setDescription('Read when the next GIF drops, and what is holding it back.'))
	.addSubcommand(subcommand => subcommand
		.setName('now')
		.setDescription('Drop a GIF right away.'))

module.exports = {
	data: data
}
