const { SlashCommandBuilder } = require('@discordjs/builders')
const activities = require('../resources/activities.json');

const data = new SlashCommandBuilder()
	.setName('play')
	.setDescription('Play voice chat games together.')
	.addStringOption(option => {
		option.setName('activity')
			.setDescription('The type of activity')
			.setRequired(true);

		Object.keys(activities).forEach(function(key) {
			const activity = activities[key]
			option.addChoice(activity.name, key);
		})

		return option
	})

module.exports = {
	data: data
}
