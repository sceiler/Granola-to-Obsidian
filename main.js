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
	skipExistingNotes: false
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
						
						if (this.settings.enableDailyNoteIntegration && doc.created_at) {
							const noteDate = new Date(doc.created_at).toDateString();
							if (noteDate === today) {
								const noteData = {};
								noteData.title = doc.title || 'Untitled Granola Note';
								noteData.filename = this.generateFilename(doc) + '.md';
								
								const createdDate = new Date(doc.created_at);
								const hours = String(createdDate.getHours()).padStart(2, '0');
								const minutes = String(createdDate.getMinutes()).padStart(2, '0');
								noteData.time = hours + ':' + minutes;
								
								todaysNotes.push(noteData);
							}
						}
					}
				} catch (error) {
					console.error('Error processing document ' + doc.title + ':', error);
				}
			}

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
				if (this.settings.skipExistingNotes) {
					console.log('Skipping existing note (skipExistingNotes enabled): ' + existingFile.path);
					return true; // Return true so it counts as "synced" but we don't update
				}

				// Update existing note
				try {
					const markdownContent = this.convertProseMirrorToMarkdown(contentToParse);

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
			
			const sectionHeader = this.settings.dailyNoteSectionName;
			const notesList = todaysNotes
				.sort((a, b) => a.time.localeCompare(b.time))
				.map(note => '- ' + note.time + ' [[' + this.settings.syncDirectory + '/' + note.filename + '|' + note.title + ']]')
				.join('\n');
			
			const granolaSection = sectionHeader + '\n' + notesList;

			const sectionRegex = new RegExp('^' + this.escapeRegex(sectionHeader) + '$', 'm');
			const nextSectionRegex = /^## /m;
			
			if (sectionRegex.test(content)) {
				const lines = content.split('\n');
				const sectionIndex = lines.findIndex(line => line.trim() === sectionHeader.trim());
				
				if (sectionIndex !== -1) {
					let endIndex = lines.length;
					for (let i = sectionIndex + 1; i < lines.length; i++) {
						if (lines[i].match(nextSectionRegex)) {
							endIndex = i;
							break;
						}
					}
					
					const beforeSection = lines.slice(0, sectionIndex).join('\n');
					const afterSection = lines.slice(endIndex).join('\n');
					content = beforeSection + '\n' + granolaSection + '\n' + afterSection;
				}
			} else {
				content += '\n\n' + granolaSection;
			}

			await this.app.vault.modify(dailyNote, content);
			console.log('Updated daily note with Granola meetings');
			
		} catch (error) {
			console.error('Error updating daily note:', error);
		}
	}

	async getDailyNote() {
		try {
			const dailyNotesPlugin = this.app.internalPlugins.plugins['daily-notes'];
			if (!dailyNotesPlugin || !dailyNotesPlugin.enabled) {
				console.log('Daily notes plugin not enabled');
				return null;
			}

			console.log('Daily notes plugin found and enabled');

			const today = new Date();
			let dateFormat = 'YYYY-MM-DD'; // Default format
			let dailyNotesFolder = ''; // Default folder
			
			// Try to get the date format and folder from plugin settings
			if (dailyNotesPlugin.instance && dailyNotesPlugin.instance.options) {
				if (dailyNotesPlugin.instance.options.format) {
					dateFormat = dailyNotesPlugin.instance.options.format;
				}
				if (dailyNotesPlugin.instance.options.folder) {
					dailyNotesFolder = dailyNotesPlugin.instance.options.folder;
				}
			}
			
			console.log('Daily note settings - Format:', dateFormat, 'Folder template:', dailyNotesFolder || '(root)');
			
			const todayString = this.formatDate(today.toISOString(), dateFormat);
			console.log('Today string:', todayString);
			
			// Expand date format variables in the folder path
			let expandedFolder = dailyNotesFolder;
			if (dailyNotesFolder) {
				expandedFolder = this.formatDate(today.toISOString(), dailyNotesFolder);
			}
			
			console.log('Expanded folder path:', expandedFolder || '(root)');
			
			const dailyNotePath = expandedFolder ? 
				expandedFolder + '/' + todayString + '.md' : 
				todayString + '.md';
			
			console.log('Looking for daily note at path:', dailyNotePath);

			let dailyNote = this.app.vault.getAbstractFileByPath(dailyNotePath);
			
			if (!dailyNote) {
				console.log('Daily note not found, attempting to create it');
				
				// Ensure the folder exists
				if (expandedFolder) {
					const folder = this.app.vault.getAbstractFileByPath(expandedFolder);
					if (!folder) {
						console.log('Daily notes folder does not exist, creating it:', expandedFolder);
						await this.app.vault.createFolder(expandedFolder);
					}
				}
				
				try {
					dailyNote = await this.app.vault.create(dailyNotePath, '');
					console.log('Created new daily note:', dailyNotePath);
				} catch (createError) {
					console.error('Failed to create daily note:', createError);
					return null;
				}
			} else {
				console.log('Found existing daily note:', dailyNotePath);
			}

			return dailyNote;
		} catch (error) {
			console.error('Error getting daily note:', error);
			return null;
		}
	}

	escapeRegex(string) {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
