/** The blocks a bar is filled with. */
const fillBlocks = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']

/** The blocks a trend is drawn with. */
const trendBlocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** The cell the unfilled part of a bar is drawn with. */
const trackCell = ' '

/** The cells a bar spans. */
const defaultWidth = 14

/** The characters a label is drawn with. */
const defaultLength = 22

/** The value a number is formatted as. */
const defaultFormat = value => value.toLocaleString('en-US')

/**
 * The bar a value is drawn as.
 *
 * @param {number} value - value
 * @param {number} highest - highest
 * @param {number} [width] - width
 *
 * @returns {string}
 */
function bar(value, highest, width = defaultWidth) {
	if (!(value > 0) || !(highest > 0)) {
		return trackCell.repeat(width)
	}

	const cells = Math.min(width, (value / highest) * width)
	const filled = Math.floor(cells)
	const remainder = cells - filled
	const partial = remainder > 0 ? fillBlocks[Math.ceil(remainder * fillBlocks.length) - 1] : ''

	return `${'█'.repeat(filled)}${partial}`.padEnd(width, trackCell)
}

/**
 * The rows a set of labelled values is drawn as, scaled to the largest value.
 * Belongs in a code block.
 *
 * @param {{label: string, value: number}[]} entries - entries
 * @param {{width?: number, format?: function(number): string}} [options] - options
 *
 * @returns {string}
 */
function barChart(entries, options = {}) {
	if (!entries.length) {
		return ''
	}

	const width = options.width ?? defaultWidth
	const format = options.format ?? defaultFormat
	const highest = Math.max(...entries.map(entry => entry.value))
	const labelWidth = Math.max(...entries.map(entry => entry.label.length))
	const valueWidth = Math.max(...entries.map(entry => format(entry.value).length))

	return entries
		.map(entry => `${entry.label.padEnd(labelWidth)}  ${bar(entry.value, highest, width)}  ${format(entry.value).padStart(valueWidth)}`)
		.join('\n')
}

/**
 * The line a series is drawn as, one cell per value.
 *
 * @param {number[]} values - values
 *
 * @returns {string}
 */
function sparkline(values) {
	if (!values.length) {
		return ''
	}

	const lowest = Math.min(...values)
	const span = Math.max(...values) - lowest
	const middle = Math.floor(trendBlocks.length / 2)

	return values
		.map(value => span ? trendBlocks[Math.round(((value - lowest) / span) * (trendBlocks.length - 1))] : trendBlocks[middle])
		.join('')
}

/**
 * The line a series is drawn as, captioned with its oldest and newest value.
 * Belongs in a code block.
 *
 * @param {number[]} values - values
 * @param {{format?: function(number): string}} [options] - options
 *
 * @returns {string}
 */
function trend(values, options = {}) {
	if (!values.length) {
		return ''
	}

	const format = options.format ?? defaultFormat

	return `${format(values[0])} ${sparkline(values)} ${format(values[values.length - 1])}`
}

/**
 * The text a chart draws a label as, cut to a length and stripped of everything
 * a code block reads as markup.
 *
 * @param {string} text - text
 * @param {number} [length] - length
 *
 * @returns {string}
 */
function label(text, length = defaultLength) {
	const plain = text.replace(/[`\r\n]/g, ' ').trim()

	return plain.length > length ? `${plain.slice(0, length - 1)}…` : plain
}

module.exports = {
	bar: bar,
	barChart: barChart,
	label: label,
	sparkline: sparkline,
	trend: trend
}
