import type { JsonParseResult, ProseMirrorNode, TranscriptSegment } from './types';
import { CONTENT_TYPE_TO_EXTENSION } from './constants';

/**
 * Safely parse JSON with error handling
 */
export function safeJsonParse<T>(jsonString: string, context = 'JSON'): JsonParseResult<T> {
	try {
		return { data: JSON.parse(jsonString) as T, error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return { data: null, error: `Failed to parse ${context}: ${message}` };
	}
}

/**
 * Escape a string for safe inclusion in YAML
 */
export function escapeYamlValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	const str = String(value);
	// If contains special characters, wrap in quotes and escape internal quotes
	if (/[:\[\]{}#&*!|>'"%@`\n]/.test(str) || str.trim() !== str) {
		return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
	}
	return str;
}

/**
 * Format a date using a pattern string
 */
export function formatDate(date: string | Date, format: string): string {
	if (!date) return '';

	const d = new Date(date);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	const hours = String(d.getHours()).padStart(2, '0');
	const minutes = String(d.getMinutes()).padStart(2, '0');
	const seconds = String(d.getSeconds()).padStart(2, '0');

	return format
		.replace(/YYYY/g, String(year))
		.replace(/YY/g, String(year).slice(-2))
		.replace(/MM/g, month)
		.replace(/DD/g, day)
		.replace(/HH/g, hours)
		.replace(/mm/g, minutes)
		.replace(/ss/g, seconds);
}

/**
 * Format an ISO date string for datetime property (YYYY-MM-DDTHH:mm)
 */
export function formatDateTimeProperty(isoString: string): string | null {
	try {
		const date = new Date(isoString);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	} catch {
		return null;
	}
}

/**
 * Format a date with a complex pattern including day/month names
 */
export function formatDateWithPattern(date: Date, pattern: string): string {
	const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const dayNamesFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const monthNamesFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

	const year = date.getFullYear();
	const month = date.getMonth();
	const day = date.getDate();
	const dayOfWeek = date.getDay();

	// Order matters: replace longer patterns first to avoid partial matches
	return pattern
		.replace(/YYYY/g, String(year))
		.replace(/YY/g, String(year).slice(-2))
		.replace(/MMMM/g, monthNamesFull[month])
		.replace(/MMM/g, monthNames[month])
		.replace(/MM/g, String(month + 1).padStart(2, '0'))
		.replace(/M(?![ao])/g, String(month + 1))
		.replace(/dddd/g, dayNamesFull[dayOfWeek])
		.replace(/ddd/g, dayNames[dayOfWeek])
		.replace(/DD/g, String(day).padStart(2, '0'))
		.replace(/D(?![ae])/g, String(day));
}

/**
 * Format a timestamp for transcript display
 */
export function formatTimestamp(timestamp: string): string {
	const d = new Date(timestamp);
	return [d.getHours(), d.getMinutes(), d.getSeconds()]
		.map(v => String(v).padStart(2, '0'))
		.join(':');
}

/**
 * Get speaker label from transcript source
 */
export function getSpeakerLabel(source: string): string {
	switch (source) {
		case 'microphone':
			return 'Me';
		case 'system':
		default:
			return 'Them';
	}
}

/**
 * Convert transcript segments to markdown
 */
export function transcriptToMarkdown(segments: TranscriptSegment[] | null): string {
	if (!segments || segments.length === 0) {
		return '*No transcript content available*';
	}

	const sortedSegments = segments.slice().sort((a, b) => {
		const timeA = new Date(a.start_timestamp || 0);
		const timeB = new Date(b.start_timestamp || 0);
		return timeA.getTime() - timeB.getTime();
	});

	const lines: string[] = [];
	let currentSpeaker: string | null = null;
	let currentText = '';
	let currentTimestamp: string | null = null;

	const flushCurrentSegment = (): void => {
		const cleanText = currentText.trim().replace(/\s+/g, ' ');
		if (cleanText && currentSpeaker && currentTimestamp) {
			const timeStr = formatTimestamp(currentTimestamp);
			const speakerLabel = getSpeakerLabel(currentSpeaker);
			lines.push(`**${speakerLabel}** *(${timeStr})*: ${cleanText}`);
		}
		currentText = '';
		currentSpeaker = null;
		currentTimestamp = null;
	};

	for (const segment of sortedSegments) {
		if (currentSpeaker && currentSpeaker !== segment.source) {
			flushCurrentSegment();
		}
		if (!currentSpeaker) {
			currentSpeaker = segment.source;
			currentTimestamp = segment.start_timestamp;
		}
		const segmentText = segment.text;
		if (segmentText && segmentText.trim()) {
			currentText += currentText ? ` ${segmentText}` : segmentText;
		}
	}
	flushCurrentSegment();

	return lines.length === 0 ? '*No transcript content available*' : lines.join('\n\n');
}

/**
 * Convert German umlaut digraphs to proper umlauts
 * Preserves non-German names (Miguel, Michael, Joel, etc.)
 */
export function convertGermanUmlauts(name: string): string {
	if (!name) return name;

	// Patterns where ae/oe/ue should NOT be converted to umlauts
	const preservePatterns = [
		/uel([^l]|$)/i,  // Miguel, Samuel, Manuela, Samuelson
		/ael/i,           // Michael, Raphael, Israel, Michaela
		/oel/i,           // Joel, Noel
	];

	// Split by whitespace and process each word
	const words = name.split(/(\s+)/);

	return words.map(word => {
		// Preserve whitespace
		if (/^\s+$/.test(word)) return word;

		// Check if this word matches any preserve pattern
		for (const pattern of preservePatterns) {
			if (pattern.test(word)) {
				return word;
			}
		}

		// Safe to convert German umlauts in this word
		return word
			.replace(/\bAe/g, 'Ä')
			.replace(/\bOe/g, 'Ö')
			.replace(/\bUe/g, 'Ü')
			.replace(/ae/g, 'ä')
			.replace(/oe/g, 'ö')
			.replace(/ue/g, 'ü');
	}).join('');
}

/**
 * Convert ProseMirror document to Markdown
 */
export function convertProseMirrorToMarkdown(content: ProseMirrorNode): string {
	if (!content || typeof content !== 'object' || !content.content) {
		return '';
	}

	const processNode = (node: ProseMirrorNode, indentLevel = 0): string => {
		if (!node || typeof node !== 'object') {
			return '';
		}

		const nodeType = node.type || '';
		const nodeContent = node.content || [];
		const text = node.text || '';

		if (nodeType === 'heading') {
			const level = node.attrs?.level ?? 1;
			const headingText = nodeContent.map(child => processNode(child, indentLevel)).join('');
			return '#'.repeat(level) + ' ' + headingText + '\n\n';
		} else if (nodeType === 'paragraph') {
			const paraText = nodeContent.map(child => processNode(child, indentLevel)).join('');
			return paraText + '\n\n';
		} else if (nodeType === 'bulletList') {
			const items: string[] = [];
			for (const item of nodeContent) {
				if (item.type === 'listItem') {
					const processedItem = processListItem(item, indentLevel);
					if (processedItem) {
						items.push(processedItem);
					}
				}
			}
			return items.join('\n') + '\n\n';
		} else if (nodeType === 'text') {
			return text;
		} else {
			return nodeContent.map(child => processNode(child, indentLevel)).join('');
		}
	};

	return processNode(content);
}

/**
 * Process a list item node to markdown
 */
function processListItem(listItem: ProseMirrorNode, indentLevel = 0): string {
	if (!listItem || !listItem.content) {
		return '';
	}

	const indent = '  '.repeat(indentLevel);
	let itemText = '';
	let hasNestedLists = false;

	for (const child of listItem.content) {
		if (child.type === 'paragraph') {
			const paraText = (child.content || []).map(node => {
				if (node.type === 'text') {
					return node.text || '';
				}
				return '';
			}).join('').trim();
			if (paraText) {
				itemText += paraText;
			}
		} else if (child.type === 'bulletList') {
			hasNestedLists = true;
			const nestedItems: string[] = [];
			for (const nestedItem of child.content || []) {
				if (nestedItem.type === 'listItem') {
					const nestedProcessed = processListItem(nestedItem, indentLevel + 1);
					if (nestedProcessed) {
						nestedItems.push(nestedProcessed);
					}
				}
			}
			if (nestedItems.length > 0) {
				itemText += '\n' + nestedItems.join('\n');
			}
		}
	}

	if (!itemText.trim()) {
		return '';
	}

	const mainBullet = indent + '- ' + itemText.split('\n')[0];

	if (hasNestedLists) {
		const lines = itemText.split('\n');
		if (lines.length > 1) {
			const nestedLines = lines.slice(1).join('\n');
			return mainBullet + '\n' + nestedLines;
		}
	}

	return mainBullet;
}

/**
 * Get file extension from attachment type or content type
 */
export function getAttachmentExtension(
	attachment: { type?: string; url?: string; width?: number; height?: number },
	contentType?: string
): string {
	// Try content-type header first
	if (contentType) {
		const ct = contentType.toLowerCase().split(';')[0].trim();
		if (CONTENT_TYPE_TO_EXTENSION[ct]) return CONTENT_TYPE_TO_EXTENSION[ct];
		// Extract from content-type like "image/png"
		const match = ct.match(/^image\/(\w+)/);
		if (match) return match[1];
	}

	// Try attachment type field
	if (attachment.type && CONTENT_TYPE_TO_EXTENSION[attachment.type]) {
		return CONTENT_TYPE_TO_EXTENSION[attachment.type];
	}

	// Try to extract from URL
	const urlMatch = attachment.url?.match(/\.(\w{3,4})(?:\?|$)/);
	if (urlMatch) return urlMatch[1];

	// Default to png for images
	if (attachment.type === 'image' || attachment.width || attachment.height) {
		return 'png';
	}

	return 'bin';
}

/**
 * Extract name from email address
 */
export function extractNameFromEmail(email: string): string {
	return email.split('@')[0]
		.replace(/[._-]/g, ' ')
		.split(' ')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
}

/**
 * Personal email domains to exclude from company extraction
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
	'gmail.com', 'googlemail.com',
	'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
	'yahoo.com', 'yahoo.co.uk', 'yahoo.de', 'yahoo.fr',
	'icloud.com', 'me.com', 'mac.com',
	'aol.com',
	'protonmail.com', 'proton.me',
	'zoho.com',
	'mail.com',
	'gmx.com', 'gmx.de', 'gmx.net',
	'web.de',
	't-online.de',
	'posteo.de',
	'fastmail.com',
	'tutanota.com', 'tutamail.com',
]);

/**
 * Extract company name from email domain
 * Returns null for personal email domains
 */
export function extractCompanyFromEmail(email: string): string | null {
	if (!email || !email.includes('@')) return null;

	const domain = email.split('@')[1]?.toLowerCase();
	if (!domain) return null;

	// Skip personal email domains
	if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;

	// Get the company part (remove TLD)
	// e.g., actumdigital.com → actumdigital
	// e.g., vercel.com → vercel
	// e.g., company.co.uk → company
	const parts = domain.split('.');
	if (parts.length < 2) return null;

	// Handle common two-part TLDs like co.uk, com.au
	let companyPart: string;
	if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'ac'].includes(parts[parts.length - 2])) {
		companyPart = parts.slice(0, -2).join('.');
	} else {
		companyPart = parts.slice(0, -1).join('.');
	}

	if (!companyPart) return null;

	// Convert to title case and handle common patterns
	// e.g., "actumdigital" → "Actumdigital"
	// e.g., "my-company" → "My Company"
	const formatted = companyPart
		.replace(/[-_]/g, ' ')
		.split(' ')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');

	return formatted || null;
}
