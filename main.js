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
	myName: 'Danny McClelland',
	includeFolderTags: false,
	includeGranolaUrl: false
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
							// Find the actual file that was created or already exists
							const actualFile = await this.findExistingNoteByGranolaId(doc.id);
							
							if (actualFile) {
								const noteData = {};
								noteData.title = doc.title || 'Untitled Granola Note';
								noteData.actualFilePath = actualFile.path; // Use actual file path
								
								const createdDate = new Date(doc.created_at);
								const hours = String(createdDate.getHours()).padStart(2, '0');
								const minutes = String(createdDate.getMinutes()).padStart(2, '0');
								noteData.time = hours + ':' + minutes;
								
								console.log('Adding note to daily note integration:', noteData.title, 'at', noteData.time, 'path:', noteData.actualFilePath);
								todaysNotes.push(noteData);
							}
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
			// Note: Workspace fetching is temporarily disabled as folder information is not available
			let workspaces = null;

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
			
			// Store workspaces for later use in folder extraction
			this.workspaces = workspaces;
			
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
				if (this.settings.skipExistingNotes && !this.settings.includeAttendeeTags && !this.settings.includeGranolaUrl) {
					console.log('Skipping existing note (skipExistingNotes enabled): ' + existingFile.path);
					return true; // Return true so it counts as "synced" but we don't update
				}
				
				if (this.settings.skipExistingNotes && (this.settings.includeAttendeeTags || this.settings.includeGranolaUrl)) {
					// Only update metadata (tags, URLs), preserve existing content
					try {
						console.log('Updating metadata for existing note: ' + existingFile.path);
						await this.updateExistingNoteMetadata(existingFile, doc);
						return true;
					} catch (error) {
						console.error('Error updating metadata for existing note:', error);
						return false;
					}
				}

				// Update existing note (full update)
				try {
					const markdownContent = this.convertProseMirrorToMarkdown(contentToParse);

					// Extract attendee information
					const attendeeNames = this.extractAttendeeNames(doc);
					const attendeeTags = this.generateAttendeeTags(attendeeNames);
					
					// Extract folder information
					const folderNames = this.extractFolderNames(doc);
					const folderTags = this.generateFolderTags(folderNames);
					
					// Generate Granola URL
					const granolaUrl = this.generateGranolaUrl(docId);
					
					console.log('Attendee names found:', attendeeNames);
					console.log('Generated attendee tags:', attendeeTags);
					console.log('Generated Granola URL:', granolaUrl);

					// Combine all tags
					const allTags = [...attendeeTags, ...folderTags];

					// Create frontmatter with original title
					let frontmatter = '---\n';
					frontmatter += 'granola_id: ' + docId + '\n';
					const escapedTitle = title.replace(/"/g, '\\"');
					frontmatter += 'title: "' + escapedTitle + '"\n';
					
					if (granolaUrl) {
						frontmatter += 'granola_url: "' + granolaUrl + '"\n';
					}
					
					if (doc.created_at) {
						frontmatter += 'created_at: ' + doc.created_at + '\n';
					}
					if (doc.updated_at) {
						frontmatter += 'updated_at: ' + doc.updated_at + '\n';
					}
					
					// Add all tags if any were found
					if (allTags.length > 0) {
						frontmatter += 'tags:\n';
						for (const tag of allTags) {
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
			
			// Extract folder information
			const folderNames = this.extractFolderNames(doc);
			const folderTags = this.generateFolderTags(folderNames);
			
			// Generate Granola URL
			const granolaUrl = this.generateGranolaUrl(docId);
			
			console.log('Attendee names found:', attendeeNames);
			console.log('Generated attendee tags:', attendeeTags);
			console.log('Generated Granola URL:', granolaUrl);

			// Combine all tags
			const allTags = [...attendeeTags, ...folderTags];

			let frontmatter = '---\n';
			frontmatter += 'granola_id: ' + docId + '\n';
			const escapedTitle = title.replace(/"/g, '\\"');
			frontmatter += 'title: "' + escapedTitle + '"\n';
			
			if (granolaUrl) {
				frontmatter += 'granola_url: "' + granolaUrl + '"\n';
			}
			
			if (doc.created_at) {
				frontmatter += 'created_at: ' + doc.created_at + '\n';
			}
			if (doc.updated_at) {
				frontmatter += 'updated_at: ' + doc.updated_at + '\n';
			}
			
			// Add all tags if any were found
			if (allTags.length > 0) {
				frontmatter += 'tags:\n';
				for (const tag of allTags) {
					frontmatter += '  - ' + tag + '\n';
				}
			}
			
			frontmatter += '---\n\n';

			const finalMarkdown = frontmatter + markdownContent;

			const filename = this.generateFilename(doc) + '.md';
			const filepath = path.join(this.settings.syncDirectory, filename);

			// Check if file with same name already exists
			let finalFilepath = filepath;
			const existingFileByName = this.app.vault.getAbstractFileByPath(filepath);
			if (existingFileByName) {
				// Create a unique filename by appending timestamp or ID
				const createdDate = new Date(doc.created_at);
				const timestamp = this.formatDate(doc.created_at, 'HH-mm');
				const baseFilename = this.generateFilename(doc);
				const uniqueFilename = baseFilename + '_' + timestamp + '.md'; 
				finalFilepath = path.join(this.settings.syncDirectory, uniqueFilename);
				console.log('File with same name already exists, creating with unique name: ' + finalFilepath);
				
				// Check if the unique filename also exists
				const existingUniqueFile = this.app.vault.getAbstractFileByPath(finalFilepath);
				if (existingUniqueFile) {
					console.log('Unique filename also exists, skipping: ' + finalFilepath);
					return false;
				}
			}

			await this.app.vault.create(finalFilepath, finalMarkdown);
			console.log('Successfully created new note: ' + finalFilepath);
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
				.map(note => '- ' + note.time + ' [[' + note.actualFilePath + '|' + note.title + ']]')
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
		const processedEmails = new Set(); // Track processed emails to avoid duplicates
		
		try {
			// Check the people field for attendee information (enhanced with detailed person data)
			if (doc.people && Array.isArray(doc.people)) {
				for (const person of doc.people) {
					let name = null;
					
					// Try to get name from various fields
					if (person.name) {
						name = person.name;
					} else if (person.display_name) {
						name = person.display_name;
					} else if (person.details && person.details.person && person.details.person.name) {
						// Use the detailed person information if available
						const personDetails = person.details.person.name;
						if (personDetails.fullName) {
							name = personDetails.fullName;
						} else if (personDetails.givenName && personDetails.familyName) {
							name = `${personDetails.givenName} ${personDetails.familyName}`;
						} else if (personDetails.givenName) {
							name = personDetails.givenName;
						}
					} else if (person.email) {
						// Extract name from email if no display name
						const emailName = person.email.split('@')[0].replace(/[._]/g, ' ');
						name = emailName;
					}
					
					if (name && !attendees.includes(name)) {
						attendees.push(name);
						if (person.email) {
							processedEmails.add(person.email);
						}
					}
				}
			}
			
			// Also check google_calendar_event for additional attendee info
			if (doc.google_calendar_event && doc.google_calendar_event.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					// Skip if we've already processed this email
					if (attendee.email && processedEmails.has(attendee.email)) {
						continue;
					}
					
					if (attendee.displayName && !attendees.includes(attendee.displayName)) {
						attendees.push(attendee.displayName);
						if (attendee.email) {
							processedEmails.add(attendee.email);
						}
					} else if (attendee.email && !attendees.some(name => name.includes(attendee.email.split('@')[0]))) {
						const emailName = attendee.email.split('@')[0].replace(/[._]/g, ' ');
						attendees.push(emailName);
						processedEmails.add(attendee.email);
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

	extractFolderNames(doc) {
		// Note: Folder functionality is currently disabled as folder information 
		// is not available in the Granola API response. This method is kept for future use.
		return [];
		
		/* 
		// Code preserved for when Granola API includes folder information
		const folderNames = [];
		
		try {
			// Handle single workspace_id
			if (doc.workspace_id && this.workspaces) {
				const folderName = this.findWorkspaceName(doc.workspace_id);
				if (folderName) {
					folderNames.push(folderName);
				}
			}
			
			// Handle multiple workspace IDs (if they exist)
			if (doc.workspace_ids && Array.isArray(doc.workspace_ids) && this.workspaces) {
				doc.workspace_ids.forEach(wsId => {
					const folderName = this.findWorkspaceName(wsId);
					if (folderName && !folderNames.includes(folderName)) {
						folderNames.push(folderName);
					}
				});
			}
			
			// Handle list IDs (single and multiple)
			if (doc.list_id && this.workspaces) {
				const folderName = this.findWorkspaceName(doc.list_id);
				if (folderName && !folderNames.includes(folderName)) {
					folderNames.push(folderName);
				}
			}
			
			if (doc.list_ids && Array.isArray(doc.list_ids) && this.workspaces) {
				doc.list_ids.forEach(listId => {
					const folderName = this.findWorkspaceName(listId);
					if (folderName && !folderNames.includes(folderName)) {
						folderNames.push(folderName);
					}
				});
			}
			
			// Check legacy folder properties
			const legacyFields = ['folder_name', 'folder', 'directory'];
			legacyFields.forEach(field => {
				if (doc[field] && !folderNames.includes(doc[field])) {
					folderNames.push(doc[field]);
				}
			});
			
			return folderNames;
		} catch (error) {
			console.error('Error extracting folder names:', error);
			return [];
		}
		*/
	}

	findWorkspaceName(workspaceId) {
		if (!this.workspaces || !workspaceId) {
			return null;
		}
		
		try {
			// Try different possible structures for workspaces response
			if (Array.isArray(this.workspaces)) {
				const workspace = this.workspaces.find(ws => ws.id === workspaceId);
				if (workspace && workspace.name) {
					console.log('Found workspace name:', workspace.name, 'for ID:', workspaceId);
					return workspace.name;
				}
			} else if (this.workspaces.workspaces && Array.isArray(this.workspaces.workspaces)) {
				const workspace = this.workspaces.workspaces.find(ws => ws.id === workspaceId);
				if (workspace && workspace.name) {
					console.log('Found workspace name:', workspace.name, 'for ID:', workspaceId);
					return workspace.name;
				}
			} else if (this.workspaces.lists && Array.isArray(this.workspaces.lists)) {
				const list = this.workspaces.lists.find(l => l.id === workspaceId);
				if (list && list.name) {
					console.log('Found list name:', list.name, 'for ID:', workspaceId);
					return list.name;
				}
			}
			
			console.log('Could not find matching workspace/list for ID:', workspaceId);
			return null;
		} catch (error) {
			console.error('Error finding workspace name:', error);
			return null;
		}
	}

	generateFolderTags(folderNames) {
		if (!this.settings.includeFolderTags || !folderNames || folderNames.length === 0) {
			return [];
		}
		
		try {
			const tags = [];
			
			for (const folderName of folderNames) {
				if (!folderName) continue;
				
				// Convert folder name to valid tag format
				// Remove special characters, replace spaces with hyphens, convert to lowercase
				let tag = folderName
					.replace(/[^\w\s-]/g, '') // Remove special chars except spaces and hyphens
					.trim()
					.replace(/\s+/g, '-') // Replace spaces with hyphens
					.toLowerCase();
				
				// Add folder/ prefix for better organization
				tag = 'folder/' + tag;
				
				if (tag && tag !== 'folder/' && !tags.includes(tag)) {
					tags.push(tag);
				}
			}
			
			return tags;
		} catch (error) {
			console.error('Error generating folder tags:', error);
			return [];
		}
	}

	generateGranolaUrl(docId) {
		if (!this.settings.includeGranolaUrl || !docId) {
			return null;
		}
		
		try {
			// Construct the Granola notes URL using the correct format
			return `https://notes.granola.ai/d/${docId}`;
		} catch (error) {
			console.error('Error generating Granola URL:', error);
			return null;
		}
	}

	async updateExistingNoteMetadata(file, doc) {
		try {
			// Read existing note content
			const content = await this.app.vault.read(file);
			
			// Extract all metadata
			const attendeeNames = this.extractAttendeeNames(doc);
			const attendeeTags = this.generateAttendeeTags(attendeeNames);
			const folderNames = this.extractFolderNames(doc);
			const folderTags = this.generateFolderTags(folderNames);
			const granolaUrl = this.generateGranolaUrl(doc.id);
			
			console.log('Updating metadata for existing note:');
			console.log('  Attendee Names:', attendeeNames);
			console.log('  Attendee Tags:', attendeeTags);
			console.log('  Granola URL:', granolaUrl);
			
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
					if (!tag.startsWith('person/') && !tag.startsWith('folder/')) {
						// Keep tags that are not person or folder tags
						frontmatterData.tags.push(tag);
					}
				} else if (line.includes(':') && !line.startsWith('  ')) {
					inTagsSection = false;
					const [key, ...valueParts] = line.split(':');
					const value = valueParts.join(':').trim();
					frontmatterData[key.trim()] = value;
				}
			}
			
			// Add new tags to existing tags
			if (!frontmatterData.tags) {
				frontmatterData.tags = [];
			}
			
			// Combine attendee and folder tags
			const newTags = [...attendeeTags, ...folderTags];
			
			// Add new tags
			for (const tag of newTags) {
				if (!frontmatterData.tags.includes(tag)) {
					frontmatterData.tags.push(tag);
				}
			}
			
			// Update or add Granola URL if enabled
			if (granolaUrl) {
				frontmatterData.granola_url = '"' + granolaUrl + '"';
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
			
			console.log('Successfully updated tags for existing note:', file.path);
			
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
			.setName('Skip Existing Notes')
			.setDesc('When enabled, notes that already exist will not be updated during sync. This preserves any manual tags, summaries, or other additions you\'ve made.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.skipExistingNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.skipExistingNotes = value;
					await this.plugin.saveSettings();
				});
			});

		// Create a heading for metadata settings
		containerEl.createEl('h3', { text: 'Note Metadata & Tags' });

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

		// Note: Folder tags setting is temporarily hidden as folder information is not yet available in Granola API
		// new obsidian.Setting(containerEl)
		// 	.setName('Include Folder Tags')
		// 	.setDesc('Add Granola folder/list names as tags in the frontmatter of each note. Supports multiple folders per note (e.g., folder/test-folder, folder/project-alpha)')
		// 	.addToggle(toggle => {
		// 		toggle.setValue(this.plugin.settings.includeFolderTags);
		// 		toggle.onChange(async (value) => {
		// 			this.plugin.settings.includeFolderTags = value;
		// 			await this.plugin.saveSettings();
		// 		});
		// 	});

		new obsidian.Setting(containerEl)
			.setName('Include Granola URL')
			.setDesc('Add a link back to the original Granola note in the frontmatter (e.g., granola_url: "https://notes.granola.ai/d/...")')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeGranolaUrl);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeGranolaUrl = value;
					await this.plugin.saveSettings();
				});
			});

		// Create a heading for daily note integration
		containerEl.createEl('h3', { text: 'Daily Note Integration' });

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

		// Create a heading for file organization settings
		containerEl.createEl('h3', { text: 'File Organization' });

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
