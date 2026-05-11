import {
	Notice,
	Plugin,
	TFile,
	requestUrl,
	type RequestUrlResponse,
} from 'obsidian';
import * as path from 'path';

import type {
	GranolaSyncSettings,
	GranolaNote,
	GranolaNoteSummary,
	GranolaUser,
	ListNotesResponse,
	TodaysNote,
} from './types';

import {
	DEFAULT_SETTINGS,
	DEFAULT_FRONTMATTER_FIELDS,
	REQUIRED_FRONTMATTER_FIELDS,
	API_BATCH_SIZE,
	GRANOLA_API_BASE,
	GRANOLA_API_DOCS_URL,
	RATE_LIMIT_MIN_INTERVAL_MS,
} from './constants';

import {
	escapeYamlValue,
	formatDate,
	formatDateTimeProperty,
	formatDateWithPattern,
	convertGermanUmlauts,
	transcriptToMarkdown,
	extractNameFromEmail,
	extractCompanyFromEmail,
} from './utils';

import { GranolaSyncSettingTab } from './settings';

class GranolaApiError extends Error {
	constructor(public readonly status: number, message: string) {
		super(message);
		this.name = 'GranolaApiError';
	}
}

export default class GranolaSyncPlugin extends Plugin {
	settings: GranolaSyncSettings = DEFAULT_SETTINGS;
	private autoSyncInterval: number | null = null;
	private statusBarItem: HTMLElement | null = null;
	private ribbonIconEl: HTMLElement | null = null;
	private lastApiCallAt = 0;

	async onload(): Promise<void> {
		await this.loadSettings();

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

	onunload(): void {
		this.clearAutoSync();
		if (this.statusBarItem) {
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// Migration: initialize frontmatter fields if not present
		if (!this.settings.frontmatterFields || this.settings.frontmatterFields.length === 0) {
			this.settings.frontmatterFields = DEFAULT_FRONTMATTER_FIELDS.map(f => ({ ...f }));
		}

		// Migration: strip retired settings keys from prior installs.
		const retired = ['authKeyPath', 'downloadAttachments', 'enableLocationDetection', 'platformMappings'];
		const raw = (data ?? {}) as Record<string, unknown>;
		if (retired.some(k => k in raw)) {
			for (const k of retired) delete (this.settings as unknown as Record<string, unknown>)[k];
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.setupAutoSync();
	}

	private updateStatusBar(status: 'Idle' | 'Syncing' | 'Complete' | 'Error', count?: number | string): void {
		if (!this.statusBarItem) return;

		let text = 'Granola: ';

		if (status === 'Idle') {
			text += 'Idle';
		} else if (status === 'Syncing') {
			text += typeof count === 'string' ? count : 'Syncing...';
		} else if (status === 'Complete') {
			text += count + ' synced';
			window.setTimeout(() => this.updateStatusBar('Idle'), 3000);
		} else if (status === 'Error') {
			text += 'Error - ' + (count || 'sync failed');
			window.setTimeout(() => this.updateStatusBar('Idle'), 5000);
		}

		this.statusBarItem.setText(text);
	}

	private setupAutoSync(): void {
		this.clearAutoSync();

		if (this.settings.autoSyncFrequency > 0) {
			this.autoSyncInterval = window.setInterval(() => {
				this.syncNotes().catch(error => {
					console.error('Auto-sync failed:', error);
					this.updateStatusBar('Error', 'auto-sync failed');
				});
			}, this.settings.autoSyncFrequency);
		}
	}

	private clearAutoSync(): void {
		if (this.autoSyncInterval) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}
	}

	async syncNotes(): Promise<void> {
		try {
			this.updateStatusBar('Syncing');

			await this.ensureDirectoryExists();

			const apiKey = this.settings.apiKey?.trim();
			if (!apiKey) {
				new Notice('Granola: API key not set. Open plugin settings and paste your key from notes.granola.ai.');
				this.updateStatusBar('Error', 'API key missing');
				return;
			}

			const syncStartedAt = new Date().toISOString();

			let summaries: GranolaNoteSummary[];
			try {
				summaries = await this.fetchNotes(apiKey, this.settings.lastSyncAt);
			} catch (error) {
				this.handleApiError(error, 'list notes');
				return;
			}

			let syncedCount = 0;
			const todaysNotes: TodaysNote[] = [];
			const today = new Date().toDateString();

			for (let i = 0; i < summaries.length; i++) {
				const summary = summaries[i];

				if (summaries.length > 30 && i % 10 === 0) {
					this.updateStatusBar('Syncing', `${i + 1}/${summaries.length}`);
				}

				try {
					const note = await this.fetchNote(summary.id, apiKey, {
						includeTranscript: this.settings.includeFullTranscript,
					});

					const success = await this.processDocument(note);
					if (success) {
						syncedCount++;
					}

					if (this.settings.enableDailyNoteIntegration && note.created_at) {
						const noteDate = new Date(note.created_at).toDateString();
						if (noteDate === today) {
							const actualFile = await this.findExistingNoteByGranolaId(note.id);
							if (actualFile) {
								const createdDate = new Date(note.created_at);
								const hours = String(createdDate.getHours()).padStart(2, '0');
								const minutes = String(createdDate.getMinutes()).padStart(2, '0');
								todaysNotes.push({
									title: note.title || 'Untitled Granola Note',
									actualFilePath: actualFile.path,
									time: hours + ':' + minutes
								});
							}
						}
					}
				} catch (error) {
					if (error instanceof GranolaApiError && error.status === 401) {
						this.handleApiError(error, 'fetch note');
						return;
					}
					console.error(`Error processing note ${summary.title ?? summary.id}:`, error);
				}
			}

			if (this.settings.enableDailyNoteIntegration && todaysNotes.length > 0) {
				await this.updateDailyNote(todaysNotes);
			}

			this.settings.lastSyncAt = syncStartedAt;
			await this.saveData(this.settings);

			this.updateStatusBar('Complete', syncedCount);

		} catch (error) {
			console.error('Granola sync failed:', error);
			this.updateStatusBar('Error', 'sync failed');
		}
	}

	private handleApiError(error: unknown, context: string): void {
		if (error instanceof GranolaApiError && error.status === 401) {
			new Notice('Granola: API key rejected (401). Check your key in plugin settings.');
			this.updateStatusBar('Error', 'invalid API key');
			return;
		}
		console.error(`Granola ${context} failed:`, error);
		this.updateStatusBar('Error', `${context} failed`);
	}

	private async throttle(): Promise<void> {
		const elapsed = Date.now() - this.lastApiCallAt;
		if (elapsed < RATE_LIMIT_MIN_INTERVAL_MS) {
			await new Promise(r => window.setTimeout(r, RATE_LIMIT_MIN_INTERVAL_MS - elapsed));
		}
		this.lastApiCallAt = Date.now();
	}

	private async granolaRequest(url: string, apiKey: string): Promise<RequestUrlResponse> {
		await this.throttle();
		let response = await requestUrl({
			url,
			method: 'GET',
			headers: { 'Authorization': `Bearer ${apiKey}` },
			throw: false,
		});

		// One backoff retry on 429.
		if (response.status === 429) {
			const retryAfterHeader = response.headers?.['retry-after'] ?? response.headers?.['Retry-After'];
			const retryAfterMs = retryAfterHeader ? Math.max(1000, Number(retryAfterHeader) * 1000) : 2000;
			await new Promise(r => window.setTimeout(r, retryAfterMs));
			this.lastApiCallAt = Date.now();
			response = await requestUrl({
				url,
				method: 'GET',
				headers: { 'Authorization': `Bearer ${apiKey}` },
				throw: false,
			});
		}

		if (response.status < 200 || response.status >= 300) {
			const message = (() => {
				try {
					const body = response.json as { message?: string; error?: string };
					return body?.message || body?.error || `HTTP ${response.status}`;
				} catch {
					return `HTTP ${response.status}`;
				}
			})();
			throw new GranolaApiError(response.status, message);
		}

		return response;
	}

	private async fetchNotes(apiKey: string, updatedAfter?: string): Promise<GranolaNoteSummary[]> {
		const all: GranolaNoteSummary[] = [];
		const cap = this.settings.documentSyncLimit;
		let cursor: string | null = null;

		while (all.length < cap) {
			const params = new URLSearchParams();
			params.set('page_size', String(API_BATCH_SIZE));
			if (cursor) params.set('cursor', cursor);
			if (updatedAfter) params.set('updated_after', updatedAfter);

			const response = await this.granolaRequest(`${GRANOLA_API_BASE}/v1/notes?${params.toString()}`, apiKey);
			const body = response.json as ListNotesResponse;

			if (!body?.notes) break;
			all.push(...body.notes);

			if (!body.hasMore || !body.cursor) break;
			cursor = body.cursor;

			if (all.length > 100) {
				this.updateStatusBar('Syncing', `${all.length} listed`);
			}
		}

		if (all.length > cap) all.length = cap;
		return all;
	}

	private async fetchNote(noteId: string, apiKey: string, options: { includeTranscript: boolean }): Promise<GranolaNote> {
		const params = options.includeTranscript ? '?include=transcript' : '';
		const response = await this.granolaRequest(`${GRANOLA_API_BASE}/v1/notes/${noteId}${params}`, apiKey);
		return response.json as GranolaNote;
	}

	private extractCompanyNames(note: GranolaNote): string[] {
		const companies = new Set<string>();
		try {
			for (const attendee of note.attendees) {
				const email = attendee.email?.toLowerCase();
				if (!email) continue;
				const company = extractCompanyFromEmail(email);
				if (company) companies.add(company);
			}
		} catch (error) {
			console.error('Error extracting company names:', error);
		}
		return Array.from(companies);
	}

	private getEffectiveMyName(note: GranolaNote): string {
		const manual = this.settings.myName?.trim();
		if (manual) return manual;
		if (this.settings.autoDetectMyName) {
			return note.owner?.name?.trim() || '';
		}
		return '';
	}

	private resolveAttendeeName(attendee: GranolaUser, overrideMap: Map<string, string>): string | null {
		const email = attendee.email?.toLowerCase();
		if (email) {
			const override = overrideMap.get(email);
			if (override) return override;
		}
		const name = attendee.name?.trim();
		if (name) return name;
		if (attendee.email) return extractNameFromEmail(attendee.email);
		return null;
	}

	private buildOverrideMap(): Map<string, string> {
		const overrideMap = new Map<string, string>();
		for (const o of this.settings.attendeeNameOverrides ?? []) {
			const email = o.email?.trim().toLowerCase();
			const name = o.name?.trim();
			if (email && name) overrideMap.set(email, name);
		}
		return overrideMap;
	}

	private extractAttendeeNames(note: GranolaNote): string[] {
		const overrideMap = this.buildOverrideMap();
		const names: string[] = [];
		try {
			for (const attendee of note.attendees) {
				const resolved = this.resolveAttendeeName(attendee, overrideMap);
				if (resolved && !names.includes(resolved)) {
					names.push(resolved);
				}
			}
		} catch (error) {
			console.error('Error extracting attendee names:', error);
		}
		return names;
	}

	private extractAttendeeEmails(note: GranolaNote): string[] {
		const seen = new Set<string>();
		const emails: string[] = [];
		for (const attendee of note.attendees) {
			if (attendee.email && !seen.has(attendee.email)) {
				emails.push(attendee.email);
				seen.add(attendee.email);
			}
		}
		return emails;
	}

	private generatePeopleLinks(attendeeNames: string[], note: GranolaNote): string[] {
		if (!attendeeNames || attendeeNames.length === 0) {
			return [];
		}

		const links: string[] = [];
		const myName = this.getEffectiveMyName(note);

		for (let name of attendeeNames) {
			name = convertGermanUmlauts(name);

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

	private generateFilename(note: GranolaNote): string {
		const title = note.title || 'Untitled Granola Note';
		const docId = note.id || 'unknown_id';

		let createdDate = '';
		let updatedDate = '';
		let createdTime = '';
		let updatedTime = '';
		let createdDateTime = '';
		let updatedDateTime = '';

		if (note.created_at) {
			createdDate = formatDate(note.created_at, this.settings.dateFormat);
			createdTime = formatDate(note.created_at, 'HH-mm-ss');
			createdDateTime = formatDate(note.created_at, this.settings.dateFormat + '_HH-mm-ss');
		}

		if (note.updated_at) {
			updatedDate = formatDate(note.updated_at, this.settings.dateFormat);
			updatedTime = formatDate(note.updated_at, 'HH-mm-ss');
			updatedDateTime = formatDate(note.updated_at, this.settings.dateFormat + '_HH-mm-ss');
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

		if (this.settings.slashReplacement) {
			filename = filename.replace(/\s*\/\s*/g, ` ${this.settings.slashReplacement} `);
		} else {
			filename = filename.replace(/\s*\/\s*/g, ' ');
		}

		const invalidChars = /[:\\|?*"]/g;
		filename = filename.replace(invalidChars, '');
		filename = filename.replace(/\s+/g, this.settings.filenameSeparator);

		return filename;
	}

	private buildNoteContent(note: GranolaNote): string {
		const sections: string[] = [];
		const noteTitle = note.title || 'Untitled Granola Note';

		sections.push('# ' + noteTitle);

		if (this.settings.includeEnhancedNotes && note.summary_markdown && note.summary_markdown.trim()) {
			sections.push('\n' + note.summary_markdown.trim());
		}

		if (this.settings.includeFullTranscript && note.transcript && note.transcript.length > 0) {
			sections.push('\n## Transcript\n\n' + transcriptToMarkdown(note.transcript));
		}

		return sections.join('\n');
	}

	private isFieldEnabled(fieldKey: string): boolean {
		const field = this.settings.frontmatterFields.find(f => f.key === fieldKey);
		if (!field) return false;
		// Required fields are always enabled
		if (REQUIRED_FRONTMATTER_FIELDS.includes(fieldKey)) return true;
		return field.enabled;
	}

	private buildFrontmatter(note: GranolaNote): string {
		const title = note.title || 'Untitled Granola Note';
		const docId = note.id || 'unknown_id';

		const attendeeNames = this.extractAttendeeNames(note);
		const peopleLinks = this.generatePeopleLinks(attendeeNames, note);
		const attendeeEmails = this.extractAttendeeEmails(note);
		const companyNames = this.extractCompanyNames(note);

		const scheduledStart = note.calendar_event?.scheduled_start_time ?? null;
		const scheduledEnd = note.calendar_event?.scheduled_end_time ?? null;

		const fieldGenerators: Record<string, () => string | null> = {
			'category': () => {
				if (!this.settings.customCategory) return null;
				return 'category:\n  - ' + escapeYamlValue(this.settings.customCategory) + '\n';
			},
			'type': () => 'type:\n',
			'date': () => {
				if (scheduledStart) {
					return 'date: ' + formatDateTimeProperty(scheduledStart) + '\n';
				} else if (note.created_at) {
					return 'date: ' + formatDateTimeProperty(note.created_at) + '\n';
				}
				return 'date:\n';
			},
			'dateEnd': () => {
				if (scheduledEnd) {
					return 'dateEnd: ' + formatDateTimeProperty(scheduledEnd) + '\n';
				}
				return 'dateEnd:\n';
			},
			'noteStarted': () => {
				if (note.created_at) {
					return 'noteStarted: ' + formatDateTimeProperty(note.created_at) + '\n';
				}
				return 'noteStarted:\n';
			},
			'noteEnded': () => {
				if (note.updated_at) {
					return 'noteEnded: ' + formatDateTimeProperty(note.updated_at) + '\n';
				}
				return 'noteEnded:\n';
			},
			'org': () => {
				let result = 'org:\n';
				if (companyNames.length > 0) {
					for (const company of companyNames) {
						result += '  - ' + escapeYamlValue('[[' + company + ']]') + '\n';
					}
				}
				return result;
			},
			'loc': () => 'loc:\n',
			'people': () => {
				let result = 'people:\n';
				if (peopleLinks.length > 0) {
					for (const link of peopleLinks) {
						result += '  - ' + escapeYamlValue(link) + '\n';
					}
				}
				return result;
			},
			'topics': () => 'topics:\n',
			'tags': () => {
				if (!this.settings.customTags) return null;
				let result = 'tags:\n';
				const tags = this.settings.customTags.split(',').map(t => t.trim()).filter(t => t);
				for (const tag of tags) {
					result += '  - ' + escapeYamlValue(tag) + '\n';
				}
				return result;
			},
			'emails': () => {
				if (!this.settings.includeEmails || attendeeEmails.length === 0) return null;
				let result = 'emails:\n';
				for (const email of attendeeEmails) {
					result += '  - ' + escapeYamlValue(email) + '\n';
				}
				return result;
			},
			'granola_id': () => 'granola_id: ' + escapeYamlValue(docId) + '\n',
			'title': () => 'title: ' + escapeYamlValue(title) + '\n',
			'granola_url': () => {
				if (!this.settings.includeGranolaUrl || !note.web_url) return null;
				return 'granola_url: ' + note.web_url + '\n';
			},
		};

		let frontmatter = '---\n';
		for (const field of this.settings.frontmatterFields) {
			if (!this.isFieldEnabled(field.key)) continue;
			const generator = fieldGenerators[field.key];
			if (generator) {
				const value = generator();
				if (value !== null) {
					frontmatter += value;
				}
			}
		}
		frontmatter += '---\n';
		return frontmatter;
	}

	private async findExistingNoteByGranolaId(granolaId: string): Promise<TFile | null> {
		const folder = this.app.vault.getFolderByPath(this.settings.syncDirectory);
		if (!folder) {
			return null;
		}

		const filesToSearch = folder.children.filter(
			(file): file is TFile => file instanceof TFile && file.extension === 'md'
		);

		const target = granolaId.toLowerCase();
		for (const file of filesToSearch) {
			try {
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.frontmatter?.granola_id) {
					const cachedId = String(cache.frontmatter.granola_id).trim().toLowerCase();
					if (cachedId === target) {
						return file;
					}
				}
			} catch (error) {
				console.error('Error checking file for Granola ID:', file.path, error);
			}
		}

		return null;
	}

	/**
	 * The new API's `web_url` embeds the underlying UUID that the legacy plugin used
	 * as `granola_id`. We extract it so we can relink notes synced with the old format.
	 */
	private extractLegacyUuidFromWebUrl(webUrl: string | null | undefined): string | null {
		if (!webUrl) return null;
		const m = webUrl.match(/\/d\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
		return m ? m[1] : null;
	}

	private replaceOrAppendFrontmatterLine(frontmatter: string, key: string, value: string): string {
		const re = new RegExp(`^${key}:.*$`, 'm');
		if (re.test(frontmatter)) {
			return frontmatter.replace(re, `${key}: ${value}`);
		}
		const sep = frontmatter.endsWith('\n') || frontmatter.length === 0 ? '' : '\n';
		return frontmatter + sep + `${key}: ${value}`;
	}

	private async processDocument(note: GranolaNote): Promise<boolean> {
		try {
			const docId = note.id || 'unknown_id';

			// API only returns notes with AI summaries, but defend anyway.
			if (!note.summary_markdown || !note.summary_markdown.trim()) {
				return false;
			}

			// Primary lookup: by current granola_id (the not_* slug).
			let existingFile = await this.findExistingNoteByGranolaId(docId);
			let isLegacyRelink = false;

			// Fallback: if a previous version of this plugin wrote the note with the
			// legacy UUID as granola_id, we can recover it via the UUID embedded in web_url.
			if (!existingFile) {
				const legacyUuid = this.extractLegacyUuidFromWebUrl(note.web_url);
				if (legacyUuid) {
					existingFile = await this.findExistingNoteByGranolaId(legacyUuid);
					isLegacyRelink = !!existingFile;
				}
			}

			if (existingFile) {
				if (this.settings.skipExistingNotes) {
					const cache = this.app.metadataCache.getFileCache(existingFile);
					const storedNoteEnded = cache?.frontmatter?.noteEnded as string | undefined;
					const apiUpdatedAt = formatDateTimeProperty(note.updated_at);
					const contentIsNewer = !!(storedNoteEnded && apiUpdatedAt && apiUpdatedAt > storedNoteEnded);

					if (isLegacyRelink || contentIsNewer) {
						const noteContent = this.buildNoteContent(note);
						await this.app.vault.process(existingFile, (existingContent) => {
							const frontmatterMatch = existingContent.match(/^---\n([\s\S]*?)\n---\n/);
							if (frontmatterMatch) {
								let existingFrontmatter = frontmatterMatch[1];
								if (isLegacyRelink) {
									existingFrontmatter = this.replaceOrAppendFrontmatterLine(
										existingFrontmatter,
										'granola_id',
										escapeYamlValue(docId)
									);
								}
								if (contentIsNewer && apiUpdatedAt) {
									existingFrontmatter = this.replaceOrAppendFrontmatterLine(
										existingFrontmatter,
										'noteEnded',
										apiUpdatedAt
									);
								}
								if (contentIsNewer) {
									return '---\n' + existingFrontmatter + '\n---\n' + noteContent;
								}
								// Pure relink: rewrite frontmatter but keep the body untouched
								// so any manual edits in the body survive.
								const rest = existingContent.slice(frontmatterMatch[0].length);
								return '---\n' + existingFrontmatter + '\n---\n' + rest;
							}
							const frontmatter = this.buildFrontmatter(note);
							return frontmatter + noteContent;
						});
					}
					return true;
				}

				const frontmatter = this.buildFrontmatter(note);
				const noteContent = this.buildNoteContent(note);
				const finalMarkdown = frontmatter + noteContent;

				await this.app.vault.process(existingFile, () => finalMarkdown);
				return true;
			}

			// Create new note
			const frontmatter = this.buildFrontmatter(note);
			const noteContent = this.buildNoteContent(note);
			const finalMarkdown = frontmatter + noteContent;

			const filename = this.generateFilename(note) + '.md';
			const targetDirectory = this.settings.syncDirectory;
			const filepath = path.join(targetDirectory, filename);

			let finalFilepath = filepath;
			const existingFileByName = this.app.vault.getAbstractFileByPath(filepath);
			if (existingFileByName && existingFileByName instanceof TFile) {
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
					console.error('Error checking existing file:', error);
				}

				if (this.settings.existingFileAction === 'skip') {
					return false;
				} else if (this.settings.existingFileAction === 'timestamp') {
					const timestamp = formatDate(note.created_at, 'HH-mm');
					const baseFilename = this.generateFilename(note);
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

	private async ensureDirectoryExists(): Promise<void> {
		try {
			const folder = this.app.vault.getFolderByPath(this.settings.syncDirectory);
			if (!folder) {
				await this.app.vault.createFolder(this.settings.syncDirectory);
			}
		} catch (error) {
			console.error('Error creating directory:', error);
		}
	}

	private async updateDailyNote(todaysNotes: TodaysNote[]): Promise<void> {
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

			const fileCache = this.app.metadataCache.getFileCache(dailyNote);
			const headings = fileCache?.headings || [];

			const existingHeading = headings.find(heading =>
				heading.heading.trim() === sectionHeader.replace(/^#+\s*/, '').trim()
			);

			if (existingHeading) {
				const lines = content.split('\n');
				const sectionLineNum = existingHeading.position.start.line;

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
				content += '\n\n' + granolaSection;
			}

			await this.app.vault.process(dailyNote, () => content);

		} catch (error) {
			console.error('Error updating daily note:', error);
		}
	}

	private async getDailyNote(): Promise<TFile | null> {
		try {
			const today = new Date();

			// Try to get Daily Notes plugin settings from Obsidian
			const dailyNotesPlugin = (this.app as any).internalPlugins.getPluginById('daily-notes');
			if (dailyNotesPlugin?.enabled) {
				const dailyNotesSettings = dailyNotesPlugin.instance?.options || {};
				const dateFormat = dailyNotesSettings.format || 'YYYY-MM-DD';
				const folder = dailyNotesSettings.folder || '';

				const todayFormatted = formatDateWithPattern(today, dateFormat);

				const expectedPath = folder
					? `${folder}/${todayFormatted}.md`
					: `${todayFormatted}.md`;

				const dailyNote = this.app.vault.getAbstractFileByPath(expectedPath);
				if (dailyNote instanceof TFile) {
					return dailyNote;
				}

				const files = this.app.vault.getMarkdownFiles();
				const matchedFile = files.find(f => f.basename === todayFormatted);
				if (matchedFile) {
					return matchedFile;
				}
			}

			// Fallback for when Daily Notes plugin is disabled
			const year = today.getFullYear();
			const month = String(today.getMonth() + 1).padStart(2, '0');
			const day = String(today.getDate()).padStart(2, '0');

			const searchFormats = [
				`${year}-${month}-${day}`,
				`${day}-${month}-${year}`,
				`${month}-${day}-${year}`,
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
}

// Re-export for documentation/test consumers
export { GRANOLA_API_DOCS_URL };
