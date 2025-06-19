const obsidian = require('obsidian');
const path = require('path');
const os = require('os');
const fs = require('fs');

function getDefaultAuthPath() {
	const platform = os.platform();
	if (platform === 'win32') {
		return 'AppData/Roaming/Granola/supabase.json';
	} else {
		// Default to macOS path for macOS, Linux, and other platforms
		return 'Library/Application Support/Granola/supabase.json';
	}
}

const DEFAULT_SETTINGS = {
	syncDirectory: 'Granola',
	notePrefix: '',
	authKeyPath: getDefaultAuthPath(),
	filenameTemplate: '{title}',
	dateFormat: 'YYYY-MM-DD',
	autoSyncFrequency: 300000,
	enableDailyNoteIntegration: false,
	dailyNoteSectionName: '## Granola Meetings',
	showRibbonIcon: true,
	skipExistingNotes: false,
	includeAttendeeTags: false,
	excludeMyNameFromTags: true,
	myName: 'Danny McClelland'
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
			console.log('Could not load settings, using defaults');
		}

		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar('Idle');

		// Add ribbon icon if enabled
		this.updateRibbonIcon();

		this.addCommand({
			id: 'sync-granola-notes',
			name: 'Sync Granola Notes',
			callback: () => {
				this.syncNotes();
			}
		});

		this.addSettingTab(new GranolaSyncSettingTab(this.app, this));

		setTimeout(() => {
			this.setupAutoSync();
		}, 1000);
	}

	onunload() {
		this.clearAutoSync();
	}

	async saveSettings() {
		try {
			await this.saveData(this.settings);
			this.setupAutoSync();
			this.updateRibbonIcon();
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	}

	updateRibbonIcon() {
		// Remove existing ribbon icon if it exists
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}

		// Add ribbon icon if enabled in settings
		if (this.settings.showRibbonIcon) {
			this.ribbonIconEl = this.addRibbonIcon('sync', 'Sync Granola Notes', () => {
				this.syncNotes();
			});
		}
	}

	updateStatusBar(status, count) {
		if (!this.statusBarItem) return;
		
		let text = 'Granola Sync: ';
		
		if (status === 'Idle') {
			text += 'Idle';
		} else if (status === 'Syncing') {
			text += 'Syncing...';
		} else if (status === 'Complete') {
			text += count + ' notes synced';
			setTimeout(() => {
				this.updateStatusBar('Idle');
			}, 3000);
		} else if (status === 'Error') {
			text += 'Error - ' + (count || 'sync failed');
			setTimeout(() => {
				this.updateStatusBar('Idle');
			}, 5000);
		}
		
		this.statusBarItem.setText(text);
	}

	setupAutoSync() {
		this.clearAutoSync();
		
		if (this.settings.autoSyncFrequency > 0) {
			this.autoSyncInterval = window.setInterval(() => {
				console.log('Auto-syncing Granola notes...');
				this.syncNotes();
			}, this.settings.autoSyncFrequency);
			console.log('Auto-sync enabled: every ' + this.getFrequencyLabel(this.settings.autoSyncFrequency));
		} else {
			console.log('Auto-sync disabled');
		}
	}

	clearAutoSync() {
		if (this.autoSyncInterval) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}
	}

	getFrequencyLabel(frequency) {
		const minutes = frequency / (1000 * 60);
		const hours = frequency / (1000 * 60 * 60);
		
		if (frequency === 0) return 'Disabled';
		if (frequency < 60000) return (frequency / 1000) + ' seconds';
		if (minutes < 60) return minutes + ' minutes';
		return hours + ' hours';
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
					const success = await this.processDocument(doc);
					if (success) {
						syncedCount++;
					}
					
					// Check for daily note integration regardless of sync success
					// This ensures existing notes from today are still included
					if (this.settings.enableDailyNoteIntegration && doc.created_at) {
						const noteDate = new Date(doc.created_at).toDateString();
						console.log('Checking note for daily integration - Note date:', noteDate, 'Today:', today, 'Title:', doc.title);
						if (noteDate === today) {
							const noteData = {};
							noteData.title = doc.title || 'Untitled Granola Note';
							noteData.filename = this.generateFilename(doc) + '.md';
							
							const createdDate = new Date(doc.created_at);
							const hours = String(createdDate.getHours()).padStart(2, '0');
							const minutes = String(createdDate.getMinutes()).padStart(2, '0');
							noteData.time = hours + ':' + minutes;
							
							console.log('Adding note to daily note integration:', noteData.title, 'at', noteData.time);
							todaysNotes.push(noteData);
						}
					}
				} catch (error) {
					console.error('Error processing document ' + doc.title + ':', error);
				}
			}

			console.log('Daily note integration check - Enabled:', this.settings.enableDailyNoteIntegration, 'Notes found for today:', todaysNotes.length);
			
			if (this.settings.enableDailyNoteIntegration && todaysNotes.length > 0) {
				console.log('Running daily note integration for', todaysNotes.length, 'notes');
				await this.updateDailyNote(todaysNotes);
			} else if (this.settings.enableDailyNoteIntegration && todaysNotes.length === 0) {
				console.log('Daily note integration enabled but no notes from today found');
			}

			this.updateStatusBar('Complete', syncedCount);
			
		} catch (error) {
			console.error('Granola sync failed:', error);
			this.updateStatusBar('Error', 'sync failed');
		}
	}

	async loadCredentials() {
		try {
			const authPath = path.resolve(os.homedir(), this.settings.authKeyPath);
			const credentialsFile = fs.readFileSync(authPath, 'utf8');
			const data = JSON.parse(credentialsFile);
			
			const cognitoTokens = JSON.parse(data.cognito_tokens);
			const accessToken = cognitoTokens.access_token;
			
			if (!accessToken) {
				console.error('No access token found in credentials file');
				return null;
			}
			
			console.log('Successfully loaded credentials');
			return accessToken;
		} catch (error) {
			console.error('Error reading credentials file:', error);
			return null;
		}
	}

	async fetchGranolaDocuments(token) {
		try {
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
					limit: 100,
					offset: 0,
					include_last_viewed_panel: true
				})
			});

			const apiResponse = response.json;
			
			if (!apiResponse || !apiResponse.docs) {
				console.error('API response format is unexpected');
				return null;
			}

			console.log('Successfully fetched ' + apiResponse.docs.length + ' documents from Granola');
			return apiResponse.docs;
		} catch (error) {
			console.error('Error fetching documents:', error);
			return null;
		}
	}

	convertProseMirrorToMarkdown(content) {
		if (!content || typeof content !== 'object' || !content.content) {
			return '';
		}

		const processNode = (node) => {
			if (!node || typeof node !== 'object') {
				return '';
			}

			const nodeType = node.type || '';
			const nodeContent = node.content || [];
			const text = node.text || '';

			if (nodeType === 'heading') {
				const level = node.attrs && node.attrs.level ? node.attrs.level : 1;
				const headingText = nodeContent.map(processNode).join('');
				return '#'.repeat(level) + ' ' + headingText + '\n\n';
			} else if (nodeType === 'paragraph') {
				const paraText = nodeContent.map(processNode).join('');
				return paraText + '\n\n';
			} else if (nodeType === 'bulletList') {
				const items = [];
				for (let i = 0; i < nodeContent.length; i++) {
					const item = nodeContent[i];
					if (item.type === 'listItem') {
						const itemContent = (item.content || []).map(processNode).join('').trim();
						items.push('- ' + itemContent);
					}
				}
				return items.join('\n') + '\n\n';
			} else if (nodeType === 'text') {
				return text;
			} else {
				return nodeContent.map(processNode).join('');
			}
		};

		return processNode(content);
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

	generateNoteTitle(doc) {
		const title = doc.title || 'Untitled Granola Note';
		// Clean the title for use as a heading - remove invalid characters but keep spaces
		return title.replace(/[<>:"/\\|?*]/g, '').trim();
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

		if (this.settings.notePrefix) {
			filename = this.settings.notePrefix + filename;
		}

		const invalidChars = /[<>:"/\\|?*]/g;
		filename = filename.replace(invalidChars, '');
		filename = filename.replace(/\s+/g, '_');
		
		return filename;
	}

	async findExistingNoteByGranolaId(granolaId) {
		const folder = this.app.vault.getAbstractFileByPath(this.settings.syncDirectory);
		if (!folder || !(folder instanceof obsidian.TFolder)) {
			return null;
		}

		const files = folder.children.filter(file => file instanceof obsidian.TFile && file.extension === 'md');
		
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
				
				if (frontmatterMatch) {
					const frontmatter = frontmatterMatch[1];
					const granolaIdMatch = frontmatter.match(/granola_id:\s*(.+)$/m);
					
					if (granolaIdMatch && granolaIdMatch[1].trim() === granolaId) {
						return file;
					}
				}
			} catch (error) {
				console.error('Error reading file for Granola ID check:', file.path, error);
			}
		}
		
		return null;
	}

	async processDocument(doc) {
		try {
			const title = doc.title || 'Untitled Granola Note';
			const docId = doc.id || 'unknown_id';
			
			console.log('Processing document: ' + title + ' (ID: ' + docId + ')');

			let contentToParse = null;
			if (doc.last_viewed_panel && doc.last_viewed_panel.content && doc.last_viewed_panel.content.type === 'doc') {
				contentToParse = doc.last_viewed_panel.content;
			}

			if (!contentToParse) {
				console.log('Skipping document ' + title + ' - no suitable content found');
				return false;
			}

			// Check if note already exists by Granola ID
			const existingFile = await this.findExistingNoteByGranolaId(docId);
			
			if (existingFile) {
				if (this.settings.skipExistingNotes && !this.settings.includeAttendeeTags) {
					console.log('Skipping existing note (skipExistingNotes enabled): ' + existingFile.path);
					return true; // Return true so it counts as "synced" but we don't update
				}
				
				if (this.settings.skipExistingNotes && this.settings.includeAttendeeTags) {
					// Only update attendee tags, preserve existing content
					try {
						console.log('Updating attendee tags for existing note: ' + existingFile.path);
						await this.updateExistingNoteAttendees(existingFile, doc);
						return true;
					} catch (error) {
						console.error('Error updating attendee tags for existing note:', error);
						return false;
					}
				}

				// Update existing note (full update)
				try {
					const markdownContent = this.convertProseMirrorToMarkdown(contentToParse);

					// Extract attendee information
					const attendeeNames = this.extractAttendeeNames(doc);
					const attendeeTags = this.generateAttendeeTags(attendeeNames);
					
					console.log('Attendee names found:', attendeeNames);
					console.log('Generated attendee tags:', attendeeTags);

					// Create frontmatter with original title
					let frontmatter = '---\n';
					frontmatter += 'granola_id: ' + docId + '\n';
					const escapedTitle = title.replace(/"/g, '\\"');
					frontmatter += 'title: "' + escapedTitle + '"\n';
					
					if (doc.created_at) {
						frontmatter += 'created_at: ' + doc.created_at + '\n';
					}
					if (doc.updated_at) {
						frontmatter += 'updated_at: ' + doc.updated_at + '\n';
					}
					
					// Add attendee tags if any were found
					if (attendeeTags.length > 0) {
						frontmatter += 'tags:\n';
						for (const tag of attendeeTags) {
							frontmatter += '  - ' + tag + '\n';
						}
					}
					
					frontmatter += '---\n\n';

					// Use the note title (clean, with proper spacing) for the heading
					const noteTitle = this.generateNoteTitle(doc);
					const finalMarkdown = frontmatter + '# ' + noteTitle + '\n\n' + markdownContent;
					await this.app.vault.modify(existingFile, finalMarkdown);
					console.log('Successfully updated existing note: ' + existingFile.path);
					return true;
				} catch (updateError) {
					console.error('Error updating existing note:', updateError);
					return false;
				}
			}

			// Create new note
			const markdownContent = this.convertProseMirrorToMarkdown(contentToParse);
			
			// Extract attendee information
			const attendeeNames = this.extractAttendeeNames(doc);
			const attendeeTags = this.generateAttendeeTags(attendeeNames);
			
			console.log('Attendee names found:', attendeeNames);
			console.log('Generated attendee tags:', attendeeTags);

			let frontmatter = '---\n';
			frontmatter += 'granola_id: ' + docId + '\n';
			const escapedTitle = title.replace(/"/g, '\\"');
			frontmatter += 'title: "' + escapedTitle + '"\n';
			
			if (doc.created_at) {
				frontmatter += 'created_at: ' + doc.created_at + '\n';
			}
			if (doc.updated_at) {
				frontmatter += 'updated_at: ' + doc.updated_at + '\n';
			}
			
			// Add attendee tags if any were found
			if (attendeeTags.length > 0) {
				frontmatter += 'tags:\n';
				for (const tag of attendeeTags) {
					frontmatter += '  - ' + tag + '\n';
				}
			}
			
			frontmatter += '---\n\n';

			const finalMarkdown = frontmatter + markdownContent;

			const filename = this.generateFilename(doc) + '.md';
			const filepath = path.join(this.settings.syncDirectory, filename);

			// Check if file with same name already exists
			const existingFileByName = this.app.vault.getAbstractFileByPath(filepath);
			if (existingFileByName) {
				console.log('File with same name already exists, skipping: ' + filepath);
				return false;
			}

			await this.app.vault.create(filepath, finalMarkdown);
			console.log('Successfully created new note: ' + filepath);
			return true;

		} catch (error) {
			console.error('Error processing document:', error);
			return false;
		}
	}

	async ensureDirectoryExists() {
		try {
			const folder = this.app.vault.getAbstractFileByPath(this.settings.syncDirectory);
			if (!folder || !(folder instanceof obsidian.TFolder)) {
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
				console.log('No daily note found, skipping daily note integration');
				return;
			}

			let content = await this.app.vault.read(dailyNote);
			console.log('Daily note content length:', content.length);
			
			const sectionHeader = this.settings.dailyNoteSectionName;
			console.log('Looking for section header:', sectionHeader);
			
			const notesList = todaysNotes
				.sort((a, b) => a.time.localeCompare(b.time))
				.map(note => '- ' + note.time + ' [[' + this.settings.syncDirectory + '/' + note.filename + '|' + note.title + ']]')
				.join('\n');
			
			console.log('Generated notes list:', notesList);
			
			const granolaSection = sectionHeader + '\n' + notesList;

			const sectionRegex = new RegExp('^' + this.escapeRegex(sectionHeader) + '$', 'm');
			console.log('Section regex:', sectionRegex);
			console.log('Section exists in content:', sectionRegex.test(content));
			
			const nextSectionRegex = /^## /m;
			
			if (sectionRegex.test(content)) {
				console.log('Found existing section, replacing content');
				const lines = content.split('\n');
				const sectionIndex = lines.findIndex(line => line.trim() === sectionHeader.trim());
				console.log('Section found at line index:', sectionIndex);
				
				if (sectionIndex !== -1) {
					let endIndex = lines.length;
					for (let i = sectionIndex + 1; i < lines.length; i++) {
						if (lines[i].match(nextSectionRegex)) {
							endIndex = i;
							break;
						}
					}
					console.log('Section ends at line index:', endIndex);
					
					const beforeSection = lines.slice(0, sectionIndex).join('\n');
					const afterSection = lines.slice(endIndex).join('\n');
					content = beforeSection + '\n' + granolaSection + '\n' + afterSection;
				}
			} else {
				console.log('Section not found, appending to end');
				content += '\n\n' + granolaSection;
			}

			console.log('Final content length:', content.length);
			await this.app.vault.modify(dailyNote, content);
			console.log('Updated daily note with Granola meetings');
			
		} catch (error) {
			console.error('Error updating daily note:', error);
		}
	}

	async getDailyNote() {
		try {
			// Try to get today's daily note using a simpler approach
			const today = new Date();
			const todayFormatted = today.toISOString().split('T')[0]; // YYYY-MM-DD format
			
			// Generate various date formats to search for
			const year = today.getFullYear();
			const month = String(today.getMonth() + 1).padStart(2, '0');
			const day = String(today.getDate()).padStart(2, '0');
			
			// Common date formats in daily notes
			const searchFormats = [
				`${day}-${month}-${year}`, // DD-MM-YYYY
				`${year}-${month}-${day}`, // YYYY-MM-DD  
				`${month}-${day}-${year}`, // MM-DD-YYYY
				`${day}.${month}.${year}`, // DD.MM.YYYY
				`${year}/${month}/${day}`, // YYYY/MM/DD
				`${day}/${month}/${year}`, // DD/MM/YYYY
			];
			
			console.log('Looking for today\'s daily note. Today:', todayFormatted);
			console.log('Searching for date formats:', searchFormats);
			
			// Search through all files in the vault to find today's daily note
			const files = this.app.vault.getMarkdownFiles();
			console.log('Searching through', files.length, 'markdown files');
			
			for (const file of files) {
				// Check if this file is in the daily notes structure and matches any of today's date formats
				if (file.path.includes('Daily')) {
					for (const dateFormat of searchFormats) {
						if (file.path.includes(dateFormat)) {
							console.log('Found daily note:', file.path, 'matching format:', dateFormat);
							return file;
						}
					}
				}
			}
			
			console.log('No daily note found for today');
			return null;
		} catch (error) {
			console.error('Error getting daily note:', error);
			return null;
		}
	}

	escapeRegex(string) {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	extractAttendeeNames(doc) {
		const attendees = [];
		
		try {
			// Check the people field for attendee information
			if (doc.people && Array.isArray(doc.people)) {
				for (const person of doc.people) {
					if (person.name) {
						attendees.push(person.name);
					} else if (person.display_name) {
						attendees.push(person.display_name);
					} else if (person.email) {
						// Extract name from email if no display name
						const emailName = person.email.split('@')[0].replace(/[._]/g, ' ');
						attendees.push(emailName);
					}
				}
			}
			
			// Also check google_calendar_event for additional attendee info
			if (doc.google_calendar_event && doc.google_calendar_event.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.displayName && !attendees.includes(attendee.displayName)) {
						attendees.push(attendee.displayName);
					} else if (attendee.email && !attendees.some(name => name.includes(attendee.email.split('@')[0]))) {
						const emailName = attendee.email.split('@')[0].replace(/[._]/g, ' ');
						attendees.push(emailName);
					}
				}
			}
			
			return attendees;
		} catch (error) {
			console.error('Error extracting attendee names:', error);
			return [];
		}
	}

	generateAttendeeTags(attendees) {
		if (!this.settings.includeAttendeeTags || !attendees || attendees.length === 0) {
			return [];
		}
		
		const tags = [];
		
		for (const attendee of attendees) {
			// Skip if this is the user's own name (case-insensitive, exact match)
			if (this.settings.excludeMyNameFromTags && this.settings.myName && 
				attendee.toLowerCase().trim() === this.settings.myName.toLowerCase().trim()) {
				continue;
			}
			
			// Convert name to valid tag format
			// Remove special characters, replace spaces with hyphens, convert to lowercase
			let tag = attendee
				.replace(/[^\w\s-]/g, '') // Remove special chars except spaces and hyphens
				.trim()
				.replace(/\s+/g, '-') // Replace spaces with hyphens
				.toLowerCase();
			
			// Add person/ prefix for better organization
			tag = 'person/' + tag;
			
			if (tag && !tags.includes(tag)) {
				tags.push(tag);
			}
		}
		
		return tags;
	}

	async updateExistingNoteAttendees(file, doc) {
		try {
			// Read existing note content
			const content = await this.app.vault.read(file);
			
			// Extract attendee information
			const attendeeNames = this.extractAttendeeNames(doc);
			const attendeeTags = this.generateAttendeeTags(attendeeNames);
			
			console.log('Updating attendee tags for existing note. Names:', attendeeNames, 'Tags:', attendeeTags);
			
			// Parse existing frontmatter
			const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
			
			if (!frontmatterMatch) {
				console.log('No frontmatter found in existing note, skipping attendee tag update');
				return;
			}
			
			const existingFrontmatter = frontmatterMatch[1];
			const noteContent = frontmatterMatch[2];
			
			// Parse existing frontmatter into an object
			const frontmatterLines = existingFrontmatter.split('\n');
			const frontmatterData = {};
			let currentKey = null;
			let inTagsSection = false;
			
			for (const line of frontmatterLines) {
				if (line.startsWith('tags:')) {
					inTagsSection = true;
					frontmatterData.tags = [];
				} else if (line.startsWith('  - ') && inTagsSection) {
					const tag = line.substring(4).trim();
					if (!tag.startsWith('person/')) {
						// Keep non-person tags
						frontmatterData.tags.push(tag);
					}
				} else if (line.includes(':') && !line.startsWith('  ')) {
					inTagsSection = false;
					const [key, ...valueParts] = line.split(':');
					const value = valueParts.join(':').trim();
					frontmatterData[key.trim()] = value;
				}
			}
			
			// Add attendee tags to existing tags
			if (!frontmatterData.tags) {
				frontmatterData.tags = [];
			}
			
			// Add new attendee tags
			for (const tag of attendeeTags) {
				if (!frontmatterData.tags.includes(tag)) {
					frontmatterData.tags.push(tag);
				}
			}
			
			// Rebuild frontmatter
			let newFrontmatter = '---\n';
			for (const [key, value] of Object.entries(frontmatterData)) {
				if (key === 'tags' && Array.isArray(value) && value.length > 0) {
					newFrontmatter += 'tags:\n';
					for (const tag of value) {
						newFrontmatter += '  - ' + tag + '\n';
					}
				} else if (key !== 'tags') {
					newFrontmatter += key + ': ' + value + '\n';
				}
			}
			newFrontmatter += '---\n';
			
			// Write updated content
			const updatedContent = newFrontmatter + noteContent;
			await this.app.vault.modify(file, updatedContent);
			
			console.log('Successfully updated attendee tags for existing note:', file.path);
			
		} catch (error) {
			console.error('Error updating attendee tags for existing note:', error);
			throw error;
		}
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
		containerEl.createEl('h2', { text: 'Granola Sync Settings' });

		new obsidian.Setting(containerEl)
			.setName('Show Ribbon Icon')
			.setDesc('Display the sync button in the left sidebar ribbon')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showRibbonIcon);
				toggle.onChange(async (value) => {
					this.plugin.settings.showRibbonIcon = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Note Prefix')
			.setDesc('Optional prefix to add to all synced note titles')
			.addText(text => {
				text.setPlaceholder('granola-');
				text.setValue(this.plugin.settings.notePrefix);
				text.onChange(async (value) => {
					this.plugin.settings.notePrefix = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Auth Key Path')
			.setDesc('Path to your Granola authentication key file')
			.addText(text => {
				text.setPlaceholder(getDefaultAuthPath());
				text.setValue(this.plugin.settings.authKeyPath);
				text.onChange(async (value) => {
					this.plugin.settings.authKeyPath = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Date Format')
			.setDesc('Format for dates in filenames. Use YYYY (year), MM (month), DD (day)')
			.addText(text => {
				text.setPlaceholder('YYYY-MM-DD');
				text.setValue(this.plugin.settings.dateFormat);
				text.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Filename Template')
			.setDesc('Template for filenames. Use {title}, {created_date}, {updated_date}, etc.')
			.addText(text => {
				text.setPlaceholder('{created_date}_{title}');
				text.setValue(this.plugin.settings.filenameTemplate);
				text.onChange(async (value) => {
					this.plugin.settings.filenameTemplate = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Auto-Sync Frequency')
			.setDesc('How often to automatically sync notes')
			.addDropdown(dropdown => {
				dropdown.addOption('0', 'Never');
				dropdown.addOption('60000', 'Every 1 minute');
				dropdown.addOption('300000', 'Every 5 minutes');
				dropdown.addOption('600000', 'Every 10 minutes');
				dropdown.addOption('1800000', 'Every 30 minutes');
				dropdown.addOption('3600000', 'Every 1 hour');
				dropdown.addOption('21600000', 'Every 6 hours');
				dropdown.addOption('86400000', 'Every 24 hours');
				
				dropdown.setValue(String(this.plugin.settings.autoSyncFrequency));
				dropdown.onChange(async (value) => {
					this.plugin.settings.autoSyncFrequency = parseInt(value);
					await this.plugin.saveSettings();
					
					const label = this.plugin.getFrequencyLabel(parseInt(value));
					new obsidian.Notice('Auto-sync updated: ' + label);
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Daily Note Integration')
			.setDesc('Add todays meetings to your Daily Note')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.enableDailyNoteIntegration);
				toggle.onChange(async (value) => {
					this.plugin.settings.enableDailyNoteIntegration = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Daily Note Section Name')
			.setDesc('The heading name for the Granola meetings section in your Daily Note')
			.addText(text => {
				text.setPlaceholder('## Granola Meetings');
				text.setValue(this.plugin.settings.dailyNoteSectionName);
				text.onChange(async (value) => {
					this.plugin.settings.dailyNoteSectionName = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Skip Existing Notes')
			.setDesc('When enabled, notes that already exist will not be updated during sync. This preserves any manual tags, summaries, or other additions you\'ve made.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.skipExistingNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.skipExistingNotes = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Include Attendee Tags')
			.setDesc('Add meeting attendees as tags in the frontmatter of each note')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeAttendeeTags);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeAttendeeTags = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Exclude My Name from Tags')
			.setDesc('When adding attendee tags, exclude your own name from the list')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.excludeMyNameFromTags);
				toggle.onChange(async (value) => {
					this.plugin.settings.excludeMyNameFromTags = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('My Name')
			.setDesc('Your name as it appears in Granola meetings (used to exclude from attendee tags)')
			.addText(text => {
				text.setPlaceholder('Danny McClelland');
				text.setValue(this.plugin.settings.myName);
				text.onChange(async (value) => {
					this.plugin.settings.myName = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Sync Directory')
			.setDesc('Directory within your vault where Granola notes will be synced')
			.addText(text => {
				text.setPlaceholder('Granola');
				text.setValue(this.plugin.settings.syncDirectory);
				text.onChange(async (value) => {
					this.plugin.settings.syncDirectory = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Manual Sync')
			.setDesc('Click to manually sync your Granola notes')
			.addButton(button => {
				button.setButtonText('Sync Now');
				button.setCta();
				button.onClick(async () => {
					await this.plugin.syncNotes();
				});
			});
	}
}

module.exports = GranolaSyncPlugin;
