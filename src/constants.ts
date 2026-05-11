import type { GranolaSyncSettings, FrontmatterFieldConfig } from './types';

export const API_BATCH_SIZE = 30;
export const MAX_DOCUMENT_LIMIT = 1000;
export const MIN_DOCUMENT_LIMIT = 1;

export const GRANOLA_API_BASE = 'https://public-api.granola.ai';
export const GRANOLA_API_DOCS_URL = 'https://docs.granola.ai/help-center/sharing/integrations/personal-api';

export const RATE_LIMIT_MIN_INTERVAL_MS = 250;

export const REQUIRED_FRONTMATTER_FIELDS = ['granola_id', 'noteEnded'];

export const DEFAULT_FRONTMATTER_FIELDS: FrontmatterFieldConfig[] = [
	{ key: 'category', enabled: true },
	{ key: 'type', enabled: true },
	{ key: 'date', enabled: true },
	{ key: 'dateEnd', enabled: true },
	{ key: 'noteStarted', enabled: true },
	{ key: 'noteEnded', enabled: true },
	{ key: 'org', enabled: true },
	{ key: 'loc', enabled: true },
	{ key: 'people', enabled: true },
	{ key: 'topics', enabled: true },
	{ key: 'tags', enabled: true },
	{ key: 'emails', enabled: true },
	{ key: 'granola_id', enabled: true },
	{ key: 'title', enabled: true },
	{ key: 'granola_url', enabled: true },
];

export const DEFAULT_SETTINGS: GranolaSyncSettings = {
	syncDirectory: 'Notes',
	apiKey: '',
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
	includeGranolaUrl: true,
	includeEmails: true,
	attendeeFilter: 'all',
	excludeMyNameFromPeople: true,
	autoDetectMyName: true,
	myName: '',
	attendeeNameOverrides: [],
	enableCustomFrontmatter: true,
	customCategory: '[[Meetings]]',
	customTags: 'meetings',
	enableDailyNoteIntegration: true,
	dailyNoteSectionName: '## Granola Meetings',
	frontmatterFields: DEFAULT_FRONTMATTER_FIELDS,
};
