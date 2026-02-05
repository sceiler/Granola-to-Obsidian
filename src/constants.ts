import { Platform } from 'obsidian';
import type { GranolaSyncSettings, FrontmatterFieldConfig } from './types';

export const API_BATCH_SIZE = 100;
export const MAX_DOCUMENT_LIMIT = 1000;
export const MIN_DOCUMENT_LIMIT = 1;

export const GRANOLA_API_BASE = 'https://api.granola.ai';
export const GRANOLA_API_VERSION = '5.354.0';

export function getDefaultAuthPath(): string {
	if (Platform.isWin) {
		return 'AppData/Roaming/Granola/supabase.json';
	} else if (Platform.isLinux) {
		return '.config/Granola/supabase.json';
	} else {
		return 'Library/Application Support/Granola/supabase.json';
	}
}

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
	includeGranolaUrl: true,
	includeEmails: true,
	attendeeFilter: 'all',
	excludeMyNameFromPeople: true,
	autoDetectMyName: true,
	myName: '',
	enableLocationDetection: true,
	downloadAttachments: true,
	enableCustomFrontmatter: true,
	customCategory: '[[Meetings]]',
	customTags: 'meetings',
	enableDailyNoteIntegration: true,
	dailyNoteSectionName: '## Granola Meetings',
	frontmatterFields: DEFAULT_FRONTMATTER_FIELDS,
};

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

export const CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
	'image': 'png',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'application/pdf': 'pdf',
};
