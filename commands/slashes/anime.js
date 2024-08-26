const { SlashCommandBuilder } = require('@discordjs/builders')
const { AnimeGifType } = require.main.require('./enums/AnimeGifType')

const data = new SlashCommandBuilder()
    .setName('anime')
    .setDescription('Anime gifs!')
    .addStringOption(option => {
        option.setName('type')
            .setDescription('Select the type of the gif.')
            .setRequired(true)

        Object.keys(AnimeGifType).forEach(function (key) {
            const animeGifType = AnimeGifType[key]
            option.addChoices({
                name: key,
                value: animeGifType
            })
        })

        return option
    })

module.exports = {
    data: data
}
