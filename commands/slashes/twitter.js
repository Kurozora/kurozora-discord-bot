const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('twitter')
	.setDescription('Pull media out of a Twitter/X post.')
	.addSubcommand(subcommand =>
		subcommand
			.setName('video')
			.setDescription('Post a video or GIF from a Twitter/X link.')
			.addStringOption(option =>
				option.setName('link')
					.setDescription('The link of the post holding the content.')
					.setRequired(true)
			)
	)

module.exports = {
	data: data
}
