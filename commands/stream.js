const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('stream')
	.setDescription('Create a stream link to share with others.')

module.exports = {
	data: data
}
