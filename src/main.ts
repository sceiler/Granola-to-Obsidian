import {
	Plugin,
	TFile,
	TFolder,
	requestUrl,
	type App,
	type CachedMetadata,
} from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import type {
	GranolaSyncSettings,
	GranolaDocument,
	GranolaApiResponse,
	GranolaCredentials,
	GranolaPerson,
	GranolaCalendarAttendee,
	ProseMirrorNode,
	TodaysNote,
	TranscriptSegment,
} from './types';

import {
	DEFAULT_SETTINGS,
	DEFAULT_FRONTMATTER_FIELDS,
	REQUIRED_FRONTMATTER_FIELDS,
	API_BATCH_SIZE,
	GRANOLA_API_BASE,
	GRANOLA_API_VERSION,
	IMAGE_EXTENSIONS,
} from './constants';

import {
	safeJsonParse,
	escapeYamlValue,
	formatDate,
	formatDateTimeProperty,
	formatDateWithPattern,
	convertGermanUmlauts,
	convertProseMirrorToMarkdown,
	transcriptToMarkdown,
	getAttachmentExtension,
	extractNameFromEmail,
} from './utils';

import { GranolaSyncSettingTab } from './settings';

export default class GranolaSyncPlugin extends Plugin {
	settings: GranolaSyncSettings = DEFAULT_SETTINGS;
	private autoSyncInterval: number | null = null;
	private statusBarItem: HTMLElement | null = null;
	private ribbonIconEl: HTMLElement | null = null;

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
			const todaysNotes: TodaysNote[] = [];
			const today = new Date().toDateString();

			for (const doc of documents) {
				try {
					if (this.settings.includeFullTranscript) {
						const transcriptData = await this.fetchTranscript(token, doc.id);
						doc.transcript = transcriptToMarkdown(transcriptData);
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

	private async loadCredentials(): Promise<string | null> {
		const homedir = os.homedir();
		const username = os.userInfo().username;
		const authPaths = [
			path.resolve(homedir, 'Users', username, 'Library/Application Support/Granola/supabase.json'),
			path.resolve(homedir, this.settings.authKeyPath),
			path.resolve(homedir, 'Library/Application Support/Granola/supabase.json')
		];

		for (const authPath of authPaths) {
			try {
				if (!fs.existsSync(authPath)) {
					continue;
				}

				let credentialsFile: string;
				try {
					credentialsFile = fs.readFileSync(authPath, 'utf8');
				} catch (readError) {
					console.error('Failed to read credentials file:', readError);
					continue;
				}

				const { data, error: parseError } = safeJsonParse<GranolaCredentials>(credentialsFile, 'Granola credentials file');
				if (parseError || !data) {
					console.error(parseError);
					continue;
				}

				let accessToken: string | null = null;

				if (data.workos_tokens) {
					if (typeof data.workos_tokens === 'string') {
						const { data: workosTokens } = safeJsonParse<{ access_token: string }>(data.workos_tokens, 'WorkOS tokens');
						if (workosTokens) {
							accessToken = workosTokens.access_token;
						}
					} else if (typeof data.workos_tokens === 'object') {
						accessToken = data.workos_tokens.access_token;
					}
				}

				if (!accessToken && data.cognito_tokens) {
					if (typeof data.cognito_tokens === 'string') {
						const { data: cognitoTokens } = safeJsonParse<{ access_token: string }>(data.cognito_tokens, 'Cognito tokens');
						if (cognitoTokens) {
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
				console.error('Error loading credentials:', error);
				continue;
			}
		}

		console.error('No valid Granola credentials found. Please ensure Granola is installed and you are logged in.');
		return null;
	}

	private async fetchGranolaDocuments(token: string): Promise<GranolaDocument[] | null> {
		try {
			const allDocs: GranolaDocument[] = [];
			let offset = 0;
			let hasMore = true;
			const maxDocuments = this.settings.documentSyncLimit;

			while (hasMore && allDocs.length < maxDocuments) {
				const response = await requestUrl({
					url: `${GRANOLA_API_BASE}/v2/get-documents`,
					method: 'POST',
					headers: {
						'Authorization': 'Bearer ' + token,
						'Content-Type': 'application/json',
						'Accept': '*/*',
						'User-Agent': `Granola/${GRANOLA_API_VERSION}`,
						'X-Client-Version': GRANOLA_API_VERSION
					},
					body: JSON.stringify({
						limit: API_BATCH_SIZE,
						offset: offset,
						include_last_viewed_panel: true,
						include_panels: true
					})
				});

				const apiResponse = response.json as GranolaApiResponse;

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

	private async fetchTranscript(token: string, docId: string): Promise<TranscriptSegment[] | null> {
		try {
			const response = await requestUrl({
				url: `${GRANOLA_API_BASE}/v1/get-document-transcript`,
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

			return response.json as TranscriptSegment[];
		} catch (error) {
			console.error('Error fetching transcript for document ' + docId + ':', error);
			return null;
		}
	}

	private extractPanelContent(doc: GranolaDocument, panelType: 'my_notes' | 'enhanced_notes'): ProseMirrorNode | null {
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

	private buildResponseStatusMap(doc: GranolaDocument): Map<string, string> {
		const statusMap = new Map<string, string>();
		if (doc.google_calendar_event?.attendees) {
			for (const attendee of doc.google_calendar_event.attendees) {
				if (attendee.email && attendee.responseStatus) {
					statusMap.set(attendee.email.toLowerCase(), attendee.responseStatus);
				}
			}
		}
		return statusMap;
	}

	private shouldIncludeAttendee(responseStatus: string | null): boolean {
		const filter = this.settings.attendeeFilter;

		if (filter === 'all') {
			return true;
		}

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

	private extractCompanyNames(doc: GranolaDocument): string[] {
		const companies = new Set<string>();
		const responseStatusMap = this.buildResponseStatusMap(doc);

		try {
			// Extract from people.attendees
			const people = doc.people;
			if (people && 'attendees' in people && Array.isArray(people.attendees)) {
				for (const attendee of people.attendees) {
					const email = attendee.email?.toLowerCase() ?? null;
					const responseStatus = email ? responseStatusMap.get(email) ?? null : null;
					if (!this.shouldIncludeAttendee(responseStatus)) {
						continue;
					}

					if (attendee.details?.company?.name) {
						const companyName = attendee.details.company.name.trim();
						if (companyName) {
							companies.add(companyName);
						}
					}
				}
			}

			// Also check creator's company
			if (people && 'creator' in people && people.creator) {
				const creator = people.creator;
				if (creator.details?.company?.name) {
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

	private detectMeetingPlatform(doc: GranolaDocument): string {
		if (!this.settings.enableLocationDetection) {
			return '';
		}

		try {
			const calendarEvent = doc.google_calendar_event;
			if (!calendarEvent) {
				return '';
			}

			const location = (calendarEvent.location || '').toLowerCase();

			let conferenceUrls: string[] = [];
			if (calendarEvent.conferenceData?.entryPoints) {
				conferenceUrls = calendarEvent.conferenceData.entryPoints
					.filter(ep => ep.uri)
					.map(ep => ep.uri!.toLowerCase());
			}

			const allUrls = [location, ...conferenceUrls].join(' ');

			if (allUrls.includes('zoom.us') || allUrls.includes('zoom.com')) {
				return '[[Zoom]]';
			}
			if (allUrls.includes('meet.google.com') || allUrls.includes('hangouts.google.com')) {
				return '[[Google Meet]]';
			}
			if (allUrls.includes('teams.microsoft.com') || allUrls.includes('teams.live.com')) {
				return '[[Teams]]';
			}

			return '';
		} catch (error) {
			console.error('Error detecting meeting platform:', error);
			return '';
		}
	}

	private getMyNameFromDocument(doc: GranolaDocument): string | null {
		try {
			if (doc.google_calendar_event?.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.self === true) {
						const selfEmail = attendee.email?.toLowerCase();

						// Check if self is the creator
						const people = doc.people;
						if (people && 'creator' in people && people.creator) {
							const creatorEmail = people.creator.email?.toLowerCase();
							if (creatorEmail === selfEmail) {
								if (people.creator.details?.person?.name?.fullName) {
									return people.creator.details.person.name.fullName;
								}
								if (people.creator.name) {
									return people.creator.name;
								}
							}
						}

						// Check people.attendees
						if (people && 'attendees' in people && Array.isArray(people.attendees)) {
							for (const person of people.attendees) {
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
							return extractNameFromEmail(selfEmail);
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

	private getEffectiveMyName(doc: GranolaDocument): string {
		if (this.settings.myName && this.settings.myName.trim()) {
			return this.settings.myName.trim();
		}

		if (this.settings.autoDetectMyName) {
			const autoDetected = this.getMyNameFromDocument(doc);
			if (autoDetected) {
				return autoDetected;
			}
		}

		return '';
	}

	private extractAttendeeNames(doc: GranolaDocument): string[] {
		const attendees: string[] = [];
		const processedEmails = new Set<string>();
		const responseStatusMap = this.buildResponseStatusMap(doc);

		try {
			const people = doc.people;

			// Handle people as array (legacy format)
			if (Array.isArray(people)) {
				for (const person of people) {
					const email = person.email?.toLowerCase() ?? null;
					const responseStatus = email ? responseStatusMap.get(email) ?? null : null;
					if (!this.shouldIncludeAttendee(responseStatus)) {
						if (email) processedEmails.add(email);
						continue;
					}

					let name: string | null = null;

					if (person.details?.person?.name) {
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

			// Handle calendar attendees
			if (doc.google_calendar_event?.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.email && processedEmails.has(attendee.email.toLowerCase())) {
						continue;
					}

					if (!this.shouldIncludeAttendee(attendee.responseStatus ?? null)) {
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

			// Fallback: extract from email if no display name
			if (Array.isArray(people)) {
				for (const person of people) {
					if (person.email && !processedEmails.has(person.email.toLowerCase())) {
						const responseStatus = responseStatusMap.get(person.email.toLowerCase()) ?? null;
						if (!this.shouldIncludeAttendee(responseStatus)) {
							processedEmails.add(person.email.toLowerCase());
							continue;
						}

						const hasName = person.name || person.display_name ||
							(person.details?.person?.name);

						if (!hasName) {
							const emailName = extractNameFromEmail(person.email);
							if (!attendees.includes(emailName)) {
								attendees.push(emailName);
								processedEmails.add(person.email.toLowerCase());
							}
						}
					}
				}
			}

			// Fallback: extract from email for calendar attendees without display names
			if (doc.google_calendar_event?.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.email && !processedEmails.has(attendee.email.toLowerCase())) {
						if (!this.shouldIncludeAttendee(attendee.responseStatus ?? null)) {
							processedEmails.add(attendee.email.toLowerCase());
							continue;
						}

						if (!attendee.displayName) {
							const emailName = extractNameFromEmail(attendee.email);
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

	private extractAttendeeEmails(doc: GranolaDocument): string[] {
		const emails: string[] = [];
		const processedEmails = new Set<string>();
		const responseStatusMap = this.buildResponseStatusMap(doc);

		try {
			const people = doc.people;

			if (Array.isArray(people)) {
				for (const person of people) {
					if (person.email && !processedEmails.has(person.email)) {
						const responseStatus = responseStatusMap.get(person.email.toLowerCase()) ?? null;
						if (!this.shouldIncludeAttendee(responseStatus)) {
							processedEmails.add(person.email);
							continue;
						}
						emails.push(person.email);
						processedEmails.add(person.email);
					}
				}
			}

			if (doc.google_calendar_event?.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					if (attendee.email && !processedEmails.has(attendee.email)) {
						if (!this.shouldIncludeAttendee(attendee.responseStatus ?? null)) {
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

	private generatePeopleLinks(attendeeNames: string[], doc: GranolaDocument): string[] {
		if (!attendeeNames || attendeeNames.length === 0) {
			return [];
		}

		const links: string[] = [];
		const myName = this.getEffectiveMyName(doc);

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

	private getAttachmentFolder(noteFolder: string): string {
		// getConfig is not in the public API types but exists at runtime
		const attachmentFolderPath = (this.app.vault as any).getConfig('attachmentFolderPath') as string || '';

		if (!attachmentFolderPath || attachmentFolderPath === '/') {
			return '';
		} else if (attachmentFolderPath === './') {
			return noteFolder;
		} else if (attachmentFolderPath.startsWith('./')) {
			const subfolder = attachmentFolderPath.slice(2);
			return noteFolder ? path.join(noteFolder, subfolder) : subfolder;
		} else {
			return attachmentFolderPath;
		}
	}

	private async downloadAttachments(doc: GranolaDocument, token: string, noteFolder: string): Promise<string[]> {
		if (!this.settings.downloadAttachments) {
			return [];
		}

		const attachments = doc.attachments;
		if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
			return [];
		}

		const downloadedFiles: string[] = [];
		const attachmentDir = this.getAttachmentFolder(noteFolder);

		try {
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

					const isCdnUrl = url.includes('cloudfront.net') || url.includes('cdn.');
					const requestOptions: { url: string; method: string; headers?: Record<string, string> } = {
						url: url,
						method: 'GET',
					};
					if (!isCdnUrl) {
						requestOptions.headers = {
							'Authorization': 'Bearer ' + token,
						};
					}

					const response = await requestUrl(requestOptions);

					if (response.arrayBuffer) {
						const contentType = response.headers?.['content-type'] || response.headers?.['Content-Type'];
						const ext = getAttachmentExtension(attachment, contentType);

						let baseFilename = attachment.filename || attachment.name;
						if (!baseFilename) {
							baseFilename = `attachment_${i + 1}`;
						}

						baseFilename = baseFilename.replace(/\.\w{3,4}$/, '');

						const noteDate = doc.created_at ? formatDate(doc.created_at, 'YYYY-MM-DD_HH-mm') : '';
						const filename = noteDate
							? `${noteDate}_${baseFilename}.${ext}`
							: `${baseFilename}.${ext}`;

						const filePath = attachmentDir ? path.join(attachmentDir, filename) : filename;

						const existingFile = this.app.vault.getAbstractFileByPath(filePath);
						if (!existingFile) {
							await this.app.vault.createBinary(filePath, response.arrayBuffer);
						}

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

	private generateFilename(doc: GranolaDocument): string {
		const title = doc.title || 'Untitled Granola Note';
		const docId = doc.id || 'unknown_id';

		let createdDate = '';
		let updatedDate = '';
		let createdTime = '';
		let updatedTime = '';
		let createdDateTime = '';
		let updatedDateTime = '';

		if (doc.created_at) {
			createdDate = formatDate(doc.created_at, this.settings.dateFormat);
			createdTime = formatDate(doc.created_at, 'HH-mm-ss');
			createdDateTime = formatDate(doc.created_at, this.settings.dateFormat + '_HH-mm-ss');
		}

		if (doc.updated_at) {
			updatedDate = formatDate(doc.updated_at, this.settings.dateFormat);
			updatedTime = formatDate(doc.updated_at, 'HH-mm-ss');
			updatedDateTime = formatDate(doc.updated_at, this.settings.dateFormat + '_HH-mm-ss');
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

	private buildNoteContent(doc: GranolaDocument, transcript: string, attachmentFilenames: string[] = []): string {
		const sections: string[] = [];
		const noteTitle = doc.title || 'Untitled Granola Note';

		sections.push('# ' + noteTitle);

		const myNotesContent = this.extractPanelContent(doc, 'my_notes');
		if (myNotesContent && this.settings.includeMyNotes) {
			const myNotesMarkdown = convertProseMirrorToMarkdown(myNotesContent);
			if (myNotesMarkdown && myNotesMarkdown.trim()) {
				sections.push('\n## My Notes\n\n' + myNotesMarkdown.trim());
			}
		}

		const enhancedNotesContent = this.extractPanelContent(doc, 'enhanced_notes');
		if (enhancedNotesContent && this.settings.includeEnhancedNotes) {
			const enhancedNotesMarkdown = convertProseMirrorToMarkdown(enhancedNotesContent);
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

		if (attachmentFilenames.length > 0) {
			const attachmentLines = attachmentFilenames.map(filePath => {
				const ext = filePath.split('.').pop()?.toLowerCase() || '';
				if (IMAGE_EXTENSIONS.includes(ext)) {
					return '![[' + filePath + ']]';
				} else {
					return '[[' + filePath + ']]';
				}
			});
			sections.push('\n## Attachments\n\n' + attachmentLines.join('\n'));
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

	private buildFrontmatter(doc: GranolaDocument, attachmentFilenames: string[] = []): string {
		const title = doc.title || 'Untitled Granola Note';
		const docId = doc.id || 'unknown_id';

		const attendeeNames = this.extractAttendeeNames(doc);
		const peopleLinks = this.generatePeopleLinks(attendeeNames, doc);
		const attendeeEmails = this.extractAttendeeEmails(doc);
		const companyNames = this.extractCompanyNames(doc);
		const meetingPlatform = this.detectMeetingPlatform(doc);

		const calendarEvent = doc.google_calendar_event;
		const scheduledStart = calendarEvent?.start?.dateTime;
		const scheduledEnd = calendarEvent?.end?.dateTime;

		// Field generators - each returns the YAML string for that field or null to skip
		const fieldGenerators: Record<string, () => string | null> = {
			'category': () => {
				if (!this.settings.customCategory) return null;
				return 'category:\n  - ' + escapeYamlValue(this.settings.customCategory) + '\n';
			},
			'type': () => 'type:\n',
			'date': () => {
				if (scheduledStart) {
					return 'date: ' + formatDateTimeProperty(scheduledStart) + '\n';
				} else if (doc.created_at) {
					return 'date: ' + formatDateTimeProperty(doc.created_at) + '\n';
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
				if (doc.created_at) {
					return 'noteStarted: ' + formatDateTimeProperty(doc.created_at) + '\n';
				}
				return 'noteStarted:\n';
			},
			'noteEnded': () => {
				if (doc.updated_at) {
					return 'noteEnded: ' + formatDateTimeProperty(doc.updated_at) + '\n';
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
			'loc': () => {
				if (meetingPlatform) {
					return 'loc:\n  - ' + escapeYamlValue(meetingPlatform) + '\n';
				}
				return 'loc:\n';
			},
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
				if (!this.settings.includeGranolaUrl) return null;
				return 'granola_url: https://notes.granola.ai/d/' + docId + '\n';
			},
		};

		let frontmatter = '---\n';

		// Iterate over fields in configured order
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

		for (const file of filesToSearch) {
			try {
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.frontmatter?.granola_id) {
					const cachedId = String(cache.frontmatter.granola_id).trim();
					if (cachedId === granolaId) {
						return file;
					}
				}
			} catch (error) {
				console.error('Error checking file for Granola ID:', file.path, error);
			}
		}

		return null;
	}

	private async processDocument(doc: GranolaDocument, token: string): Promise<boolean> {
		try {
			const title = doc.title || 'Untitled Granola Note';
			const docId = doc.id || 'unknown_id';
			const transcript = doc.transcript || 'no_transcript';

			const myNotesContent = this.extractPanelContent(doc, 'my_notes');
			const enhancedNotesContent = this.extractPanelContent(doc, 'enhanced_notes');

			const myNotesMarkdown = myNotesContent ? convertProseMirrorToMarkdown(myNotesContent).trim() : '';
			const enhancedNotesMarkdown = enhancedNotesContent ? convertProseMirrorToMarkdown(enhancedNotesContent).trim() : '';

			const hasMyNotes = !!myNotesMarkdown && this.settings.includeMyNotes;
			const hasEnhancedNotes = !!enhancedNotesMarkdown && this.settings.includeEnhancedNotes;
			const hasTranscript = this.settings.includeFullTranscript && transcript && transcript !== 'no_transcript';
			const hasAttachments = this.settings.downloadAttachments && doc.attachments && doc.attachments.length > 0;

			if (!hasMyNotes && !hasEnhancedNotes && !hasTranscript && !hasAttachments) {
				return false;
			}

			const attachmentFilenames = await this.downloadAttachments(doc, token, this.settings.syncDirectory);

			const existingFile = await this.findExistingNoteByGranolaId(docId);

			if (existingFile) {
				if (this.settings.skipExistingNotes) {
					const cache = this.app.metadataCache.getFileCache(existingFile);
					const storedNoteEnded = cache?.frontmatter?.noteEnded as string | undefined;
					const apiUpdatedAt = formatDateTimeProperty(doc.updated_at);

					if (storedNoteEnded && apiUpdatedAt && apiUpdatedAt > storedNoteEnded) {
						const noteContent = this.buildNoteContent(doc, transcript, attachmentFilenames);
						await this.app.vault.process(existingFile, (existingContent) => {
							const frontmatterMatch = existingContent.match(/^---\n([\s\S]*?)\n---\n/);
							if (frontmatterMatch) {
								let existingFrontmatter = frontmatterMatch[1];
								existingFrontmatter = existingFrontmatter.replace(
									/^noteEnded:.*$/m,
									'noteEnded: ' + apiUpdatedAt
								);
								return '---\n' + existingFrontmatter + '\n---\n' + noteContent;
							}
							const frontmatter = this.buildFrontmatter(doc, attachmentFilenames);
							return frontmatter + noteContent;
						});
					}
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
					const timestamp = formatDate(doc.created_at, 'HH-mm');
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
