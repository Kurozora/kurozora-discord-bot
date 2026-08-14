const { SlashCommandBuilder } = require('@discordjs/builders')
const { PermissionFlagsBits } = require('discord.js')

const data = new SlashCommandBuilder()
	.setName('stats')
	.setDescription('Read how many servers and people KuroBot reaches.')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

module.exports = {
	data: data
}
