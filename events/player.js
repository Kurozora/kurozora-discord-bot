const { Player } = require('discord-player')

/** @param {Player} player - player */
module.exports.registerPlayerEvents = (player) => {
	player.on('error', (queue, error) => {
		console.log(`[${queue.guild.name}] Error emitted from the queue: ${error.message}`)
	});

	player.on('connectionError', (queue, error) => {
		console.log(`[${queue.guild.name}] Error emitted from the connection: ${error.message}`)
	});

	player.on('trackStart', (queue, track) => {
		queue.metadata.channel.send({
			content: `🎵 | Playing: **${track.title}** in **${queue.connection.channel.name}**!`
		}).catch(e => console.error(e))
	});

	player.on('trackAdd', (queue, track) => {
		queue.metadata.channel.send({
			content: `📋 | Track **${track.title}** queued!`
		}).catch(e => console.error(e))
	});

	player.on('botDisconnect', (queue) => {
		queue.metadata.channel.send({
			content: '❌ | I was manually disconnected from the voice channel, clearing queue!'
		}).catch(e => console.error(e))
	});

	player.on('channelEmpty', (queue) => {
		queue.metadata.channel.send({
			content: '⏏️ | Nobody is in the voice channel, leaving...'
		}).catch(e => console.error(e))
	});

	player.on('queueEnd', (queue) => {
		queue.metadata.channel.send({
			content: '✅ | Queue finished!'
		}).catch(e => console.error(e))
	});
};