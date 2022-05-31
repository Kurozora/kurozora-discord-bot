const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('music')
	.setDescription('Play and pause the audio of a video from a supported source.')
	.addSubcommand(subcommand =>
		subcommand
			.setName('queue')
			.setDescription('Queue an audio for playback.')
			.addStringOption(option => 
				option.setName('target')
					.setDescription('The URL, ID or name of the video.')
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
	.addSubcommand(subcommand =>
		subcommand
			.setName('forwards')
			.setDescription('Skip forwards.')
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('backwards')
			.setDescription('Skip backwards.')
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('clear')
			.setDescription('Clear the queue.')
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('list')
			.setDescription('Returns the current queue list.')
	)

module.exports = {
	data: data
}
