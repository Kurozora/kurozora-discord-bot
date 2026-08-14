const axios = require('axios')
const appNickname = process.env['APP_NICKNAME']
const appURL = process.env['APP_URL']

/** The user agent sent with every catalogue request. */
const userAgent = `${appNickname} (${appURL})`

/** The Deezer catalogue endpoint. */
const deezerAPIURL = 'https://api.deezer.com'

/** The MusicBrainz catalogue endpoint. */
const musicBrainzAPIURL = 'https://musicbrainz.org/ws/2'

/** The iTunes catalogue endpoint. */
const iTunesAPIURL = 'https://itunes.apple.com'

/** The Spotify oEmbed endpoint. */
const spotifyOEmbedURL = 'https://open.spotify.com/oembed'

/** The duration a catalogue request has to respond. */
const requestTimeout = 5000

/** The duration a resolved entry stays cached. */
const cacheDuration = 6 * 60 * 60 * 1000

/** The number of entries held in the cache. */
const maxCacheSize = 500

/** The duration MusicBrainz asks callers to wait between requests. */
const musicBrainzInterval = 1200

/** The number of times a throttled MusicBrainz request is retried. */
const musicBrainzRetries = 2

/** The difference in duration two recordings may have and still count as the same one. */
const durationTolerance = 5000

/** The number of iTunes results considered when matching a recording. */
const iTunesResultCount = 5

/** The storefront iTunes is searched in. */
const iTunesStorefront = 'us'

/** The resolved entries, by key. */
const entries = new Map()

/** The tail of the MusicBrainz request chain. */
let musicBrainzTurn = Promise.resolve()

/**
 * The cached value for the given key, if it hasn’t expired.
 *
 * @param {string} key - key
 *
 * @returns {*} value - value
 */
function cachedValue(key) {
	const entry = entries.get(key)

	if (!entry) {
		return undefined
	}

	if (entry.expiresAt < Date.now()) {
		entries.delete(key)
		return undefined
	}

	return entry.value
}

/**
 * Caches the given value under the given key.
 *
 * @param {string} key - key
 * @param {*} value - value
 *
 * @returns {*} value - value
 */
function remember(key, value) {
	if (entries.size >= maxCacheSize) {
		entries.delete(entries.keys().next().value)
	}

	entries.set(key, { value: value, expiresAt: Date.now() + cacheDuration })
	return value
}

/**
 * Resolves after the given duration.
 *
 * @param {number} duration - duration
 *
 * @returns {Promise<void>}
 */
function wait(duration) {
	return new Promise(resolve => setTimeout(resolve, duration))
}

/**
 * Runs the given work no faster than MusicBrainz allows.
 *
 * @param {() => Promise<*>} work - work
 *
 * @returns {Promise<*>} result - result
 */
function throttled(work) {
	const result = musicBrainzTurn.then(work, work)

	musicBrainzTurn = result
		.catch(() => undefined)
		.then(() => wait(musicBrainzInterval))

	return result
}

/**
 * Fetches a catalogue endpoint.
 *
 * @param {string} url - url
 * @param {Object} params - params
 * @param {string} service - service
 *
 * @returns {Promise<*>} body - body
 */
async function request(url, params, service) {
	return axios.get(url, {
		params: params,
		headers: { 'User-Agent': userAgent },
		timeout: requestTimeout
	})
		.then(response => response.data)
		.catch(error => {
			console.error(`[${service}] Couldn’t fetch ${url}: ${error.message}`)
			return null
		})
}

/**
 * Fetches a MusicBrainz endpoint, retrying while it is throttled.
 *
 * @param {string} url - url
 * @param {Object} params - params
 *
 * @returns {Promise<*>} body - body
 */
async function musicBrainzRequest(url, params) {
	for (let attempt = 0; attempt <= musicBrainzRetries; attempt++) {
		const response = await throttled(() => axios.get(url, {
			params: params,
			headers: { 'User-Agent': userAgent },
			timeout: requestTimeout
		}).catch(error => error.response ?? { status: 0, statusText: error.message }))

		if (response.status === 200) {
			return response.data
		}

		if (response.status !== 503 && response.status !== 429) {
			if (response.status !== 404) {
				console.error(`[MusicBrainz] Couldn’t fetch ${url}: ${response.status || response.statusText}`)
			}

			return null
		}

		await wait(musicBrainzInterval * (attempt + 1))
	}

	console.error(`[MusicBrainz] Gave up on ${url} after ${musicBrainzRetries + 1} throttled attempts.`)
	return null
}

/**
 * The given text, reduced to the form titles are compared in.
 *
 * @param {?string} text - text
 *
 * @returns {string} text - text
 */
function comparable(text) {
	return (text ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\([^)]*\)|\[[^\]]*\]|[\uff08][^\uff09]*[\uff09]/g, ' ')
		.replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+/g, ' ')
		.trim()
}

/**
 * The qualifier the given title carries, such as “Original Version” or “TV Size”.
 *
 * @param {?string} title - title
 *
 * @returns {string} qualifier - qualifier
 */
function qualifierIn(title) {
	const qualifiers = [...(title ?? '').matchAll(/\(([^)]*)\)|\[([^\]]*)\]|[（]([^）]*)[）]/g)]
		.map(match => match[1] ?? match[2] ?? match[3])

	return comparable(qualifiers.join(' '))
}

/**
 * Whether the two titles name the same recording.
 *
 * Titles carrying a differing qualifier, such as “Original Version” and “English Version”,
 * name different recordings.
 *
 * @param {?string} lhs - lhs
 * @param {?string} rhs - rhs
 *
 * @returns {boolean} sameTitle - same title
 */
function sameTitle(lhs, rhs) {
	if (comparable(lhs) !== comparable(rhs)) {
		return false
	}

	const left = qualifierIn(lhs)
	const right = qualifierIn(rhs)

	return !left.length || !right.length || left === right
}

/**
 * Whether the two names refer to the same artist.
 *
 * @param {?string} lhs - lhs
 * @param {?string} rhs - rhs
 *
 * @returns {boolean} sameArtist - same artist
 */
function sameArtist(lhs, rhs) {
	const left = comparable(lhs)
	const right = comparable(rhs)

	if (!left.length || !right.length) {
		return false
	}

	return left.includes(right) || right.includes(left)
}

/**
 * Whether the two durations are close enough to be the same recording.
 *
 * @param {?number} lhs - lhs
 * @param {?number} rhs - rhs
 *
 * @returns {boolean} sameDuration - same duration
 */
function sameDuration(lhs, rhs) {
	if (!lhs || !rhs) {
		return false
	}

	return Math.abs(lhs - rhs) <= durationTolerance
}

/**
 * The YouTube video id in the given url.
 *
 * @param {string} url - url
 *
 * @returns {?string} id - id
 */
function youtubeIDIn(url) {
	const match = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/.exec(url)
	return match ? match[1] : null
}

/**
 * The YouTube video ids in the given urls, official uploads before art tracks.
 *
 * @param {string[]} urls - urls
 *
 * @returns {string[]} ids - ids
 */
function youtubeIDsIn(urls) {
	const official = []
	const artTracks = []

	for (const url of urls) {
		const id = youtubeIDIn(url)

		if (id) {
			(url.includes('music.youtube.com') ? artTracks : official).push(id)
		}
	}

	return [...new Set([...official, ...artTracks])]
}

/**
 * The given Deezer track, normalized.
 *
 * @param {Object} track - track
 *
 * @returns {Object} track - track
 */
function normalized(track) {
	return {
		id: String(track.id),
		title: track.title || track.title_short || '',
		artist: track.artist?.name ?? '',
		album: track.album?.title ?? '',
		durationMS: (track.duration ?? 0) * 1000,
		artwork: track.album?.cover_big ?? track.album?.cover_medium ?? null,
		preview: track.preview ?? null,
		isrc: track.isrc ?? null,
		deezer: track.link ?? null
	}
}

/**
 * The links the given urls hold, by service.
 *
 * @param {string[]} urls - urls
 *
 * @returns {Object} links - links
 */
function linksIn(urls) {
	return {
		spotify: [...new Set(urls.filter(url => url.includes('open.spotify.com/track/')))],
		appleMusic: [...new Set(urls.filter(url => url.includes('music.apple.com/')))],
		tidal: urls.find(url => url.includes('tidal.com/')) ?? null,
		youtube: youtubeIDsIn(urls)
	}
}

/**
 * Searches Deezer for the given query.
 *
 * @param {string} query - query
 * @param {number} limit - limit
 *
 * @returns {Promise<Object[]>} tracks - tracks
 */
async function searchTracks(query, limit) {
	const term = query.trim()

	if (!term.length) {
		return []
	}

	const key = `search:${limit}:${term.toLowerCase()}`
	const remembered = cachedValue(key)

	if (remembered) {
		return remembered
	}

	const body = await request(`${deezerAPIURL}/search`, { q: term, limit: limit }, 'Deezer')
	const tracks = (body?.data ?? [])
		.filter(track => track?.id && track?.readable !== false)
		.map(normalized)

	return remember(key, tracks)
}

/**
 * The Deezer track with the given id, including its ISRC.
 *
 * @param {string} id - id
 *
 * @returns {Promise<?Object>} track - track
 */
async function trackByID(id) {
	const key = `track:${id}`
	const remembered = cachedValue(key)

	if (remembered !== undefined) {
		return remembered
	}

	const body = await request(`${deezerAPIURL}/track/${id}`, {}, 'Deezer')

	if (!body || body.error || !body.id) {
		return remember(key, null)
	}

	return remember(key, normalized(body))
}

/**
 * The links MusicBrainz holds for the given ISRC.
 *
 * @param {string} isrc - isrc
 *
 * @returns {Promise<Object>} links - links
 */
async function linksForISRC(isrc) {
	const key = `isrc:${isrc}`
	const remembered = cachedValue(key)

	if (remembered) {
		return remembered
	}

	const body = await musicBrainzRequest(
		`${musicBrainzAPIURL}/isrc/${encodeURIComponent(isrc)}`,
		{ inc: 'url-rels', fmt: 'json' }
	)

	const urls = (body?.recordings ?? [])
		.flatMap(recording => recording.relations ?? [])
		.map(relation => relation.url?.resource)
		.filter(Boolean)

	return remember(key, linksIn(urls))
}

/**
 * The Apple Music link for the given track.
 *
 * Nothing is returned unless the title, artist and duration all agree.
 *
 * @param {Object} track - track
 *
 * @returns {Promise<?string>} url - url
 */
async function appleMusicFor(track) {
	const term = `${track.artist} ${track.title}`.trim()

	if (!term.length) {
		return null
	}

	const key = `itunes:${term.toLowerCase()}`
	const remembered = cachedValue(key)

	if (remembered !== undefined) {
		return remembered
	}

	const body = await request(`${iTunesAPIURL}/search`, {
		term: term,
		entity: 'song',
		limit: iTunesResultCount,
		country: iTunesStorefront
	}, 'iTunes')

	const match = (body?.results ?? []).find(result =>
		sameTitle(result.trackName, track.title) &&
		sameArtist(result.artistName, track.artist) &&
		sameDuration(result.trackTimeMillis, track.durationMS))

	if (!match?.trackViewUrl) {
		return remember(key, null)
	}

	return remember(key, match.trackViewUrl.replace(/\\/g, '').replace(/[?&]uo=\d+/, ''))
}

/**
 * Every link the bot can offer for the given track.
 *
 * @param {Object} track - track
 *
 * @returns {Promise<Object>} links - links
 */
async function linksFor(track) {
	const key = `links:${track.id}`
	const remembered = cachedValue(key)

	if (remembered) {
		return remembered
	}

	const curated = track.isrc
		? await linksForISRC(track.isrc)
		: { spotify: [], appleMusic: [], tidal: null, youtube: [] }

	const appleMusic = [...curated.appleMusic]

	if (!appleMusic.length) {
		const matched = await appleMusicFor(track)

		if (matched) {
			appleMusic.push(matched)
		}
	}

	return remember(key, {
		spotify: curated.spotify[0] ?? null,
		spotifyAll: curated.spotify,
		appleMusic: appleMusic[0] ?? null,
		appleMusicAll: appleMusic,
		tidal: curated.tidal,
		youtube: curated.youtube,
		deezer: track.deezer
	})
}

/**
 * The Apple Music songs matching the given track.
 *
 * @param {Object} track - track
 * @param {number} limit - limit
 *
 * @returns {Promise<Object[]>} songs - songs
 */
async function appleCandidatesFor(track, limit) {
	const term = `${track.artist} ${track.title}`.trim()

	if (!term.length) {
		return []
	}

	const key = `itunes:candidates:${limit}:${term.toLowerCase()}`
	const remembered = cachedValue(key)

	if (remembered) {
		return remembered
	}

	const body = await request(`${iTunesAPIURL}/search`, {
		term: term,
		entity: 'song',
		limit: limit,
		country: iTunesStorefront
	}, 'iTunes')

	const candidates = (body?.results ?? [])
		.filter(result => result.trackId && result.trackName)
		.map(result => ({
			url: `https://music.apple.com/${iTunesStorefront}/song/${result.trackId}`,
			title: result.trackName,
			artist: result.artistName ?? '',
			album: result.collectionName ?? '',
			durationMS: result.trackTimeMillis ?? 0
		}))

	return remember(key, candidates)
}

/**
 * The title Spotify gives the track at the given url.
 *
 * @param {string} url - url
 *
 * @returns {Promise<?string>} title - title
 */
async function spotifyTitleFor(url) {
	const key = `spotify:title:${url}`
	const remembered = cachedValue(key)

	if (remembered !== undefined) {
		return remembered
	}

	const body = await request(spotifyOEmbedURL, { url: url }, 'Spotify')

	return remember(key, body?.title ?? null)
}

/**
 * The search pages to fall back on when a track has no direct link.
 *
 * @param {Object} track - track
 *
 * @returns {Object} urls - urls
 */
function searchURLsFor(track) {
	const term = encodeURIComponent(`${track.artist} ${track.title}`.trim())

	return {
		youtube: `https://www.youtube.com/results?search_query=${term}`,
		spotify: `https://open.spotify.com/search/${term}`,
		appleMusic: `https://music.apple.com/${iTunesStorefront}/search?term=${term}`
	}
}

/**
 * The watch url of the given YouTube video.
 *
 * @param {string} id - id
 *
 * @returns {string} url - url
 */
function youtubeURLFor(id) {
	return `https://www.youtube.com/watch?v=${id}`
}

module.exports = {
	searchTracks: searchTracks,
	trackByID: trackByID,
	linksFor: linksFor,
	appleCandidatesFor: appleCandidatesFor,
	spotifyTitleFor: spotifyTitleFor,
	searchURLsFor: searchURLsFor,
	youtubeURLFor: youtubeURLFor,
	youtubeIDIn: youtubeIDIn,
	comparable: comparable,
	sameTitle: sameTitle,
	sameArtist: sameArtist,
	sameDuration: sameDuration
}
