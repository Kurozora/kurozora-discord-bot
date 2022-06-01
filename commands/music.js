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
			.setName('shuffle')
			.setDescription('Shuffle the playback.')
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('loop')
			.setDescription('Loop the playback.')
			.addStringOption(option =>
				option.setName('mode')
					.setDescription('Set the mode of the loop.')
					.addChoice('Autoplay', 'autoplay')
					.addChoice('Track', 'track')
					.addChoice('Queue', 'queue')
					.addChoice('Off', 'off')
			)
			.addStringOption(option =>
				option.setName('info')
					.setDescription('Various information about the current loop status.')
					.addChoice('Status', 'status')
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('volume')
			.setDescription('Change the volume of the playback.')
			.addIntegerOption(option =>
				option.setName('level')
					.setDescription('The level of the volume.')
					.setRequired(true)
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('clear')
			.setDescription('Clear the playback queue.')
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('list')
			.setDescription('Lists the current queue tracks.')
	)

module.exports = {
	data: data
}
