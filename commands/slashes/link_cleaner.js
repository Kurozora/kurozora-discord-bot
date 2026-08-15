const { SlashCommandBuilder } = require('@discordjs/builders')
const { PermissionFlagsBits } = require('discord.js')

const data = new SlashCommandBuilder()
	.setName('linkcleaner')
	.setDescription('Strip the tracking off the links posted here.')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.addSubcommand(subcommand => subcommand
		.setName('on')
		.setDescription('Post a clean copy of every tracked link.'))
	.addSubcommand(subcommand => subcommand
		.setName('off')
		.setDescription('Leave the links posted here alone.'))
	.addSubcommand(subcommand => subcommand
		.setName('status')
		.setDescription('Read how link cleaning is set up, and change it.'))
	.addSubcommand(subcommand => subcommand
		.setName('test')
		.setDescription('Read what a link is cleaned down to, without posting it.')
		.addStringOption(option => option
			.setName('link')
			.setDescription('The link to clean.')
			.setRequired(true)))

module.exports = {
	data: data
}
