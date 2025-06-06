const { Plugin, PluginSettingTab, Setting, Notice, TFolder, requestUrl } = require('obsidian');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DEFAULT_SETTINGS = {
	syncDirectory: 'Granola',
	notePrefix: '',
	authKeyPath: 'Library/Application Support/Granola/supabase.json',
	filenameTemplate: '{title}',
	dateFormat: 'YYYY-MM-DD',
	autoSyncFrequency: 300000 // 5 minutes in milliseconds
};

module.exports = class GranolaSyncPlugin extends Plugin {
	async onload() {
		this.autoSyncInterval = null;
		this.settings = DEFAULT_SETTINGS;
		
		// Load settings safely
		try {
			const data = await this.loadData();
			if (data) {
				this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
			}
		} catch (error) {
			console.log('Could not load settings, using defaults');
		}

		// Add ribbon icon
		this.addRibbonIcon('sync', 'Sync Granola Notes', () => {
			this.syncNotes();
		});

		// Add command
		this.addCommand({
			id: 'sync-granola-notes',
			name: 'Sync Granola Notes',
			callback: () => {
				this.syncNotes();
			}
		});

		// Add settings tab
		this.addSettingTab(new GranolaSyncSettingTab(this.app, this));

		// Setup auto-sync after a short delay to ensure everything is ready
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
			// Restart auto-sync with new frequency
			this.setupAutoSync();
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	}

	setupAutoSync() {
		// Clear existing interval
		this.clearAutoSync();
		
		// Set up new interval if enabled
		if (this.settings.autoSyncFrequency > 0) {
			this.autoSyncInterval = window.setInterval(() => {
				console.log('Auto-syncing Granola notes...');
				this.syncNotes();
			}, this.settings.autoSyncFrequency);
			console.log(`Auto-sync enabled: every ${this.getFrequencyLabel(this.settings.autoSyncFrequency)}`);
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
		if (frequency < 60000) return `${frequency / 1000} seconds`;
		if (minutes < 60) return `${minutes} minutes`;
		return `${hours} hours`;
	}

	async syncNotes() {
		try {
			new Notice('Starting Granola sync...');
			
			// Ensure sync directory exists
			await this.ensureDirectoryExists();

			// Load credentials
			const token = await this.loadCredentials();
			if (!token) {
				new Notice('Failed to load Granola credentials');
				return;
			}

			// Fetch documents from Granola API
			const documents = await this.fetchGranolaDocuments(token);
			if (!documents) {
				new Notice('Failed to fetch documents from Granola');
				return;
			}

			// Process and save documents
			let syncedCount = 0;
			for (const doc of documents) {
				try {
					const success = await this.processDocument(doc);
					if (success) syncedCount++;
				} catch (error) {
					console.error(`Error processing document ${doc.title}:`, error);
				}
			}

			new Notice(`Granola sync completed: ${syncedCount} notes synced`);
			
		} catch (error) {
			console.error('Granola sync failed:', error);
			new Notice('Granola sync failed: ' + error.message);
		}
	}

	async loadCredentials() {
		try {
			const authPath = path.resolve(os.homedir(), this.settings.authKeyPath);
			const credentialsFile = fs.readFileSync(authPath, 'utf8');
			const data = JSON.parse(credentialsFile);
			
			// Parse the cognito_tokens string into an object
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
			const response = await requestUrl({
				url: 'https://api.granola.ai/v2/get-documents',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
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

			console.log(`Successfully fetched ${apiResponse.docs.length} documents from Granola`);
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

			switch (nodeType) {
				case 'heading':
					const level = node.attrs?.level || 1;
					const headingText = nodeContent.map(processNode).join('');
					return '#'.repeat(level) + ' ' + headingText + '\n\n';

				case 'paragraph':
					const paraText = nodeContent.map(processNode).join('');
					return paraText + '\n\n';

				case 'bulletList':
					const items = nodeContent
						.filter((item) => item.type === 'listItem')
						.map((item) => {
							const itemContent = (item.content || []).map(processNode).join('').trim();
							return '- ' + itemContent;
						});
					return items.join('\n') + '\n\n';

				case 'text':
					return text;

				default:
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

	generateFilename(doc) {
		const title = doc.title || 'Untitled Granola Note';
		const docId = doc.id || 'unknown_id';
		
		// Parse dates using custom format
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

		// Build filename from template
		let filename = this.settings.filenameTemplate
			.replace(/{title}/g, title)
			.replace(/{id}/g, docId)
			.replace(/{created_date}/g, createdDate)
			.replace(/{updated_date}/g, updatedDate)
			.replace(/{created_time}/g, createdTime)
			.replace(/{updated_time}/g, updatedTime)
			.replace(/{created_datetime}/g, createdDateTime)
			.replace(/{updated_datetime}/g, updatedDateTime);

		// Add prefix if specified
		if (this.settings.notePrefix) {
			filename = this.settings.notePrefix + filename;
		}

		// Sanitize the final filename
		const invalidChars = /[<>:"/\\|?*]/g;
		filename = filename.replace(invalidChars, '');
		filename = filename.replace(/\s+/g, '_');
		
		return filename;
	}

	async processDocument(doc) {
		try {
			const title = doc.title || 'Untitled Granola Note';
			const docId = doc.id || 'unknown_id';
			
			console.log(`Processing document: ${title} (ID: ${docId})`);

			// Find content to parse
			let contentToParse = null;
			if (doc.last_viewed_panel?.content?.type === 'doc') {
				contentToParse = doc.last_viewed_panel.content;
			}

			if (!contentToParse) {
				console.log(`Skipping document '${title}' - no suitable content found`);
				return false;
			}

			// Convert to markdown
			const markdownContent = this.convertProseMirrorToMarkdown(contentToParse);

			// Create frontmatter
			let frontmatter = '---\n';
			frontmatter += `granola_id: ${docId}\n`;
			const escapedTitle = title.replace(/"/g, '\\"');
			frontmatter += `title: "${escapedTitle}"\n`;
			
			if (doc.created_at) {
				frontmatter += `created_at: ${doc.created_at}\n`;
			}
			if (doc.updated_at) {
				frontmatter += `updated_at: ${doc.updated_at}\n`;
			}
			frontmatter += '---\n\n';

			const finalMarkdown = frontmatter + markdownContent;

			// Save file
			const filename = this.generateFilename(doc) + '.md';
			const filepath = path.join(this.settings.syncDirectory, filename);

			await this.app.vault.create(filepath, finalMarkdown);
			console.log(`Successfully saved: ${filepath}`);
			return true;

		} catch (error) {
			// If file already exists, update it
			if (error.message.includes('already exists')) {
				try {
					const filename = this.generateFilename(doc) + '.md';
					const filepath = path.join(this.settings.syncDirectory, filename);
					
					// Get existing file and update it
					const existingFile = this.app.vault.getAbstractFileByPath(filepath);
					if (existingFile) {
						const title = doc.title || 'Untitled Granola Note';
						const docId = doc.id || 'unknown_id';
						
						let contentToParse = null;
						if (doc.last_viewed_panel?.content?.type === 'doc') {
							contentToParse = doc.last_viewed_panel.content;
						}

						if (contentToParse) {
							const markdownContent = this.convertProseMirrorToMarkdown(contentToParse);

							let frontmatter = '---\n';
							frontmatter += `granola_id: ${docId}\n`;
							const escapedTitle = title.replace(/"/g, '\\"');
							frontmatter += `title: "${escapedTitle}"\n`;
							
							if (doc.created_at) {
								frontmatter += `created_at: ${doc.created_at}\n`;
							}
							if (doc.updated_at) {
								frontmatter += `updated_at: ${doc.updated_at}\n`;
							}
							frontmatter += '---\n\n';

							const finalMarkdown = frontmatter + markdownContent;
							await this.app.vault.modify(existingFile, finalMarkdown);
							console.log(`Successfully updated: ${filepath}`);
							return true;
						}
					}
				} catch (updateError) {
					console.error(`Error updating file:`, updateError);
				}
			}
			console.error(`Error processing document:`, error);
			return false;
		}
	}

	async ensureDirectoryExists() {
		try {
			const folder = this.app.vault.getAbstractFileByPath(this.settings.syncDirectory);
			if (!folder || !(folder instanceof TFolder)) {
				await this.app.vault.createFolder(this.settings.syncDirectory);
			}
		} catch (error) {
			console.error('Error creating directory:', error);
		}
	}
};

class GranolaSyncSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Granola Sync Settings' });

		new Setting(containerEl)
			.setName('Sync Directory')
			.setDesc('Directory within your vault where Granola notes will be synced')
			.addText(text => text
				.setPlaceholder('Granola')
				.setValue(this.plugin.settings.syncDirectory)
				.onChange(async (value) => {
					this.plugin.settings.syncDirectory = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Note Prefix')
			.setDesc('Optional prefix to add to all synced note titles')
			.addText(text => text
				.setPlaceholder('granola-')
				.setValue(this.plugin.settings.notePrefix)
				.onChange(async (value) => {
					this.plugin.settings.notePrefix = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auth Key Path')
			.setDesc('Path to your Granola authentication key file')
			.addText(text => text
				.setPlaceholder('Library/Application Support/Granola/supabase.json')
				.setValue(this.plugin.settings.authKeyPath)
				.onChange(async (value) => {
					this.plugin.settings.authKeyPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Date Format')
			.setDesc('Format for dates in filenames. Use YYYY (year), MM (month), DD (day). Examples: YYYY-MM-DD, DD-MM-YYYY, MM-DD-YY')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Filename Template')
			.setDesc('Template for generating filenames. Available variables: {title}, {id}, {created_date}, {updated_date}, {created_time}, {updated_time}, {created_datetime}, {updated_datetime}')
			.addText(text => text
				.setPlaceholder('{created_date}_{title}')
				.setValue(this.plugin.settings.filenameTemplate)
				.onChange(async (value) => {
					this.plugin.settings.filenameTemplate = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Preview Date Format')
			.setDesc('See how your date format will look')
			.addButton(button => button
				.setButtonText('Preview Date')
				.onClick(() => {
					const sampleDate = new Date().toISOString();
					const formattedDate = this.plugin.formatDate(sampleDate, this.plugin.settings.dateFormat);
					new Notice(`Date preview: ${formattedDate}`, 4000);
				}));

		new Setting(containerEl)
			.setName('Preview Filename')
			.setDesc('See how your filename template will look')
			.addButton(button => button
				.setButtonText('Preview')
				.onClick(() => {
					// Create a sample document for preview
					const sampleDoc = {
						title: 'Team Standup Meeting',
						id: 'abc123',
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString()
					};
					
					const previewFilename = this.plugin.generateFilename(sampleDoc) + '.md';
					new Notice(`Preview: ${previewFilename}`, 5000);
				}));

		new Setting(containerEl)
			.setName('Auto-Sync Frequency')
			.setDesc('How often to automatically sync notes. Set to "Never" to disable auto-sync.')
			.addDropdown(dropdown => {
				dropdown.addOption('0', 'Never');
				dropdown.addOption('60000', 'Every 1 minute');
				dropdown.addOption('120000', 'Every 2 minutes');
				dropdown.addOption('300000', 'Every 5 minutes');
				dropdown.addOption('600000', 'Every 10 minutes');
				dropdown.addOption('900000', 'Every 15 minutes');
				dropdown.addOption('1800000', 'Every 30 minutes');
				dropdown.addOption('3600000', 'Every 1 hour');
				dropdown.addOption('7200000', 'Every 2 hours');
				dropdown.addOption('21600000', 'Every 6 hours');
				dropdown.addOption('43200000', 'Every 12 hours');
				dropdown.addOption('86400000', 'Every 24 hours');
				
				dropdown.setValue(String(this.plugin.settings.autoSyncFrequency));
				dropdown.onChange(async (value) => {
					this.plugin.settings.autoSyncFrequency = parseInt(value);
					await this.plugin.saveSettings();
					
					// Show confirmation
					const label = this.plugin.getFrequencyLabel(parseInt(value));
					new Notice(`Auto-sync frequency updated: ${label}`);
				});
			});

		new Setting(containerEl)
			.setName('Manual Sync')
			.setDesc('Click to manually sync your Granola notes')
			.addButton(button => button
				.setButtonText('Sync Now')
				.setCta()
				.onClick(async () => {
					await this.plugin.syncNotes();
				}));
	}
}