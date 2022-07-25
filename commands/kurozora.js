const { SlashCommandBuilder } = require('@discordjs/builders')
const { SearchType } = require.main.require('./enums/SearchType')

const data = new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the Kurozora catalog for anime, episodes, characters, people and studios.')
    .addStringOption(option => {
        option.setName('type')
            .setDescription('Select what to search for.')
            .setRequired(true)

        Object.keys(SearchType).forEach(function (key) {
            const searchType = SearchType[key]
            option.addChoices({
                name: key,
                value: searchType
            })
        })

        return option
    })
    .addStringOption(option =>
        option.setName('query')
            .setDescription('The search keyword.')
            .setRequired(true)
    )

module.exports = {
    data: data
}
