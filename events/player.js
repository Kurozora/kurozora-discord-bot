const { Player } = require('discord-player')

/** @param {Player} player - player */
module.exports.registerPlayerEvents = (player) => {
	player.events.on('error', (queue, error) => {
		console.log(`[${queue.guild.name}] Error emitted from the queue: ${error.message}`)
	});

	player.events.on('playerError', (queue, error) => {
		console.log(`[${queue.guild.name}] Error emitted from the connection: ${error.message}`)
	});

	player.events.on('playerStart', (queue, track) => {
		queue.metadata.channel.send({
			content: `🎵 | Playing: **${track.title}** in **${queue.channel.name}**!`
		}).catch(e => console.error(e))
	});

	player.events.on('audioTrackAdd', (queue, track) => {
		queue.metadata.channel.send({
			content: `📋 | Track **${track.title}** queued!`
		}).catch(e => console.error(e))
	});

	player.events.on('disconnect', (queue) => {
		queue.metadata.channel.send({
			content: '❌ | I was manually disconnected from the voice channel, clearing queue!'
		}).catch(e => console.error(e))
	});

	player.events.on('emptyChannel', (queue) => {
		queue.metadata.channel.send({
			content: '⏏️ | Nobody is in the voice channel, leaving...'
		}).catch(e => console.error(e))
	});

	player.events.on('queueEnd', (queue) => {
		queue.metadata.channel.send({
			content: '✅ | Queue finished!'
		}).catch(e => console.error(e))
	});
};
