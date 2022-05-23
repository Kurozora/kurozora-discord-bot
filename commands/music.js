const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('music')
	.setDescription('Play and pause the audio of a YouTube videos.')
	.addSubcommand(subcommand =>
		subcommand
			.setName('queue')
			.setDescription('Queue a YouTube video for playback.')
			.addStringOption(option => 
				option.setName('target')
					.setDescription('The URL or ID of the YouTube video.')
					.setRequired(true)
			)
  	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('play')
			.setDescription('Play the audio.')
  	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('pause')
			.setDescription('Pause the audio.')
  	)

module.exports = {
	data: data
}
