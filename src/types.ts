// Granola API Types (public-api.granola.ai v1)

export interface GranolaUser {
	name: string | null;
	email: string;
}

export interface GranolaCalendarInvitee {
	email: string;
}

export interface GranolaCalendarEvent {
	event_title: string | null;
	invitees: GranolaCalendarInvitee[];
	organiser: string | null;
	calendar_event_id: string | null;
	scheduled_start_time: string | null;
	scheduled_end_time: string | null;
}

export interface GranolaFolder {
	id: string;
	object: 'folder';
	name: string;
	parent_folder_id: string | null;
}

export interface GranolaSpeaker {
	source: string;
	diarization_label?: string | null;
}

export interface GranolaTranscriptSegment {
	text: string;
	start_time: string;
	end_time: string;
	speaker: GranolaSpeaker;
}

export interface GranolaNoteSummary {
	id: string;
	object: 'note';
	title: string | null;
	owner: GranolaUser;
	created_at: string;
	updated_at: string;
}

export interface GranolaNote {
	id: string;
	object: 'note';
	title: string | null;
	owner: GranolaUser;
	created_at: string;
	updated_at: string;
	web_url: string;
	calendar_event: GranolaCalendarEvent | null;
	attendees: GranolaUser[];
	folder_membership: GranolaFolder[];
	summary_text: string | null;
	summary_markdown: string | null;
	transcript: GranolaTranscriptSegment[] | null;
}

export interface ListNotesResponse {
	notes: GranolaNoteSummary[];
	hasMore: boolean;
	cursor: string | null;
}

export interface ListFoldersResponse {
	folders: GranolaFolder[];
	hasMore: boolean;
	cursor: string | null;
}

// Plugin Settings Types

export type AttendeeFilter = 'all' | 'accepted' | 'accepted_tentative' | 'exclude_declined';
export type ExistingFileAction = 'timestamp' | 'skip';

export interface FrontmatterFieldConfig {
	key: string;
	enabled: boolean;
}

export interface AttendeeNameOverride {
	email: string;
	name: string;
}

export interface GranolaSyncSettings {
	syncDirectory: string;
	apiKey: string;
	lastSyncAt?: string;
	filenameTemplate: string;
	dateFormat: string;
	autoSyncFrequency: number;
	skipExistingNotes: boolean;
	existingFileAction: ExistingFileAction;
	filenameSeparator: string;
	slashReplacement: string;
	documentSyncLimit: number;
	includeFullTranscript: boolean;
	includeMyNotes: boolean;
	includeEnhancedNotes: boolean;
	includeGranolaUrl: boolean;
	includeEmails: boolean;
	attendeeFilter: AttendeeFilter;
	excludeMyNameFromPeople: boolean;
	autoDetectMyName: boolean;
	myName: string;
	attendeeNameOverrides: AttendeeNameOverride[];
	enableCustomFrontmatter: boolean;
	customCategory: string;
	customTags: string;
	enableDailyNoteIntegration: boolean;
	dailyNoteSectionName: string;
	frontmatterFields: FrontmatterFieldConfig[];
}

// Internal Types

export interface TodaysNote {
	title: string;
	actualFilePath: string;
	time: string;
}

export interface JsonParseResult<T> {
	data: T | null;
	error: string | null;
}
