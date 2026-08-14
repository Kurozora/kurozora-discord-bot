const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('gif')
	.setDescription('Anime reaction gifs!')
	.addStringOption(option => option
		.setName('query')
		.setDescription('A reaction like hug or pat, or an anime title like One Piece.')
		.setRequired(true)
		.setAutocomplete(true))

module.exports = {
	data: data
}
