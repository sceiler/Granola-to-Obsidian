// Granola API Types

export interface GranolaCredentials {
	workos_tokens?: string | { access_token: string };
	cognito_tokens?: string | { access_token: string };
}

export interface GranolaAttachment {
	id: string;
	url: string;
	file_url?: string;
	download_url?: string;
	type: string;
	width?: number;
	height?: number;
	filename?: string;
	name?: string;
}

export interface ProseMirrorNode {
	type: string;
	content?: ProseMirrorNode[];
	text?: string;
	attrs?: {
		id?: string;
		level?: number;
		tight?: boolean;
	};
}

export interface GranolaPanel {
	type: 'my_notes' | 'enhanced_notes';
	content: ProseMirrorNode;
}

export interface GranolaPersonDetails {
	person?: {
		name?: {
			fullName?: string;
			givenName?: string;
			familyName?: string;
		};
		avatar?: string;
	};
	company?: {
		name?: string;
	};
}

export interface GranolaPerson {
	email?: string;
	name?: string;
	display_name?: string;
	details?: GranolaPersonDetails;
}

export interface GranolaCalendarAttendee {
	email?: string;
	displayName?: string;
	responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
	self?: boolean;
	organizer?: boolean;
}

export interface GranolaCalendarEvent {
	id: string;
	summary?: string;
	start?: {
		dateTime?: string;
		timeZone?: string;
	};
	end?: {
		dateTime?: string;
		timeZone?: string;
	};
	attendees?: GranolaCalendarAttendee[];
	location?: string;
	conferenceData?: {
		entryPoints?: Array<{
			uri?: string;
			entryPointType?: string;
		}>;
	};
	creator?: {
		email?: string;
	};
	organizer?: {
		email?: string;
	};
}

export interface GranolaPeople {
	creator?: GranolaPerson;
	attendees?: GranolaPerson[];
}

export interface GranolaDocument {
	id: string;
	created_at: string;
	updated_at: string;
	title?: string;
	notes?: ProseMirrorNode;
	notes_plain?: string;
	notes_markdown?: string;
	panels?: GranolaPanel[] | null;
	last_viewed_panel?: {
		type?: string;
		content?: ProseMirrorNode;
	};
	google_calendar_event?: GranolaCalendarEvent;
	people?: GranolaPeople | GranolaPerson[];
	attachments?: GranolaAttachment[];
	transcript?: string;
	transcribe?: boolean;
	valid_meeting?: boolean;
	privacy_mode_enabled?: boolean;
	creation_source?: string;
}

export interface GranolaApiResponse {
	docs: GranolaDocument[];
}

export interface TranscriptSegment {
	source: 'microphone' | 'system';
	text: string;
	start_timestamp: string;
}

// Plugin Settings Types

export type AttendeeFilter = 'all' | 'accepted' | 'accepted_tentative' | 'exclude_declined';
export type ExistingFileAction = 'timestamp' | 'skip';

export interface FrontmatterFieldConfig {
	key: string;
	enabled: boolean;
}

export interface GranolaSyncSettings {
	syncDirectory: string;
	authKeyPath: string;
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
	enableLocationDetection: boolean;
	downloadAttachments: boolean;
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
