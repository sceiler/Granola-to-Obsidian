const obsidian = require('obsidian');
const path = require('path');
const fs = require('fs');

// Constants
const API_BATCH_SIZE = 100;
const MAX_DOCUMENT_LIMIT = 1000;
const MIN_DOCUMENT_LIMIT = 1;

/**
 * Safely parse JSON with error handling
 * @param {string} jsonString - The JSON string to parse
 * @param {string} context - Description of what's being parsed for error messages
 * @returns {{data: any, error: string|null}} Parsed data or error message
 */
function safeJsonParse(jsonString, context = 'JSON') {
	try {
		return { data: JSON.parse(jsonString), error: null };
	} catch (error) {
		return { data: null, error: `Failed to parse ${context}: ${error.message}` };
	}
}

/**
 * Escape a string for safe inclusion in YAML
 * @param {string} value - The value to escape
 * @returns {string} Escaped string safe for YAML
 */
function escapeYamlValue(value) {
	if (value === null || value === undefined) return '';
	const str = String(value);
	// If contains special characters, wrap in quotes and escape internal quotes
	if (/[:\[\]{}#&*!|>'"%@`\n]/.test(str) || str.trim() !== str) {
		return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
	}
	return str;
}

function getDefaultAuthPath() {
	if (obsidian.Platform.isWin) {
		return 'AppData/Roaming/Granola/supabase.json';
	} else if (obsidian.Platform.isLinux) {
		return '.config/Granola/supabase.json';
	} else {
		return 'Library/Application Support/Granola/supabase.json';
	}
}

const DEFAULT_SETTINGS = {
	syncDirectory: 'Notes',
	authKeyPath: getDefaultAuthPath(),
	filenameTemplate: '{created_date}_{title}',
	dateFormat: 'YYYY-MM-DD',
	autoSyncFrequency: 300000,
	skipExistingNotes: true,
	existingFileAction: 'timestamp',
	filenameSeparator: ' ',
	slashReplacement: '&',
	documentSyncLimit: 100,
	includeFullTranscript: false,
	includeMyNotes: true,
	includeEnhancedNotes: true,
	// Frontmatter options
	includeGranolaUrl: true,
	includeEmails: true,
	attendeeFilter: 'all', // 'all', 'accepted', 'accepted_tentative', 'exclude_declined'
	excludeMyNameFromPeople: true,
	autoDetectMyName: true,
	myName: '',
	// Location detection
	enableLocationDetection: true,
	// Attachments
	downloadAttachments: true,
	// Custom frontmatter template fields
	enableCustomFrontmatter: true,
	customCategory: '[[Meetings]]',
	customTags: 'meetings',
	// Daily note integration
	enableDailyNoteIntegration: true,
	dailyNoteSectionName: '## Granola Meetings',
};

class GranolaSyncPlugin extends obsidian.Plugin {
	async onload() {
		this.autoSyncInterval = null;
		this.settings = DEFAULT_SETTINGS;
		this.statusBarItem = null;
		this.ribbonIconEl = null;

		try {
			const data = await this.loadData();
			if (data) {
				this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
			}
		} catch (error) {
			// Could not load settings, using defaults
		}

		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar('Idle');

		this.ribbonIconEl = this.addRibbonIcon('sync', 'Sync Granola notes', () => {
			this.syncNotes();
		});

		this.addCommand({
			id: 'sync-granola-notes',
			name: 'Sync Granola Notes',
			callback: () => {
				this.syncNotes();
			}
		});

		this.addSettingTab(new GranolaSyncSettingTab(this.app, this));

		window.setTimeout(() => {
			this.setupAutoSync();
		}, 1000);
	}

	onunload() {
		this.clearAutoSync();
		// Clean up UI elements to prevent memory leaks on plugin reload
		if (this.statusBarItem) {
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}
	}

	async saveSettings() {
		try {
			await this.saveData(this.settings);
			this.setupAutoSync();
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	}

	updateStatusBar(status, count) {
		if (!this.statusBarItem) return;

		let text = 'Granola: ';

		if (status === 'Idle') {
			text += 'Idle';
		} else if (status === 'Syncing') {
			if (typeof count === 'string') {
				text += count;
			} else {
				text += 'Syncing...';
			}
		} else if (status === 'Complete') {
			text += count + ' synced';
			window.setTimeout(() => {
				this.updateStatusBar('Idle');
			}, 3000);
		} else if (status === 'Error') {
			text += 'Error - ' + (count || 'sync failed');
			window.setTimeout(() => {
				this.updateStatusBar('Idle');
			}, 5000);
		}

		this.statusBarItem.setText(text);
	}

	setupAutoSync() {
		this.clearAutoSync();

		if (this.settings.autoSyncFrequency > 0) {
			this.autoSyncInterval = window.setInterval(() => {
				this.syncNotes().catch(error => {
					console.error('Auto-sync failed:', error.message);
					this.updateStatusBar('Error', 'auto-sync failed');
				});
			}, this.settings.autoSyncFrequency);
		}
	}

	clearAutoSync() {
		if (this.autoSyncInterval) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}
	}

	getSpeakerLabel(source) {
		switch (source) {
			case "microphone":
				return "Me";
			case "system":
			default:
				return "Them";
		}
	}

	formatTimestamp(timestamp) {
		const d = new Date(timestamp);
		return [d.getHours(), d.getMinutes(), d.getSeconds()]
			.map(v => String(v).padStart(2, '0'))
			.join(':');
	}

	transcriptToMarkdown(segments) {
		if (!segments || segments.length === 0) {
			return "*No transcript content available*";
		}

		const sortedSegments = segments.slice().sort((a, b) => {
			const timeA = new Date(a.start_timestamp || 0);
			const timeB = new Date(b.start_timestamp || 0);
			return timeA - timeB;
		});

		const lines = [];
		let currentSpeaker = null;
		let currentText = "";
		let currentTimestamp = null;

		const flushCurrentSegment = () => {
			const cleanText = currentText.trim().replace(/\s+/g, " ");
			if (cleanText && currentSpeaker) {
				const timeStr = this.formatTimestamp(currentTimestamp);
				const speakerLabel = this.getSpeakerLabel(currentSpeaker);
				lines.push(`**${speakerLabel}** *(${timeStr})*: ${cleanText}`)
			}
			currentText = "";
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

		return lines.length === 0 ? "*No transcript content available*" : lines.join("\n\n");
	}

	async syncNotes() {
		try {
			this.updateStatusBar('Syncing');

			await this.ensureDirectoryExists();

			const token = await this.loadCredentials();
			if (!token) {
				this.updateStatusBar('Error', 'credentials failed');
				return;
			}

			const documents = await this.fetchGranolaDocuments(token);
			if (!documents) {
				this.updateStatusBar('Error', 'fetch failed');
				return;
			}

			let syncedCount = 0;
			const todaysNotes = [];
			const today = new Date().toDateString();

			for (let i = 0; i < documents.length; i++) {
				const doc = documents[i];
				try {
					if (this.settings.includeFullTranscript) {
						const transcriptData = await this.fetchTranscript(token, doc.id);
						doc.transcript = this.transcriptToMarkdown(transcriptData);
					}

					const success = await this.processDocument(doc, token);
					if (success) {
						syncedCount++;
					}

					// Track today's notes for daily note integration
					if (this.settings.enableDailyNoteIntegration && doc.created_at) {
						const noteDate = new Date(doc.created_at).toDateString();
						if (noteDate === today) {
							const actualFile = await this.findExistingNoteByGranolaId(doc.id);
							if (actualFile) {
								const createdDate = new Date(doc.created_at);
								const hours = String(createdDate.getHours()).padStart(2, '0');
								const minutes = String(createdDate.getMinutes()).padStart(2, '0');
								todaysNotes.push({
									title: doc.title || 'Untitled Granola Note',
									actualFilePath: actualFile.path,
									time: hours + ':' + minutes
								});
							}
						}
					}
				} catch (error) {
					console.error('Error processing document ' + doc.title + ':', error);
				}
			}

			// Update daily note with today's meetings
			if (this.settings.enableDailyNoteIntegration && todaysNotes.length > 0) {
				await this.updateDailyNote(todaysNotes);
			}

			this.updateStatusBar('Complete', syncedCount);

		} catch (error) {
			console.error('Granola sync failed:', error);
			this.updateStatusBar('Error', 'sync failed');
		}
	}

	async loadCredentials() {
		const homedir = require('os').homedir();
		const authPaths = [
			path.resolve(homedir, 'Users', require('os').userInfo().username, 'Library/Application Support/Granola/supabase.json'),
			path.resolve(homedir, this.settings.authKeyPath),
			path.resolve(homedir, 'Library/Application Support/Granola/supabase.json')
		];

		for (const authPath of authPaths) {
			try {
				if (!fs.existsSync(authPath)) {
					continue;
				}

				let credentialsFile;
				try {
					credentialsFile = fs.readFileSync(authPath, 'utf8');
				} catch (readError) {
					console.error('Failed to read credentials file:', readError.message);
					continue;
				}

				const { data, error: parseError } = safeJsonParse(credentialsFile, 'Granola credentials file');
				if (parseError) {
					console.error(parseError);
					continue;
				}

				let accessToken = null;

				if (data.workos_tokens) {
					// workos_tokens may be a string (needs parsing) or already an object
					if (typeof data.workos_tokens === 'string') {
						const { data: workosTokens, error: workosError } = safeJsonParse(data.workos_tokens, 'WorkOS tokens');
						if (!workosError && workosTokens) {
							accessToken = workosTokens.access_token;
						}
					} else if (typeof data.workos_tokens === 'object') {
						accessToken = data.workos_tokens.access_token;
					}
				}

				if (!accessToken && data.cognito_tokens) {
					// cognito_tokens may be a string (needs parsing) or already an object
					if (typeof data.cognito_tokens === 'string') {
						const { data: cognitoTokens, error: cognitoError } = safeJsonParse(data.cognito_tokens, 'Cognito tokens');
						if (!cognitoError && cognitoTokens) {
							accessToken = cognitoTokens.access_token;
						}
					} else if (typeof data.cognito_tokens === 'object') {
						accessToken = data.cognito_tokens.access_token;
					}
				}

				if (accessToken) {
					return accessToken;
				}
			} catch (error) {
				console.error('Error loading credentials:', error.message);
				continue;
			}
		}

		console.error('No valid Granola credentials found. Please ensure Granola is installed and you are logged in.');
		return null;
	}

	async fetchGranolaDocuments(token) {
		try {
			const allDocs = [];
			let offset = 0;
			let hasMore = true;
			const maxDocuments = this.settings.documentSyncLimit;

			while (hasMore && allDocs.length < maxDocuments) {
				const response = await obsidian.requestUrl({
					url: 'https://api.granola.ai/v2/get-documents',
					method: 'POST',
					headers: {
						'Authorization': 'Bearer ' + token,
						'Content-Type': 'application/json',
						'Accept': '*/*',
						'User-Agent': 'Granola/5.354.0',
						'X-Client-Version': '5.354.0'
					},
					body: JSON.stringify({
						limit: API_BATCH_SIZE,
						offset: offset,
						include_last_viewed_panel: true,
						include_panels: true
					})
				});

				const apiResponse = response.json;

				if (!apiResponse || !apiResponse.docs) {
					return allDocs.length > 0 ? allDocs : null;
				}

				const docs = apiResponse.docs;
				allDocs.push(...docs);

				if (docs.length < API_BATCH_SIZE || allDocs.length >= maxDocuments) {
					hasMore = false;
				} else {
					offset += API_BATCH_SIZE;
				}

				if (allDocs.length > 100) {
					this.updateStatusBar('Syncing', `${allDocs.length} docs fetched`);
				}
			}

			if (allDocs.length > maxDocuments) {
				allDocs.length = maxDocuments;
			}

			return allDocs;
		} catch (error) {
			console.error('Error fetching documents:', error);
			return null;
		}
	}

	async fetchTranscript(token, docId) {
		try {
			const response = await obsidian.requestUrl({
				url: `https://api.granola.ai/v1/get-document-transcript`,
				method: 'POST',
				headers: {
					'Authorization': 'Bearer ' + token,
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify({
					'document_id': docId
				})
			});

			return response.json;

		} catch (error) {
			console.error('Error fetching transcript for document ' + docId + ':' + error);
			return null;
		}
	}

	convertProseMirrorToMarkdown(content) {
		if (!content || typeof content !== 'object' || !content.content) {
			return '';
		}

		const processNode = (node, indentLevel = 0) => {
			if (!node || typeof node !== 'object') {
				return '';
			}

			const nodeType = node.type || '';
			const nodeContent = node.content || [];
			const text = node.text || '';

			if (nodeType === 'heading') {
				const level = node.attrs && node.attrs.level ? node.attrs.level : 1;
				const headingText = nodeContent.map(child => processNode(child, indentLevel)).join('');
				return '#'.repeat(level) + ' ' + headingText + '\n\n';
			} else if (nodeType === 'paragraph') {
				const paraText = nodeContent.map(child => processNode(child, indentLevel)).join('');
				return paraText + '\n\n';
			} else if (nodeType === 'bulletList') {
				const items = [];
				for (let i = 0; i < nodeContent.length; i++) {
					const item = nodeContent[i];
					if (item.type === 'listItem') {
						const processedItem = this.processListItem(item, indentLevel);
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

	processListItem(listItem, indentLevel = 0) {
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
				const nestedItems = [];
				for (const nestedItem of child.content || []) {
					if (nestedItem.type === 'listItem') {
						const nestedProcessed = this.processListItem(nestedItem, indentLevel + 1);
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

	formatDate(date, format) {
		if (!date) return '';

		const d = new Date(date);
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		const hours = String(d.getHours()).padStart(2, '0');
		const minutes = String(d.getMinutes()).padStart(2, '0');
		const seconds = String(d.getSeconds()).padStart(2, '0');

		return format
			.replace(/YYYY/g, year)
			.replace(/YY/g, String(year).slice(-2))
			.replace(/MM/g, month)
			.replace(/DD/g, day)
			.replace(/HH/g, hours)
			.replace(/mm/g, minutes)
			.replace(/ss/g, seconds);
	}

	formatDateTimeProperty(isoString) {
		try {
			const date = new Date(isoString);
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			const hours = String(date.getHours()).padStart(2, '0');
			const minutes = String(date.getMinutes()).padStart(2, '0');
			return `${year}-${month}-${day}T${hours}:${minutes}`;
		} catch (error) {
			return null;
		}
	}

	generateFilename(doc) {
		const title = doc.title || 'Untitled Granola Note';
		const docId = doc.id || 'unknown_id';

		let createdDate = '';
		let updatedDate = '';
		let createdTime = '';
		let updatedTime = '';
		let createdDateTime = '';
		let updatedDateTime = '';

		if (doc.created_at) {
			createdDate = this.formatDate(doc.created_at, this.settings.dateFormat);
			createdTime = this.formatDate(doc.created_at, 'HH-mm-ss');
			createdDateTime = this.formatDate(doc.created_at, this.settings.dateFormat + '_HH-mm-ss');
		}

		if (doc.updated_at) {
			updatedDate = this.formatDate(doc.updated_at, this.settings.dateFormat);
			updatedTime = this.formatDate(doc.updated_at, 'HH-mm-ss');
			updatedDateTime = this.formatDate(doc.updated_at, this.settings.dateFormat + '_HH-mm-ss');
		}

		let filename = this.settings.filenameTemplate
			.replace(/{title}/g, title)
			.replace(/{id}/g, docId)
			.replace(/{created_date}/g, createdDate)
			.replace(/{updated_date}/g, updatedDate)
			.replace(/{created_time}/g, createdTime)
			.replace(/{updated_time}/g, updatedTime)
			.replace(/{created_datetime}/g, createdDateTime)
			.replace(/{updated_datetime}/g, updatedDateTime);

		// Replace slashes with configured replacement (e.g., "Jane / John" → "Jane & John")
		if (this.settings.slashReplacement) {
			filename = filename.replace(/\s*\/\s*/g, ` ${this.settings.slashReplacement} `);
		} else {
			filename = filename.replace(/\s*\/\s*/g, ' ');
		}

		// Remove remaining characters that are invalid in filenames
		const invalidChars = /[:\\|?*"]/g;
		filename = filename.replace(invalidChars, '');
		filename = filename.replace(/\s+/g, this.settings.filenameSeparator);

		return filename;
	}

	convertGermanUmlauts(name) {
		if (!name) return name;

		// Patterns where ae/oe/ue should NOT be converted to umlauts
		// These are common in Spanish, Portuguese, Hebrew, and English names
		const preservePatterns = [
			/uel([^l]|$)/i,  // Miguel, Samuel, Manuela, Samuelson (uel not followed by another l)
			/ael/i,           // Michael, Raphael, Israel, Michaela (any ael)
			/oel/i,           // Joel, Noel (any oel)
		];

		// Split by whitespace and process each word
		const words = name.split(/(\s+)/);

		return words.map(word => {
			// Preserve whitespace
			if (/^\s+$/.test(word)) return word;

			// Check if this word matches any preserve pattern
			for (const pattern of preservePatterns) {
				if (pattern.test(word)) {
					return word; // Don't convert this word
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
	 * Extract unique company names from document attendees
	 */
	extractCompanyNames(doc) {
		const companies = new Set();
		const responseStatusMap = this.buildResponseStatusMap(doc);

		try {
			// Extract from people.attendees
			if (doc.people && doc.people.attendees && Array.isArray(doc.people.attendees)) {
				for (const attendee of doc.people.attendees) {
					// Check response status filter using email lookup
					const email = attendee.email ? attendee.email.toLowerCase() : null;
					const responseStatus = email ? responseStatusMap.get(email) : null;
					if (!this.shouldIncludeAttendee(responseStatus)) {
						continue;
					}

					if (attendee.details && attendee.details.company && attendee.details.company.name) {
						const companyName = attendee.details.company.name.trim();
						if (companyName) {
							companies.add(companyName);
						}
					}
				}
			}

			// Also check creator's company
			if (doc.people && doc.people.creator) {
				const creator = doc.people.creator;
				if (creator.details && creator.details.company && creator.details.company.name) {
					const companyName = creator.details.company.name.trim();
					if (companyName) {
						companies.add(companyName);
					}
				}
			}
		} catch (error) {
			console.error('Error extracting company names:', error);
		}

		return Array.from(companies);
	}

	/**
	 * Detect meeting platform from calendar event location or conference data
	 * Returns wiki link format: [[Zoom]], [[Google Meet]], [[Teams]], or empty string
	 */
	detectMeetingPlatform(doc) {
		if (!this.settings.enableLocationDetection) {
			return '';
		}

		try {
			const calendarEvent = doc.google_calendar_event;
			if (!calendarEvent) {
				return '';
			}

			// Check location field
			const location = (calendarEvent.location || '').toLowerCase();

			// Check conference data entry points
			let conferenceUrls = [];
			if (calendarEvent.conferenceData && calendarEvent.conferenceData.entryPoints) {
				conferenceUrls = calendarEvent.conferenceData.entryPoints
					.filter(ep => ep.uri)
					.map(ep => ep.uri.toLowerCase());
			}

			// Combine all URLs to check
			const allUrls = [location, ...conferenceUrls].join(' ');

			// Detect platform
			if (allUrls.includes('zoom.us') || allUrls.includes('zoom.com')) {
				return '[[Zoom]]';
			}
			if (allUrls.includes('meet.google.com') || allUrls.includes('hangouts.google.com')) {
				return '[[Google Meet]]';
			}
			if (allUrls.includes('teams.microsoft.com') || allUrls.includes('teams.live.com')) {
				return '[[Teams]]';
			}

			// No recognized platform - return empty (could be in-person, phone, etc.)
			return '';
		} catch (error) {
			console.error('Error detecting meeting platform:', error);
			return '';
		}
	}

	/**
	 * Auto-detect the current user's name from the document
	 * Uses the attendee with self: true flag
	 */
	getMyNameFromDocument(doc) {
		try {
			// First check google_calendar_event.attendees for self: true
			if (doc.google_calendar_event && doc.google_calendar_event.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.self === true) {
						// Found self, now get the full name from people.attendees or people.creator
						const selfEmail = attendee.email?.toLowerCase();

						// Check if self is the creator
						if (doc.people && doc.people.creator) {
							const creatorEmail = doc.people.creator.email?.toLowerCase();
							if (creatorEmail === selfEmail) {
								if (doc.people.creator.details?.person?.name?.fullName) {
									return doc.people.creator.details.person.name.fullName;
								}
								if (doc.people.creator.name) {
									return doc.people.creator.name;
								}
							}
						}

						// Check people.attendees
						if (doc.people && doc.people.attendees) {
							for (const person of doc.people.attendees) {
								if (person.email?.toLowerCase() === selfEmail) {
									if (person.details?.person?.name?.fullName) {
										return person.details.person.name.fullName;
									}
								}
							}
						}

						// Fallback: use displayName from calendar attendee
						if (attendee.displayName) {
							return attendee.displayName;
						}

						// Last resort: extract from email
						if (selfEmail) {
							return selfEmail.split('@')[0]
								.replace(/[._-]/g, ' ')
								.split(' ')
								.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
								.join(' ');
						}
					}
				}
			}

			return null;
		} catch (error) {
			console.error('Error auto-detecting user name:', error);
			return null;
		}
	}

	/**
	 * Get the effective "my name" for filtering - auto-detected or manual override
	 */
	getEffectiveMyName(doc) {
		// If manual override is set, use it
		if (this.settings.myName && this.settings.myName.trim()) {
			return this.settings.myName.trim();
		}

		// If auto-detect is enabled, try to detect
		if (this.settings.autoDetectMyName) {
			const autoDetected = this.getMyNameFromDocument(doc);
			if (autoDetected) {
				return autoDetected;
			}
		}

		return '';
	}

	/**
	 * Download attachments from a document and save them to the vault
	 * Returns array of local file paths (relative to vault)
	 */
	/**
	 * Get the attachment folder path based on Obsidian's settings
	 * @param {string} noteFolder - The folder where the note will be created
	 * @returns {string} The attachment folder path
	 */
	getAttachmentFolder(noteFolder) {
		// Get Obsidian's attachment folder setting
		const attachmentFolderPath = this.app.vault.getConfig('attachmentFolderPath') || '';

		if (!attachmentFolderPath || attachmentFolderPath === '/') {
			// Vault root
			return '';
		} else if (attachmentFolderPath === './') {
			// Same folder as current file
			return noteFolder;
		} else if (attachmentFolderPath.startsWith('./')) {
			// Subfolder under current file's folder
			const subfolder = attachmentFolderPath.slice(2);
			return noteFolder ? path.join(noteFolder, subfolder) : subfolder;
		} else {
			// Specified folder in vault
			return attachmentFolderPath;
		}
	}

	/**
	 * Get file extension from attachment type or URL
	 */
	getAttachmentExtension(attachment, contentType) {
		// Map of type field to extension
		const typeToExt = {
			'image': 'png',
			'image/png': 'png',
			'image/jpeg': 'jpg',
			'image/jpg': 'jpg',
			'image/gif': 'gif',
			'image/webp': 'webp',
			'image/svg+xml': 'svg',
			'application/pdf': 'pdf',
		};

		// Try content-type header first
		if (contentType) {
			const ct = contentType.toLowerCase().split(';')[0].trim();
			if (typeToExt[ct]) return typeToExt[ct];
			// Extract from content-type like "image/png"
			const match = ct.match(/^image\/(\w+)/);
			if (match) return match[1];
		}

		// Try attachment type field
		if (attachment.type && typeToExt[attachment.type]) {
			return typeToExt[attachment.type];
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

	async downloadAttachments(doc, token, noteFolder) {
		if (!this.settings.downloadAttachments) {
			return [];
		}

		const attachments = doc.attachments;
		if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
			return [];
		}

		const downloadedFiles = [];
		const attachmentDir = this.getAttachmentFolder(noteFolder);

		try {
			// Ensure attachment directory exists (if not vault root)
			if (attachmentDir) {
				const folder = this.app.vault.getFolderByPath(attachmentDir);
				if (!folder) {
					await this.app.vault.createFolder(attachmentDir);
				}
			}

			for (let i = 0; i < attachments.length; i++) {
				const attachment = attachments[i];
				try {
					const url = attachment.url || attachment.file_url || attachment.download_url;

					if (!url) {
						console.warn('Attachment has no URL:', attachment);
						continue;
					}

					// Build request options - don't send auth headers to CDN URLs
					const isCdnUrl = url.includes('cloudfront.net') || url.includes('cdn.');
					const requestOptions = {
						url: url,
						method: 'GET',
					};
					if (!isCdnUrl) {
						requestOptions.headers = {
							'Authorization': 'Bearer ' + token,
						};
					}

					// Download the attachment
					const response = await obsidian.requestUrl(requestOptions);

					if (response.arrayBuffer) {
						// Determine file extension
						const contentType = response.headers?.['content-type'] || response.headers?.['Content-Type'];
						const ext = this.getAttachmentExtension(attachment, contentType);

						// Build filename with extension
						let baseFilename = attachment.filename || attachment.name;
						if (!baseFilename) {
							baseFilename = `attachment_${i + 1}`;
						}

						// Remove existing extension if present, we'll add the correct one
						baseFilename = baseFilename.replace(/\.\w{3,4}$/, '');

						// Add date prefix for uniqueness
						const noteDate = doc.created_at ? this.formatDate(doc.created_at, 'YYYY-MM-DD_HH-mm') : '';
						const filename = noteDate
							? `${noteDate}_${baseFilename}.${ext}`
							: `${baseFilename}.${ext}`;

						const filePath = attachmentDir ? path.join(attachmentDir, filename) : filename;

						// Check if file already exists
						const existingFile = this.app.vault.getAbstractFileByPath(filePath);
						if (!existingFile) {
							await this.app.vault.createBinary(filePath, response.arrayBuffer);
						}

						// Return just the filename for embedding with ![[filename]]
						downloadedFiles.push(filename);
					} else {
						console.warn('No data received for attachment:', url);
					}
				} catch (attachmentError) {
					console.error('Error downloading attachment:', attachment.url, attachmentError);
				}
			}
		} catch (error) {
			console.error('Error processing attachments:', error);
		}

		return downloadedFiles;
	}

	generatePeopleLinks(attendeeNames, doc) {
		if (!attendeeNames || attendeeNames.length === 0) {
			return [];
		}

		const links = [];
		const myName = this.getEffectiveMyName(doc);

		for (let name of attendeeNames) {
			name = this.convertGermanUmlauts(name);

			if (this.settings.excludeMyNameFromPeople && myName) {
				const myNameLower = myName.toLowerCase().trim();
				const nameLower = name.toLowerCase().trim();

				if (nameLower === myNameLower) {
					continue;
				}

				if (nameLower.includes(myNameLower) || myNameLower.includes(nameLower)) {
					continue;
				}

				const myNameParts = myNameLower.split(/[\s\-_]+/).filter(p => p.length > 1);
				const nameParts = nameLower.split(/[\s\-_]+/).filter(p => p.length > 1);

				const matchingParts = myNameParts.filter(part =>
					nameParts.some(np => np.includes(part) || part.includes(np))
				);
				if (matchingParts.length >= Math.min(myNameParts.length, nameParts.length) &&
					matchingParts.length >= 2) {
					continue;
				}
			}

			const link = `[[${name}]]`;
			if (!links.includes(link)) {
				links.push(link);
			}
		}
		return links;
	}

	/**
	 * Build a map of email -> responseStatus from google calendar attendees
	 */
	buildResponseStatusMap(doc) {
		const statusMap = new Map();
		if (doc.google_calendar_event && doc.google_calendar_event.attendees) {
			for (const attendee of doc.google_calendar_event.attendees) {
				if (attendee.email && attendee.responseStatus) {
					statusMap.set(attendee.email.toLowerCase(), attendee.responseStatus);
				}
			}
		}
		return statusMap;
	}

	/**
	 * Check if an attendee should be included based on their response status
	 */
	shouldIncludeAttendee(responseStatus) {
		const filter = this.settings.attendeeFilter;

		// 'all' includes everyone regardless of status
		if (filter === 'all') {
			return true;
		}

		// If no response status available, include by default
		if (!responseStatus) {
			return true;
		}

		switch (filter) {
			case 'accepted':
				return responseStatus === 'accepted';
			case 'accepted_tentative':
				return responseStatus === 'accepted' || responseStatus === 'tentative';
			case 'exclude_declined':
				return responseStatus !== 'declined';
			default:
				return true;
		}
	}

	extractAttendeeNames(doc) {
		const attendees = [];
		const processedEmails = new Set();
		const responseStatusMap = this.buildResponseStatusMap(doc);

		try {
			if (doc.people && Array.isArray(doc.people)) {
				for (const person of doc.people) {
					// Check response status filter using email lookup
					const email = person.email ? person.email.toLowerCase() : null;
					const responseStatus = email ? responseStatusMap.get(email) : null;
					if (!this.shouldIncludeAttendee(responseStatus)) {
						if (email) processedEmails.add(email);
						continue;
					}

					let name = null;

					if (person.details && person.details.person && person.details.person.name) {
						const personDetails = person.details.person.name;
						if (personDetails.fullName) {
							name = personDetails.fullName;
						} else if (personDetails.givenName && personDetails.familyName) {
							name = `${personDetails.givenName} ${personDetails.familyName}`;
						} else if (personDetails.givenName) {
							name = personDetails.givenName;
						}
					} else if (person.display_name) {
						name = person.display_name;
					} else if (person.name) {
						name = person.name;
					}

					if (name && !attendees.includes(name)) {
						attendees.push(name);
						if (email) {
							processedEmails.add(email);
						}
					}
				}
			}

			if (doc.google_calendar_event && doc.google_calendar_event.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.email && processedEmails.has(attendee.email.toLowerCase())) {
						continue;
					}

					// Check response status filter
					if (!this.shouldIncludeAttendee(attendee.responseStatus)) {
						if (attendee.email) processedEmails.add(attendee.email.toLowerCase());
						continue;
					}

					if (attendee.displayName && !attendees.includes(attendee.displayName)) {
						attendees.push(attendee.displayName);
						if (attendee.email) {
							processedEmails.add(attendee.email.toLowerCase());
						}
					}
				}
			}

			// Fallback: extract from email if no display name (for doc.people)
			if (doc.people && Array.isArray(doc.people)) {
				for (const person of doc.people) {
					if (person.email && !processedEmails.has(person.email.toLowerCase())) {
						// Check response status filter
						const responseStatus = responseStatusMap.get(person.email.toLowerCase());
						if (!this.shouldIncludeAttendee(responseStatus)) {
							processedEmails.add(person.email.toLowerCase());
							continue;
						}

						const hasName = person.name || person.display_name ||
							(person.details && person.details.person && person.details.person.name);

						if (!hasName) {
							const emailName = person.email.split('@')[0]
								.replace(/[._-]/g, ' ')
								.split(' ')
								.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
								.join(' ');

							if (!attendees.includes(emailName)) {
								attendees.push(emailName);
								processedEmails.add(person.email.toLowerCase());
							}
						}
					}
				}
			}

			// Fallback: extract from email for calendar attendees without display names
			if (doc.google_calendar_event && doc.google_calendar_event.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.email && !processedEmails.has(attendee.email.toLowerCase())) {
						// Check response status filter
						if (!this.shouldIncludeAttendee(attendee.responseStatus)) {
							processedEmails.add(attendee.email.toLowerCase());
							continue;
						}

						if (!attendee.displayName) {
							const emailName = attendee.email.split('@')[0]
								.replace(/[._-]/g, ' ')
								.split(' ')
								.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
								.join(' ');

							if (!attendees.includes(emailName)) {
								attendees.push(emailName);
								processedEmails.add(attendee.email.toLowerCase());
							}
						}
					}
				}
			}

			return attendees;
		} catch (error) {
			console.error('Error extracting attendee names:', error);
			return [];
		}
	}

	extractAttendeeEmails(doc) {
		const emails = [];
		const processedEmails = new Set();
		const responseStatusMap = this.buildResponseStatusMap(doc);

		try {
			if (doc.people && Array.isArray(doc.people)) {
				for (const person of doc.people) {
					if (person.email && !processedEmails.has(person.email)) {
						// Check response status filter
						const responseStatus = responseStatusMap.get(person.email.toLowerCase());
						if (!this.shouldIncludeAttendee(responseStatus)) {
							processedEmails.add(person.email);
							continue;
						}
						emails.push(person.email);
						processedEmails.add(person.email);
					}
				}
			}

			if (doc.google_calendar_event && doc.google_calendar_event.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.email && !processedEmails.has(attendee.email)) {
						// Check response status filter
						if (!this.shouldIncludeAttendee(attendee.responseStatus)) {
							processedEmails.add(attendee.email);
							continue;
						}
						emails.push(attendee.email);
						processedEmails.add(attendee.email);
					}
				}
			}
		} catch (error) {
			console.error('Error extracting attendee emails:', error);
		}

		return emails;
	}

	async findExistingNoteByGranolaId(granolaId) {
		const folder = this.app.vault.getFolderByPath(this.settings.syncDirectory);
		if (!folder) {
			return null;
		}

		const filesToSearch = folder.children.filter(file => file instanceof obsidian.TFile && file.extension === 'md');

		for (const file of filesToSearch) {
			try {
				// Use Obsidian's MetadataCache for efficient and reliable frontmatter parsing
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.frontmatter?.granola_id) {
					// Handle both quoted and unquoted values
					const cachedId = String(cache.frontmatter.granola_id).trim();
					if (cachedId === granolaId) {
						return file;
					}
				}
			} catch (error) {
				console.error('Error checking file for Granola ID:', file.path, error.message);
			}
		}

		return null;
	}

	extractPanelContent(doc, panelType) {
		// First check panels array
		if (doc.panels && Array.isArray(doc.panels)) {
			for (const panel of doc.panels) {
				if (panel.type === panelType && panel.content && panel.content.type === 'doc') {
					return panel.content;
				}
			}
		}

		// For my_notes, also check doc.notes directly (used when no AI processing)
		if (panelType === 'my_notes' && doc.notes && doc.notes.type === 'doc') {
			return doc.notes;
		}

		// Fallback for enhanced_notes from last_viewed_panel
		if (panelType === 'enhanced_notes' && doc.last_viewed_panel &&
			doc.last_viewed_panel.content && doc.last_viewed_panel.content.type === 'doc') {
			return doc.last_viewed_panel.content;
		}

		return null;
	}

	buildNoteContent(doc, transcript, attachmentFilenames = []) {
		const sections = [];
		const noteTitle = doc.title || 'Untitled Granola Note';

		sections.push('# ' + noteTitle);

		const myNotesContent = this.extractPanelContent(doc, 'my_notes');
		if (myNotesContent && this.settings.includeMyNotes) {
			const myNotesMarkdown = this.convertProseMirrorToMarkdown(myNotesContent);
			if (myNotesMarkdown && myNotesMarkdown.trim()) {
				sections.push('\n## My Notes\n\n' + myNotesMarkdown.trim());
			}
		}

		const enhancedNotesContent = this.extractPanelContent(doc, 'enhanced_notes');
		if (enhancedNotesContent && this.settings.includeEnhancedNotes) {
			const enhancedNotesMarkdown = this.convertProseMirrorToMarkdown(enhancedNotesContent);
			if (enhancedNotesMarkdown && enhancedNotesMarkdown.trim()) {
				if (myNotesContent && this.settings.includeMyNotes) {
					sections.push('\n## Enhanced Notes\n\n' + enhancedNotesMarkdown.trim());
				} else {
					sections.push('\n' + enhancedNotesMarkdown.trim());
				}
			}
		}

		if (this.settings.includeFullTranscript && transcript && transcript !== 'no_transcript') {
			sections.push('\n## Transcript\n\n' + transcript);
		}

		// Add attachments section with embedded images
		if (attachmentFilenames.length > 0) {
			const attachmentLines = attachmentFilenames.map(filePath => {
				// Check if it's an image file
				const ext = filePath.split('.').pop().toLowerCase();
				const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
				if (imageExtensions.includes(ext)) {
					// Embed image
					return '![[' + filePath + ']]';
				} else {
					// Link to file
					return '[[' + filePath + ']]';
				}
			});
			sections.push('\n## Attachments\n\n' + attachmentLines.join('\n'));
		}

		return sections.join('\n');
	}

	buildFrontmatter(doc, attachmentFilenames = []) {
		const title = doc.title || 'Untitled Granola Note';
		const docId = doc.id || 'unknown_id';

		const attendeeNames = this.extractAttendeeNames(doc);
		const peopleLinks = this.generatePeopleLinks(attendeeNames, doc);
		const attendeeEmails = this.extractAttendeeEmails(doc);
		const companyNames = this.extractCompanyNames(doc);
		const meetingPlatform = this.detectMeetingPlatform(doc);

		// Get calendar event times
		const calendarEvent = doc.google_calendar_event;
		const scheduledStart = calendarEvent?.start?.dateTime;
		const scheduledEnd = calendarEvent?.end?.dateTime;

		let frontmatter = '---\n';

		// Custom frontmatter fields
		if (this.settings.enableCustomFrontmatter) {
			if (this.settings.customCategory) {
				frontmatter += 'category:\n  - ' + escapeYamlValue(this.settings.customCategory) + '\n';
			}
			frontmatter += 'type:\n';

			// Use calendar event start time for "date"
			if (scheduledStart) {
				frontmatter += 'date: ' + this.formatDateTimeProperty(scheduledStart) + '\n';
			} else if (doc.created_at) {
				frontmatter += 'date: ' + this.formatDateTimeProperty(doc.created_at) + '\n';
			} else {
				frontmatter += 'date:\n';
			}

			// Add dateEnd from calendar event end time
			if (scheduledEnd) {
				frontmatter += 'dateEnd: ' + this.formatDateTimeProperty(scheduledEnd) + '\n';
			} else {
				frontmatter += 'dateEnd:\n';
			}

			// Add noteStarted (when Granola recording/note-taking started)
			if (doc.created_at) {
				frontmatter += 'noteStarted: ' + this.formatDateTimeProperty(doc.created_at) + '\n';
			} else {
				frontmatter += 'noteStarted:\n';
			}

			// Add noteEnded (when note was last updated - proxy for meeting end)
			if (doc.updated_at) {
				frontmatter += 'noteEnded: ' + this.formatDateTimeProperty(doc.updated_at) + '\n';
			} else {
				frontmatter += 'noteEnded:\n';
			}

			// Org with company wiki links
			frontmatter += 'org:\n';
			if (companyNames.length > 0) {
				for (const company of companyNames) {
					frontmatter += '  - ' + escapeYamlValue('[[' + company + ']]') + '\n';
				}
			}

			// Location - detected meeting platform as wiki link
			if (meetingPlatform) {
				frontmatter += 'loc:\n  - ' + escapeYamlValue(meetingPlatform) + '\n';
			} else {
				frontmatter += 'loc:\n';
			}

			frontmatter += 'people:\n';
			if (peopleLinks.length > 0) {
				for (const link of peopleLinks) {
					frontmatter += '  - ' + escapeYamlValue(link) + '\n';
				}
			}

			frontmatter += 'topics:\n';

			if (this.settings.customTags) {
				frontmatter += 'tags:\n';
				const tags = this.settings.customTags.split(',').map(t => t.trim()).filter(t => t);
				for (const tag of tags) {
					frontmatter += '  - ' + escapeYamlValue(tag) + '\n';
				}
			}
		} else {
			// Simplified frontmatter without custom fields
			if (scheduledStart) {
				frontmatter += 'date: ' + this.formatDateTimeProperty(scheduledStart) + '\n';
			} else if (doc.created_at) {
				frontmatter += 'date: ' + this.formatDateTimeProperty(doc.created_at) + '\n';
			}

			if (scheduledEnd) {
				frontmatter += 'dateEnd: ' + this.formatDateTimeProperty(scheduledEnd) + '\n';
			}

			frontmatter += 'people:\n';
			if (peopleLinks.length > 0) {
				for (const link of peopleLinks) {
					frontmatter += '  - ' + escapeYamlValue(link) + '\n';
				}
			}
		}

		// Emails
		if (this.settings.includeEmails && attendeeEmails.length > 0) {
			frontmatter += 'emails:\n';
			for (const email of attendeeEmails) {
				frontmatter += '  - ' + escapeYamlValue(email) + '\n';
			}
		}

		// Core Granola fields (always included)
		frontmatter += 'granola_id: ' + escapeYamlValue(docId) + '\n';
		frontmatter += 'title: ' + escapeYamlValue(title) + '\n';

		if (this.settings.includeGranolaUrl) {
			frontmatter += 'granola_url: https://notes.granola.ai/d/' + docId + '\n';
		}

		if (doc.created_at) {
			frontmatter += 'created_at: ' + this.formatDateTimeProperty(doc.created_at) + '\n';
		}
		if (doc.updated_at) {
			frontmatter += 'updated_at: ' + this.formatDateTimeProperty(doc.updated_at) + '\n';
		}

		frontmatter += '---\n';
		return frontmatter;
	}

	async processDocument(doc, token) {
		try {
			const title = doc.title || 'Untitled Granola Note';
			const docId = doc.id || 'unknown_id';
			const transcript = doc.transcript || 'no_transcript';

			// Extract and convert content to check if there's actual text
			const myNotesContent = this.extractPanelContent(doc, 'my_notes');
			const enhancedNotesContent = this.extractPanelContent(doc, 'enhanced_notes');

			const myNotesMarkdown = myNotesContent ? this.convertProseMirrorToMarkdown(myNotesContent).trim() : '';
			const enhancedNotesMarkdown = enhancedNotesContent ? this.convertProseMirrorToMarkdown(enhancedNotesContent).trim() : '';

			const hasMyNotes = myNotesMarkdown && this.settings.includeMyNotes;
			const hasEnhancedNotes = enhancedNotesMarkdown && this.settings.includeEnhancedNotes;
			const hasTranscript = this.settings.includeFullTranscript && transcript && transcript !== 'no_transcript';
			const hasAttachments = this.settings.downloadAttachments && doc.attachments && doc.attachments.length > 0;

			// Only create note if there's actual content (text or attachments)
			if (!hasMyNotes && !hasEnhancedNotes && !hasTranscript && !hasAttachments) {
				return false;
			}

			// Download attachments if enabled (pass the note folder for relative path calculation)
			const attachmentFilenames = await this.downloadAttachments(doc, token, this.settings.syncDirectory);

			const existingFile = await this.findExistingNoteByGranolaId(docId);

			if (existingFile) {
				if (this.settings.skipExistingNotes) {
					return true;
				}

				const frontmatter = this.buildFrontmatter(doc, attachmentFilenames);
				const noteContent = this.buildNoteContent(doc, transcript, attachmentFilenames);
				const finalMarkdown = frontmatter + noteContent;

				await this.app.vault.process(existingFile, () => finalMarkdown);
				return true;
			}

			// Create new note
			const frontmatter = this.buildFrontmatter(doc, attachmentFilenames);
			const noteContent = this.buildNoteContent(doc, transcript, attachmentFilenames);
			const finalMarkdown = frontmatter + noteContent;

			const filename = this.generateFilename(doc) + '.md';
			const targetDirectory = this.settings.syncDirectory;
			const filepath = path.join(targetDirectory, filename);

			// Check if file with same name already exists
			let finalFilepath = filepath;
			const existingFileByName = this.app.vault.getAbstractFileByPath(filepath);
			if (existingFileByName && existingFileByName instanceof obsidian.TFile) {
				// Check if same granola_id using MetadataCache
				try {
					const cache = this.app.metadataCache.getFileCache(existingFileByName);
					if (cache?.frontmatter?.granola_id) {
						const cachedId = String(cache.frontmatter.granola_id).trim();
						if (cachedId === docId) {
							await this.app.vault.modify(existingFileByName, finalMarkdown);
							return true;
						}
					}
				} catch (error) {
					console.error('Error checking existing file:', error.message);
				}

				if (this.settings.existingFileAction === 'skip') {
					return false;
				} else if (this.settings.existingFileAction === 'timestamp') {
					const timestamp = this.formatDate(doc.created_at, 'HH-mm');
					const baseFilename = this.generateFilename(doc);
					const uniqueFilename = baseFilename + '_' + timestamp + '.md';
					finalFilepath = path.join(targetDirectory, uniqueFilename);

					const existingUniqueFile = this.app.vault.getAbstractFileByPath(finalFilepath);
					if (existingUniqueFile) {
						return false;
					}
				}
			}

			await this.app.vault.create(finalFilepath, finalMarkdown);
			return true;

		} catch (error) {
			console.error('Error processing document:', error);
			return false;
		}
	}

	async ensureDirectoryExists() {
		try {
			const folder = this.app.vault.getFolderByPath(this.settings.syncDirectory);
			if (!folder) {
				await this.app.vault.createFolder(this.settings.syncDirectory);
			}
		} catch (error) {
			console.error('Error creating directory:', error);
		}
	}

	async updateDailyNote(todaysNotes) {
		try {
			const dailyNote = await this.getDailyNote();
			if (!dailyNote) {
				return;
			}

			let content = await this.app.vault.read(dailyNote);
			const sectionHeader = this.settings.dailyNoteSectionName;

			const notesList = todaysNotes
				.sort((a, b) => a.time.localeCompare(b.time))
				.map(note => '- ' + note.time + ' [[' + note.actualFilePath + '|' + note.title + ']]')
				.join('\n');

			const granolaSection = sectionHeader + '\n' + notesList;

			// Use MetadataCache to find existing headings
			const fileCache = this.app.metadataCache.getFileCache(dailyNote);
			const headings = fileCache?.headings || [];

			// Look for existing section by heading text
			const existingHeading = headings.find(heading =>
				heading.heading.trim() === sectionHeader.replace(/^#+\s*/, '').trim()
			);

			if (existingHeading) {
				// Found existing section, replace content
				const lines = content.split('\n');
				const sectionLineNum = existingHeading.position.start.line;

				// Find the end of this section (next heading of same or higher level, or end of file)
				let endLineNum = lines.length;
				for (const heading of headings) {
					if (heading.position.start.line > sectionLineNum && heading.level <= existingHeading.level) {
						endLineNum = heading.position.start.line;
						break;
					}
				}

				const beforeSection = lines.slice(0, sectionLineNum).join('\n');
				const afterSection = lines.slice(endLineNum).join('\n');
				content = beforeSection + '\n' + granolaSection + '\n' + afterSection;
			} else {
				// Section not found, append to end
				content += '\n\n' + granolaSection;
			}

			await this.app.vault.process(dailyNote, () => content);

		} catch (error) {
			console.error('Error updating daily note:', error);
		}
	}

	async getDailyNote() {
		try {
			const today = new Date();

			// Try to get Daily Notes plugin settings from Obsidian
			const dailyNotesPlugin = this.app.internalPlugins.getPluginById('daily-notes');
			if (dailyNotesPlugin?.enabled) {
				const dailyNotesSettings = dailyNotesPlugin.instance?.options || {};
				const dateFormat = dailyNotesSettings.format || 'YYYY-MM-DD';
				const folder = dailyNotesSettings.folder || '';

				// Format today's date using the configured format
				const todayFormatted = this.formatDateWithPattern(today, dateFormat);

				// Build the expected path
				const expectedPath = folder
					? `${folder}/${todayFormatted}.md`
					: `${todayFormatted}.md`;

				// Try to get the file directly by path
				const dailyNote = this.app.vault.getAbstractFileByPath(expectedPath);
				if (dailyNote) {
					return dailyNote;
				}

				// Fallback: search for file by exact basename match
				const files = this.app.vault.getMarkdownFiles();
				const matchedFile = files.find(f => f.basename === todayFormatted);
				if (matchedFile) {
					return matchedFile;
				}
			}

			// Fallback for when Daily Notes plugin is disabled: use legacy fuzzy matching
			const year = today.getFullYear();
			const month = String(today.getMonth() + 1).padStart(2, '0');
			const day = String(today.getDate()).padStart(2, '0');

			const searchFormats = [
				`${year}-${month}-${day}`, // YYYY-MM-DD
				`${day}-${month}-${year}`, // DD-MM-YYYY
				`${month}-${day}-${year}`, // MM-DD-YYYY
			];

			const files = this.app.vault.getMarkdownFiles();

			for (const file of files) {
				if (file.path.includes('Daily')) {
					for (const format of searchFormats) {
						if (file.path.includes(format)) {
							return file;
						}
					}
				}
			}

			return null;
		} catch (error) {
			console.error('Error getting daily note:', error);
			return null;
		}
	}

	formatDateWithPattern(date, pattern) {
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
			.replace(/YYYY/g, year)
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
}

class GranolaSyncSettingTab extends obsidian.PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const containerEl = this.containerEl;
		containerEl.empty();

		// Sync settings
		containerEl.createEl('h3', {text: 'Sync settings'});

		new obsidian.Setting(containerEl)
			.setName('Sync directory')
			.setDesc('Directory where Granola notes will be synced')
			.addText(text => {
				text.setPlaceholder('Notes');
				text.setValue(this.plugin.settings.syncDirectory);
				text.onChange(async (value) => {
					this.plugin.settings.syncDirectory = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Auth key path')
			.setDesc('Path to your Granola authentication key file (relative to home directory)')
			.addText(text => {
				text.setPlaceholder(getDefaultAuthPath());
				text.setValue(this.plugin.settings.authKeyPath);
				text.onChange(async (value) => {
					this.plugin.settings.authKeyPath = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Auto-sync frequency')
			.setDesc('How often to automatically sync notes')
			.addDropdown(dropdown => {
				dropdown.addOption('0', 'Never (manual only)');
				dropdown.addOption('60000', 'Every 1 minute');
				dropdown.addOption('300000', 'Every 5 minutes');
				dropdown.addOption('600000', 'Every 10 minutes');
				dropdown.addOption('1800000', 'Every 30 minutes');
				dropdown.addOption('3600000', 'Every 1 hour');
				dropdown.addOption('86400000', 'Every 24 hours');

				dropdown.setValue(String(this.plugin.settings.autoSyncFrequency));
				dropdown.onChange(async (value) => {
					this.plugin.settings.autoSyncFrequency = parseInt(value);
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Document limit')
			.setDesc(`Maximum number of documents to sync (${MIN_DOCUMENT_LIMIT}-${MAX_DOCUMENT_LIMIT})`)
			.addText(text => {
				text.setPlaceholder('100');
				text.setValue(String(this.plugin.settings.documentSyncLimit));
				text.onChange(async (value) => {
					const limit = parseInt(value);
					if (!isNaN(limit) && limit >= MIN_DOCUMENT_LIMIT && limit <= MAX_DOCUMENT_LIMIT) {
						this.plugin.settings.documentSyncLimit = limit;
						await this.plugin.saveSettings();
					} else if (!isNaN(limit)) {
						// Clamp to valid range and notify user
						const clampedLimit = Math.max(MIN_DOCUMENT_LIMIT, Math.min(MAX_DOCUMENT_LIMIT, limit));
						this.plugin.settings.documentSyncLimit = clampedLimit;
						text.setValue(String(clampedLimit));
						await this.plugin.saveSettings();
					}
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Skip existing notes')
			.setDesc('Don\'t update notes that already exist (preserves manual edits)')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.skipExistingNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.skipExistingNotes = value;
					await this.plugin.saveSettings();
				});
			});

		// Filename settings
		containerEl.createEl('h3', {text: 'Filename settings'});

		new obsidian.Setting(containerEl)
			.setName('Filename template')
			.setDesc('Use {title}, {created_date}, {updated_date}, {id}, etc.')
			.addText(text => {
				text.setPlaceholder('{created_date}_{title}');
				text.setValue(this.plugin.settings.filenameTemplate);
				text.onChange(async (value) => {
					this.plugin.settings.filenameTemplate = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Date format')
			.setDesc('Format for dates. Use YYYY, MM, DD')
			.addText(text => {
				text.setPlaceholder('YYYY-MM-DD');
				text.setValue(this.plugin.settings.dateFormat);
				text.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Word separator')
			.setDesc('Character to separate words in filenames')
			.addDropdown(dropdown => {
				dropdown.addOption('_', 'Underscore (_)');
				dropdown.addOption('-', 'Hyphen (-)');
				dropdown.addOption(' ', 'Space');
				dropdown.addOption('', 'None');

				dropdown.setValue(this.plugin.settings.filenameSeparator);
				dropdown.onChange(async (value) => {
					this.plugin.settings.filenameSeparator = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Slash replacement')
			.setDesc('Replace "/" in titles (e.g., "Jane / John" → "Jane & John")')
			.addDropdown(dropdown => {
				dropdown.addOption('&', 'Ampersand (&)');
				dropdown.addOption('-', 'Hyphen (-)');
				dropdown.addOption('+', 'Plus (+)');
				dropdown.addOption('~', 'Tilde (~)');
				dropdown.addOption('x', 'x');
				dropdown.addOption('', 'Remove');

				dropdown.setValue(this.plugin.settings.slashReplacement);
				dropdown.onChange(async (value) => {
					this.plugin.settings.slashReplacement = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('When filename exists')
			.setDesc('What to do when a file with the same name exists')
			.addDropdown(dropdown => {
				dropdown.addOption('timestamp', 'Add timestamp');
				dropdown.addOption('skip', 'Skip');

				dropdown.setValue(this.plugin.settings.existingFileAction);
				dropdown.onChange(async (value) => {
					this.plugin.settings.existingFileAction = value;
					await this.plugin.saveSettings();
				});
			});

		// Note content settings
		containerEl.createEl('h3', {text: 'Note content'});

		new obsidian.Setting(containerEl)
			.setName('Include My Notes')
			.setDesc('Include your personal notes from Granola')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeMyNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeMyNotes = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Include Enhanced Notes')
			.setDesc('Include AI-generated enhanced notes')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeEnhancedNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeEnhancedNotes = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Include transcript')
			.setDesc('Include full meeting transcript (slower sync)')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeFullTranscript);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeFullTranscript = value;
					await this.plugin.saveSettings();
				});
			});

		// Frontmatter settings
		containerEl.createEl('h3', {text: 'Frontmatter'});

		new obsidian.Setting(containerEl)
			.setName('Include Granola URL')
			.setDesc('Add link back to original Granola note')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeGranolaUrl);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeGranolaUrl = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Include emails')
			.setDesc('Include attendee email addresses')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeEmails);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeEmails = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Attendee filter')
			.setDesc('Filter attendees based on their calendar response status')
			.addDropdown(dropdown => {
				dropdown.addOption('all', 'Include everyone');
				dropdown.addOption('accepted', 'Only accepted');
				dropdown.addOption('accepted_tentative', 'Accepted + tentative');
				dropdown.addOption('exclude_declined', 'Exclude declined');
				dropdown.setValue(this.plugin.settings.attendeeFilter);
				dropdown.onChange(async (value) => {
					this.plugin.settings.attendeeFilter = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Exclude my name from people')
			.setDesc('Filter out your name from the people list')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.excludeMyNameFromPeople);
				toggle.onChange(async (value) => {
					this.plugin.settings.excludeMyNameFromPeople = value;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.excludeMyNameFromPeople) {
			new obsidian.Setting(containerEl)
				.setName('Auto-detect my name')
				.setDesc('Automatically detect your name from calendar attendees (uses the attendee marked as "self")')
				.addToggle(toggle => {
					toggle.setValue(this.plugin.settings.autoDetectMyName);
					toggle.onChange(async (value) => {
						this.plugin.settings.autoDetectMyName = value;
						await this.plugin.saveSettings();
						this.display();
					});
				});

			new obsidian.Setting(containerEl)
				.setName('My name (override)')
				.setDesc(this.plugin.settings.autoDetectMyName
					? 'Leave empty to use auto-detected name, or enter a name to override'
					: 'Your name as it appears in Granola meetings')
				.addText(text => {
					text.setPlaceholder(this.plugin.settings.autoDetectMyName ? 'Auto-detected' : 'John Doe');
					text.setValue(this.plugin.settings.myName);
					text.onChange(async (value) => {
						this.plugin.settings.myName = value;
						await this.plugin.saveSettings();
					});
				});
		}

		new obsidian.Setting(containerEl)
			.setName('Detect meeting platform')
			.setDesc('Automatically detect Zoom, Google Meet, or Teams from calendar and add as wiki link to loc field')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.enableLocationDetection);
				toggle.onChange(async (value) => {
					this.plugin.settings.enableLocationDetection = value;
					await this.plugin.saveSettings();
				});
			});

		// Attachments
		containerEl.createEl('h3', {text: 'Attachments'});

		new obsidian.Setting(containerEl)
			.setName('Download attachments')
			.setDesc('Download meeting attachments (screenshots, etc.) and embed them in the note')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.downloadAttachments);
				toggle.onChange(async (value) => {
					this.plugin.settings.downloadAttachments = value;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.downloadAttachments) {
			// Get Obsidian's attachment folder for display
			const obsidianAttachmentFolder = this.app.vault.getConfig('attachmentFolderPath') || 'Vault root';
			containerEl.createEl('p', {
				text: 'Attachments will be saved to: ' + obsidianAttachmentFolder,
				cls: 'setting-item-description'
			}).style.marginTop = '-10px';
			containerEl.createEl('p', {
				text: 'Configure attachment location in Obsidian Settings → Files & Links → Default location for new attachments',
				cls: 'setting-item-description'
			}).style.fontSize = '0.85em';
		}

		// Custom frontmatter template
		containerEl.createEl('h3', {text: 'Custom frontmatter template'});

		new obsidian.Setting(containerEl)
			.setName('Enable custom frontmatter')
			.setDesc('Add custom fields like category, type, org, loc, topics')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.enableCustomFrontmatter);
				toggle.onChange(async (value) => {
					this.plugin.settings.enableCustomFrontmatter = value;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.enableCustomFrontmatter) {
			new obsidian.Setting(containerEl)
				.setName('Category')
				.setDesc('Default category value (e.g., [[Meetings]])')
				.addText(text => {
					text.setPlaceholder('[[Meetings]]');
					text.setValue(this.plugin.settings.customCategory);
					text.onChange(async (value) => {
						this.plugin.settings.customCategory = value;
						await this.plugin.saveSettings();
					});
				});

			new obsidian.Setting(containerEl)
				.setName('Tags')
				.setDesc('Default tags (comma-separated)')
				.addText(text => {
					text.setPlaceholder('meetings');
					text.setValue(this.plugin.settings.customTags);
					text.onChange(async (value) => {
						this.plugin.settings.customTags = value;
						await this.plugin.saveSettings();
					});
				});
		}

		// Daily note integration
		containerEl.createEl('h3', {text: 'Daily note integration'});

		new obsidian.Setting(containerEl)
			.setName('Enable daily note integration')
			.setDesc('Add today\'s meetings to your daily note')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.enableDailyNoteIntegration);
				toggle.onChange(async (value) => {
					this.plugin.settings.enableDailyNoteIntegration = value;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.enableDailyNoteIntegration) {
			new obsidian.Setting(containerEl)
				.setName('Section heading')
				.setDesc('Heading for the Granola meetings section in your daily note')
				.addText(text => {
					text.setPlaceholder('## Granola Meetings');
					text.setValue(this.plugin.settings.dailyNoteSectionName);
					text.onChange(async (value) => {
						this.plugin.settings.dailyNoteSectionName = value;
						await this.plugin.saveSettings();
					});
				});
		}

		// Actions
		containerEl.createEl('h3', {text: 'Actions'});

		new obsidian.Setting(containerEl)
			.setName('Sync now')
			.setDesc('Manually sync your Granola notes')
			.addButton(button => {
				button.setButtonText('Sync now');
				button.setCta();
				button.onClick(async () => {
					await this.plugin.syncNotes();
				});
			});
	}
}

module.exports = GranolaSyncPlugin;
