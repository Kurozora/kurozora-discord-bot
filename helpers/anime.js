const axios = require('axios')
const { Client, MessageEmbed } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { SearchType } = require.main.require('./enums/SearchType')
const { CharacterStatus } = require.main.require('./enums/CharacterStatus')
const apiURL = process.env['KISARA_URL']

class AnimeManager {
    // MARK: - Properties
    /**
     * @param {Client} client - client
     */
    client

    /**
     * @param {REST} rest - rest
     */
    rest

    // MARK: - Initializers
    /**
     * @constructor
     *
     * @param {Client} client - Client
     * @param {REST} rest - Rest
     */
    constructor(client, rest) {
        this.client = client
        this.rest = rest
    }

    // MARK: - Functions
    /**
     * Search the Kurozora catalog.
     *
     * @param {Interaction} interaction - interaction
     * @param {string} type - search type
     *
     * @returns {Object<string, *>} data - data
     */
    async search(interaction, type) {
        await interaction.deferReply()
        const {url} = await this.searchForType(type)
        return interaction.editReply({files: [url]})
    }

    /**
     * Search the Kurozora catalog.
     *
     * @param {string} type - type
     *
     * @returns {Object<string, *>} data - data
     */
    async searchForType(type) {
        let url = apiURL + '/' + type
        const response = await axios.get(url)
            .then(response => response.data)
            .catch(function(error) {
                console.error(error)
                return `No results were found for ${url} :(`
            })

        if (!response) {
            return this.search(type)
        }

        return response
    }
}

module.exports = {
    AnimeManager: AnimeManager
}
