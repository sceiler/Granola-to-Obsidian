import { App, PluginSettingTab, Setting } from 'obsidian';
import type GranolaSyncPlugin from './main';
import { GRANOLA_API_DOCS_URL, MIN_DOCUMENT_LIMIT, MAX_DOCUMENT_LIMIT, REQUIRED_FRONTMATTER_FIELDS } from './constants';

const FIELD_LABELS: Record<string, string> = {
	'category': 'Category',
	'type': 'Type (empty)',
	'date': 'Date',
	'dateEnd': 'Date end',
	'noteStarted': 'Note started',
	'noteEnded': 'Note ended',
	'org': 'Organization',
	'loc': 'Location',
	'people': 'People',
	'topics': 'Topics (empty)',
	'tags': 'Tags',
	'emails': 'Emails',
	'granola_id': 'Granola ID',
	'title': 'Title',
	'granola_url': 'Granola URL',
};

export class GranolaSyncSettingTab extends PluginSettingTab {
	plugin: GranolaSyncPlugin;

	constructor(app: App, plugin: GranolaSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Authentication
		containerEl.createEl('h3', { text: 'Authentication' });

		const apiKeySetting = new Setting(containerEl)
			.setName('API key')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('grn_…');
				text.setValue(this.plugin.settings.apiKey);
				text.onChange(async (value) => {
					this.plugin.settings.apiKey = value.trim();
					await this.plugin.saveSettings();
				});
			});

		const apiKeyDesc = apiKeySetting.descEl;
		apiKeyDesc.createSpan({ text: 'Personal API key from Granola. Generate one at ' });
		apiKeyDesc.createEl('a', {
			text: 'docs.granola.ai → Personal API',
			href: GRANOLA_API_DOCS_URL,
		});
		apiKeyDesc.createSpan({ text: '. Requires a Business or Enterprise plan.' });

		// Sync settings
		containerEl.createEl('h3', { text: 'Sync settings' });

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
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
						const clampedLimit = Math.max(MIN_DOCUMENT_LIMIT, Math.min(MAX_DOCUMENT_LIMIT, limit));
						this.plugin.settings.documentSyncLimit = clampedLimit;
						text.setValue(String(clampedLimit));
						await this.plugin.saveSettings();
					}
				});
			});

		new Setting(containerEl)
			.setName('Skip existing notes')
			.setDesc("Don't update notes that already exist (preserves manual edits)")
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.skipExistingNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.skipExistingNotes = value;
					await this.plugin.saveSettings();
				});
			});

		// Filename settings
		containerEl.createEl('h3', { text: 'Filename settings' });

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
			.setName('When filename exists')
			.setDesc('What to do when a file with the same name exists')
			.addDropdown(dropdown => {
				dropdown.addOption('timestamp', 'Add timestamp');
				dropdown.addOption('skip', 'Skip');

				dropdown.setValue(this.plugin.settings.existingFileAction);
				dropdown.onChange(async (value) => {
					this.plugin.settings.existingFileAction = value as 'timestamp' | 'skip';
					await this.plugin.saveSettings();
				});
			});

		// Note content settings
		containerEl.createEl('h3', { text: 'Note content' });

		new Setting(containerEl)
			.setName('Include Enhanced Notes')
			.setDesc('Include AI-generated enhanced notes (the meeting summary)')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeEnhancedNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeEnhancedNotes = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Include transcript')
			.setDesc('Include full meeting transcript (slower sync — one extra API call per note)')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeFullTranscript);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeFullTranscript = value;
					await this.plugin.saveSettings();
				});
			});

		// Frontmatter settings
		containerEl.createEl('h3', { text: 'Frontmatter' });

		new Setting(containerEl)
			.setName('Include Granola URL')
			.setDesc('Add link back to original Granola note')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeGranolaUrl);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeGranolaUrl = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Include emails')
			.setDesc('Include attendee email addresses')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeEmails);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeEmails = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
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
			new Setting(containerEl)
				.setName('Auto-detect my name')
				.setDesc('Use the API key owner’s name (the account this key belongs to)')
				.addToggle(toggle => {
					toggle.setValue(this.plugin.settings.autoDetectMyName);
					toggle.onChange(async (value) => {
						this.plugin.settings.autoDetectMyName = value;
						await this.plugin.saveSettings();
						this.display();
					});
				});

			new Setting(containerEl)
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

		// Attendee name overrides
		containerEl.createEl('h3', { text: 'Attendee name overrides' });

		const overrides = this.plugin.settings.attendeeNameOverrides || [];

		const overrideDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
		overrideDesc.style.marginTop = '-10px';
		overrideDesc.style.marginBottom = '10px';
		overrideDesc.textContent = 'Map an attendee’s email to a fixed display name. Useful for fixing diacritics or filling in missing last names.';

		for (let i = 0; i < overrides.length; i++) {
			const override = overrides[i];
			new Setting(containerEl)
				.setName('Email → Name')
				.addText(text => {
					text.setPlaceholder('name@example.com');
					text.setValue(override.email);
					text.onChange(async (value) => {
						this.plugin.settings.attendeeNameOverrides[i].email = value;
						await this.plugin.saveSettings();
					});
				})
				.addText(text => {
					text.setPlaceholder('Jane Doe');
					text.setValue(override.name);
					text.onChange(async (value) => {
						this.plugin.settings.attendeeNameOverrides[i].name = value;
						await this.plugin.saveSettings();
					});
				})
				.addExtraButton(button => {
					button.setIcon('trash');
					button.setTooltip('Remove override');
					button.onClick(async () => {
						this.plugin.settings.attendeeNameOverrides.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					});
				});
		}

		new Setting(containerEl)
			.addButton(button => {
				button.setButtonText('Add attendee override');
				button.onClick(async () => {
					if (!this.plugin.settings.attendeeNameOverrides) {
						this.plugin.settings.attendeeNameOverrides = [];
					}
					this.plugin.settings.attendeeNameOverrides.push({ email: '', name: '' });
					await this.plugin.saveSettings();
					this.display();
				});
			});

		// Custom frontmatter template
		containerEl.createEl('h3', { text: 'Custom frontmatter template' });

		new Setting(containerEl)
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
			new Setting(containerEl)
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

			new Setting(containerEl)
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

		// Frontmatter field order
		containerEl.createEl('h3', { text: 'Frontmatter field order' });

		const fieldOrderDesc = containerEl.createEl('p', {
			text: 'Enable/disable fields and reorder them. Required fields cannot be disabled.',
			cls: 'setting-item-description'
		});
		fieldOrderDesc.style.marginBottom = '10px';

		const fieldListContainer = containerEl.createDiv({ cls: 'granola-field-order-list' });

		for (let i = 0; i < this.plugin.settings.frontmatterFields.length; i++) {
			const field = this.plugin.settings.frontmatterFields[i];
			const isRequired = REQUIRED_FRONTMATTER_FIELDS.includes(field.key);
			const isFirst = i === 0;
			const isLast = i === this.plugin.settings.frontmatterFields.length - 1;

			const fieldSetting = new Setting(fieldListContainer)
				.setName(FIELD_LABELS[field.key] || field.key)
				.setDesc(isRequired ? 'Required' : '');

			// Toggle for enable/disable
			fieldSetting.addToggle(toggle => {
				toggle.setValue(field.enabled);
				toggle.setDisabled(isRequired);
				toggle.onChange(async (value) => {
					this.plugin.settings.frontmatterFields[i].enabled = value;
					await this.plugin.saveSettings();
				});
			});

			// Up button
			fieldSetting.addButton(button => {
				button.setIcon('arrow-up');
				button.setTooltip('Move up');
				button.setDisabled(isFirst);
				button.onClick(async () => {
					if (i > 0) {
						const temp = this.plugin.settings.frontmatterFields[i - 1];
						this.plugin.settings.frontmatterFields[i - 1] = this.plugin.settings.frontmatterFields[i];
						this.plugin.settings.frontmatterFields[i] = temp;
						await this.plugin.saveSettings();
						this.display();
					}
				});
			});

			// Down button
			fieldSetting.addButton(button => {
				button.setIcon('arrow-down');
				button.setTooltip('Move down');
				button.setDisabled(isLast);
				button.onClick(async () => {
					if (i < this.plugin.settings.frontmatterFields.length - 1) {
						const temp = this.plugin.settings.frontmatterFields[i + 1];
						this.plugin.settings.frontmatterFields[i + 1] = this.plugin.settings.frontmatterFields[i];
						this.plugin.settings.frontmatterFields[i] = temp;
						await this.plugin.saveSettings();
						this.display();
					}
				});
			});
		}

		// Daily note integration
		containerEl.createEl('h3', { text: 'Daily note integration' });

		new Setting(containerEl)
			.setName('Enable daily note integration')
			.setDesc("Add today's meetings to your daily note")
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.enableDailyNoteIntegration);
				toggle.onChange(async (value) => {
					this.plugin.settings.enableDailyNoteIntegration = value;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.enableDailyNoteIntegration) {
			new Setting(containerEl)
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
		containerEl.createEl('h3', { text: 'Actions' });

		new Setting(containerEl)
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
