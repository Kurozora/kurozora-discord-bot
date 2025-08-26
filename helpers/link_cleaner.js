const urlShorteners = require('../resources/url_shorteners.json')

class LinkCleaner {
    // MARK: - Initializers
    constructor() {}

    /**
     * Cleans links in the given message.
     *
     * @param {Message} message - Discord message object
     *
     * @returns {Promise<OmitPartialGroupDMChannel<Message<InGuild>>>}
     */
    async clean(message) {
        const regexp = /https?:\/\/\S+/g
        const links = [...message.content.matchAll(regexp)].map(m => m[0].trim())

        if (!links.length) {
            return
        }

        const cleanLinks = await Promise.all(links.map(async (link) => {
            const isShortened = this.isShortenedLink(link)
            let cleanLink = (await this.cleanUrlTracking(link, isShortened)).trim()

            // Skip Discord CDN
            if (/^(?:https?:\/\/)?(?:cdn\.discordapp\.com)\b/i.test(cleanLink)) {
                return null
            }

            // Provider-specific cleaners
            if (/^(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|t\.co)\b/i.test(cleanLink)) {
                cleanLink = this.cleanTwitterLink(cleanLink)
            } else if (/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\b/i.test(cleanLink)) {
                cleanLink = this.cleanYouTubeLink(cleanLink)
            }

            // Decode safely
            const decoded = this.safeDecode(cleanLink)
            const linkLower = link.toLowerCase()

            if (linkLower !== decoded.toLowerCase() && linkLower !== cleanLink.toLowerCase()) {
                return cleanLink
            }

            return null
        }))

        const filteredLinks = cleanLinks.filter(Boolean)

        if (!filteredLinks.length) {
            return
        }

        const thisOrThese = filteredLinks.length === 1 ? 'this' : 'these'
        const payload = filteredLinks.join('\n')
        return message.reply(`I cleaned ${thisOrThese} for you:\n${payload}`)
    }

    /**
     * Safely decodes a URL, returning the original URL if decoding fails.
     *
     * @param {string} url - URL to decode
     * @returns {string}
     */
    safeDecode(url) {
        try {
            return decodeURIComponent(url)
        } catch {
            return url
        }
    }

    /**
     * Clean tracking parameters from the given url.
     *
     * Unshortens the url if `unshort` is set to true.
     *
     * @param {string} url - Link to clean
     * @param {bool} unshort - Whether to unshorten the url. Default is false.
     * @returns {*|Promise<*>}
     */
    async cleanUrlTracking(url, unshort = false) {
        return new Promise(function (success, nosuccess) {
            const {spawn} = require('child_process')
            const pythonScript = unshort ? './python/UnshortAndCleanUrlTracking.py' : './python/CleanUrlTracking.py'
            const cleanUrlTracking = spawn('./python/.venv/bin/python', [pythonScript, url])

            cleanUrlTracking.stdout.on('data', function (data) {
                console.log('stdout', data.toString())
                success(data)
            })

            cleanUrlTracking.stderr.on('data', (data) => {
                console.error(data.toString())
                nosuccess(data)
            })
        })
            .then(response => response.toString())
    }

    /**
     * Determines whether the given url is shortened link.
     *
     * @param url
     * @returns {bool}
     */
    isShortenedLink(url) {
        const shortenerDomains = urlShorteners.domains
        const hostname = new URL(url).hostname
        return shortenerDomains.some(domain => hostname.endsWith(domain))
    }

    /**
     * Further cleans Twitter URLs.
     *
     * @param link
     * @returns {string}
     */
    cleanTwitterLink(link) {
        let url = new URL(link)
        url.searchParams.delete('t')
        url.searchParams.delete('s')
        return url.href
    }

    /**
     * Further cleans YouTube URLs.
     *
     * @param link
     * @returns {string}
     */
    cleanYouTubeLink(link) {
        let url = new URL(link)
        url.searchParams.delete('si')
        return url.href
    }
}

module.exports = {
    LinkCleaner: LinkCleaner
}
