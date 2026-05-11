# Changelog

All notable changes to this project will be documented in this file.

## [3.0.0] - 2026-05-11

### ⚠️ Breaking change — switch to Granola's official public API

The plugin now authenticates against `https://public-api.granola.ai/v1` using a user-supplied personal API key (`grn_…`) instead of reading the desktop app's local `supabase.json`. **You must paste an API key into plugin settings before the first sync.** Generate one at [docs.granola.ai → Personal API](https://docs.granola.ai/help-center/sharing/integrations/personal-api). Requires a Granola Business or Enterprise plan.

#### Why

Around May 2026, the Granola desktop app migrated credential storage to an encrypted blob keyed via the OS keychain. The plaintext `supabase.json` that earlier plugin versions read is no longer kept fresh — the token written there expires after ~6 hours and is never rotated, so every API call returned `401 Unauthorized`. Meanwhile, Granola shipped an official public API with stable, non-rotating keys. The community reverse-engineering effort that earlier plugin versions were based on was archived on 2026-02-05 because of this. The migration solves authentication permanently.

### Added

- **API key setting** under a new "Authentication" section. Password-input field with a link to the Granola docs.
- **Incremental sync** via the API's `updated_after` query parameter. The plugin records the timestamp of each successful sync in plugin data (`lastSyncAt`) and only requests notes changed since then on subsequent runs.
- **Auto-relink for legacy notes**: notes synced with v2.x have a UUID `granola_id`; the new API uses `not_*` slugs. The plugin extracts the UUID embedded in the API's `web_url` and matches it against your existing notes, rewriting the `granola_id` in place to the new slug. Manual frontmatter edits and note body are preserved. No duplicates are created.
- **Rate-limit handling**: 250 ms minimum interval between API calls (≈4 req/s, under the 5 req/s sustained cap), with one retry on HTTP 429 honoring the `Retry-After` header.
- **Friendly error surfacing**: missing API key, invalid key (401), and rate-limit failures all produce an Obsidian Notice instead of silent console errors.

### Changed

- **API client rewritten** for cursor-based pagination (max `page_size=30`) instead of the old offset-based POST.
- **Two-stage fetch**: the new list endpoint returns metadata only, so the plugin now does one `GET /v1/notes` for the list plus one `GET /v1/notes/{id}?include=transcript` per note (transcript only fetched when "Include transcript" is on).
- **Body content** is now `note.summary_markdown` verbatim — the plugin no longer parses ProseMirror.
- **`granola_id` format**: was a UUID (`a1b2c3d4-…`), now a `not_*` slug. Existing v2.x notes are auto-migrated by the relink path described above.
- **`granola_url`**: now read directly from `note.web_url` instead of being constructed from the document ID.
- **Auto-detect-my-name**: uses `note.owner.name` (the API key owner's account) instead of the calendar `attendee.self === true` heuristic.
- **Company extraction** (`org` field): the new API doesn't expose enrichment data, so company names are derived solely from attendee email domains (the v2.x email-domain fallback is now the only path). Personal email domains are still excluded.
- **Attendee names**: the new API returns flat `{name, email}` attendees with Unicode diacritics preserved, so the v2.x diacritic-recovery logic that compared enrichment names against calendar display names was removed.
- **Transcript shape**: segments are now `{text, start_time, end_time, speaker: {source, diarization_label?}}`. `speaker.source` is an enum (`microphone` / `speaker` / etc.) — `microphone` is the API key owner, anything else is treated as "Them".
- **Settings UI**:
  - "Auth key path" → replaced with "API key".
  - "Auto-detect my name" description updated to reflect the new mechanism.
  - "Include transcript" description notes that enabling it adds one extra API call per note.

### Removed

Removed because the official public API does not expose the underlying data:

- **"My Notes" section** in synced notes (the `Include My Notes` toggle and code path). The API only exposes the AI-generated `summary_markdown`, not the user's raw typed notes. Verified against the OpenAPI spec, 14 alternative `include=` parameter values (all rejected), and 30 sampled real notes.
- **Attachment downloads** (`Download Attachments` toggle, attachment folder logic, `IMAGE_EXTENSIONS` / `CONTENT_TYPE_TO_EXTENSION` constants, `getAttachmentExtension` helper, `## Attachments` section in note bodies). No attachment schema exists in the official API and no attachment fields appear in any sampled note.
- **Meeting platform auto-detection** (`Detect meeting platform` toggle, `Platform Mappings` UI, `detectMeetingPlatform` logic). The `calendar_event` schema has exactly 6 fields — `event_title`, `invitees`, `organiser`, `calendar_event_id`, `scheduled_start_time`, `scheduled_end_time` — none of them a conferencing URL.
- **Attendee response-status filtering** (`Attendee filter` dropdown, `responseStatus`/`shouldIncludeAttendee` plumbing). Attendees come back as flat `{name, email}` with no per-attendee RSVP status field.

Removed code paths and helpers:

- `loadCredentials()` (3-path file search, JSON-string-vs-object branches, both WorkOS and Cognito token fallbacks)
- `fetchGranolaDocuments()` (POST-based offset pagination)
- `fetchTranscript()` (separate transcript endpoint — now folded into `fetchNote` via `?include=transcript`)
- `extractPanelContent()` (panel/ProseMirror extraction)
- `convertProseMirrorToMarkdown()` and `processListItem()` (~92 lines)
- `downloadAttachments()`, `getAttachmentFolder()`, `getAttachmentExtension()`
- `detectMeetingPlatform()`
- `extractCompanyNames()` enrichment-data path (kept email-domain fallback only)
- `getMyNameFromDocument()` (the multi-step self-detection cascade)
- `buildResponseStatusMap()`, `shouldIncludeAttendee()`
- `getLatestUpdatedAt()` `last_viewed_panel` fallback (now just returns `note.updated_at`)
- The `GranolaCredentials`, `GranolaDocument`, `GranolaPerson`, `GranolaPeople`, `GranolaAttachment`, `GranolaCalendarAttendee`, `ProseMirrorNode`, `GranolaPanel`, and old `GranolaCalendarEvent` interfaces from `src/types.ts`

### Migration notes

- Old saved settings keys (`authKeyPath`, `downloadAttachments`, `enableLocationDetection`, `platformMappings`) are stripped from plugin data on first load. Other legacy keys from earlier upstream forks are left in place inert and harmless.
- If you bumped this plugin from v2.x to an early v3 build that lacked the auto-relink path, your vault may contain duplicate files (originals with UUID `granola_id` plus newer `<name>_HH-mm.md` files with `not_*` IDs). Match each `not_*` file's `granola_url` UUID to the existing UUID file, delete the `not_*` copy, then re-sync — the relink path will rewrite the original's `granola_id` to the new slug.
- The default `documentSyncLimit` is 100. If you have more than 100 notes in Granola and want all of them relinked in one pass, temporarily bump the limit before the first v3 sync. Otherwise older notes stay frozen with their UUID `granola_id` and just won't receive future content updates from Granola.

### Bundle

- ~30 KB minified (down from ~35 KB in v2.4.0)
- ~1,870 source lines (down from ~2,317 in v2.4.0) — net deletion of ~450 lines

## [2.4.0] - 2026-02-06

### Added
- **Custom Platform URL Mappings**: Configure proxy URLs (e.g. Gong) to map to the actual meeting platform. For example, map `gong.io` → `Zoom` so meetings using Gong as a proxy are correctly tagged with `[[Zoom]]` in the `loc` field. Add multiple mappings in Settings → Detect meeting platform.

## [2.3.0] - 2026-02-05

### Changed
- **Node.js 24**: Now requires Node.js 24+ for development
- **Updated dependencies**: All dependencies updated to latest versions
  - `@types/node`: 22.15.21 → 25.2.1
  - `@typescript-eslint/eslint-plugin`: 8.32.1 → 8.54.0
  - `@typescript-eslint/parser`: 8.32.1 → 8.54.0
  - `builtin-modules`: 4.0.0 → 5.0.0
  - `esbuild`: 0.25.5 → 0.27.2
  - `eslint`: 9.27.0 → 9.39.2
  - `typescript`: 5.8.3 → 5.9.3

## [2.2.1] - 2026-02-05

### Fixed
- **Teams meeting detection**: Now correctly detects Microsoft Teams meetings by checking the calendar event description field (where Teams URLs are typically embedded), not just the location field
- **Company extraction from email domains**: When Granola's enrichment data is missing company information, the plugin now extracts company names from attendee email domains as a fallback (e.g., `user@acme.com` → "Acme")
  - Personal email domains (Gmail, Outlook, Yahoo, etc.) are automatically excluded
  - Handles two-part TLDs like `.co.uk`

### Technical
- Added `description` and `hangoutLink` fields to calendar event type
- Added `extractCompanyFromEmail()` utility function with comprehensive personal email domain filtering

## [2.2.0] - 2026-02-05

### Added
- **Configurable Frontmatter Fields**: Full control over frontmatter structure
  - Enable/disable individual fields (15 fields available)
  - Reorder fields using up/down buttons in settings
  - Required fields (`granola_id`, `noteEnded`) cannot be disabled
  - New "Frontmatter field order" section in settings UI

### Available Fields
| Field | Description |
|-------|-------------|
| `category` | Custom category (e.g., `[[Meetings]]`) |
| `type` | Empty placeholder for manual entry |
| `date` | Scheduled meeting start time |
| `dateEnd` | Scheduled meeting end time |
| `noteStarted` | When Granola note-taking started |
| `noteEnded` | Last note update (required for sync detection) |
| `org` | Company names as wiki links |
| `loc` | Meeting platform (Zoom/Google Meet/Teams) |
| `people` | Attendee names as wiki links |
| `topics` | Empty placeholder for manual entry |
| `tags` | Custom tags |
| `emails` | Attendee email addresses |
| `granola_id` | Unique document ID (required for deduplication) |
| `title` | Meeting title |
| `granola_url` | Link to original Granola note |

## [2.1.0] - 2026-02-05

### Changed
- **TypeScript Refactor**: Migrated entire codebase to TypeScript for improved type safety and maintainability
  - Split monolithic `main.js` into modular TypeScript files:
    - `src/main.ts`: Main plugin class with sync logic
    - `src/settings.ts`: Settings tab UI
    - `src/types.ts`: TypeScript interfaces for all data structures
    - `src/constants.ts`: API constants and default settings
    - `src/utils.ts`: Utility functions (date formatting, ProseMirror conversion, etc.)
  - Added esbuild bundler for optimized production builds
  - Strict type checking enabled for better code quality
  - No functional changes - all existing features work identically

### Technical
- Added `package.json` with npm build scripts (`npm run build`, `npm run dev`)
- Added `tsconfig.json` with strict TypeScript configuration
- Added `esbuild.config.mjs` for bundling
- Bundled output: ~36KB minified (same functionality, cleaner codebase)

## [2.0.2] - 2026-02-04

### Fixed
- **Smart sync with frontmatter preservation**: When "Skip Existing Notes" is enabled, the plugin now intelligently handles the case where Granola updates a document after initial sync (e.g., enhanced notes become available). The plugin:
  - Compares Granola's `updated_at` timestamp with the note's `noteEnded`
  - If Granola has newer content: updates the note body while **preserving your frontmatter edits**
  - If no changes: skips the note as before
  - This fixes the race condition where notes synced during a meeting would miss enhanced notes generated later

## [2.0.1] - 2026-02-04

### Added
- **Slash Replacement Setting**: Meeting titles with slashes (e.g., "Jane / John - Weekly") now have the slash replaced with a configurable character instead of being stripped. Options: `&` (default), `-`, `+`, `~`, `x`, or remove entirely.

### Changed
- **Default Filename Separator**: Changed from underscore (`_`) to space for more natural filenames.
- **Datetime Format**: All datetime fields now use `YYYY-MM-DDTHH:mm` format (no seconds) for cleaner frontmatter.

### Removed
- **created_at / updated_at**: Removed from frontmatter (redundant with `noteStarted` / `noteEnded`).

## [2.0.0] - 2026-02-04

### Added
- **🏢 Company Wiki Links**: Extract company names from attendees and add as `[[Company Name]]` in `org` field
- **📍 Meeting Platform Detection**: Auto-detect Zoom, Google Meet, or Teams and add `[[Zoom]]`, `[[Google Meet]]`, or `[[Teams]]` to `loc` field
- **👤 Auto-Detect User Name**: Automatically identify your name from calendar attendees using the `self` flag (no manual configuration needed)
- **📎 Attachment Downloads**: Download meeting screenshots and files, embed images with `![[filename]]` using Obsidian's attachment folder setting
- **📅 Calendar-Based Dates**: New frontmatter fields from Google Calendar:
  - `date` / `dateEnd`: Scheduled meeting start/end times
  - `noteStarted` / `noteEnded`: When Granola note-taking started/ended
- **🔍 Attendee Filtering**: Filter attendees by calendar response status (accepted, declined, tentative, needsAction)
- **🇩🇪 Smart Umlaut Conversion**: Converts German umlauts (`ae`→`ä`, `oe`→`ö`, `ue`→`ü`) while preserving names like Miguel, Michael, Joel
- **📚 API Documentation**: Added Granola API reference in README with example responses and curl commands

### Changed
- **People as Wiki Links**: Attendees now appear as `[[John Smith]]` instead of tags
- **Simplified Codebase**: Streamlined from ~2900 to ~2000 lines by removing rarely-used features
- **Content Detection**: Notes with only attachments (no text) now sync correctly
- **Notes Field Support**: Now reads `doc.notes` directly when `panels` is null (for notes without AI processing)

### Removed
- Periodic notes integration
- Granola folders support
- Folder filtering
- Attendee tags (replaced with wiki links)
- Folder tags
- Date-based subfolders
- Duplicate detection command
- Reorganize notes command
- Note prefix option
- Experimental search scope

### Technical
- Uses Obsidian's MetadataCache for efficient frontmatter parsing
- Safe JSON parsing with error handling
- YAML value escaping for special characters
- CDN URLs (CloudFront) handled without auth headers for attachments

## [1.8.0] - 2025-12-22
### Added
- **📝 My Notes Support**: New option to include your personal "My Notes" content from Granola under a dedicated "## My Notes" section
- **🤖 Enhanced Notes Control**: New option to control whether AI-generated Enhanced Notes are included (enabled by default)
- **🎯 Folder Filtering**: New feature to selectively sync only notes from specific Granola folders
  - Enable folder filter toggle to activate filtering
  - Refresh folder list from Granola API
  - Select/deselect individual folders with checkboxes
  - "Select All" and "Deselect All" buttons for convenience
- **📋 Note Content Settings**: New organized settings section for controlling what content appears in synced notes

### Fixed
- **🐛 Notes Without Enhanced Notes**: Fixed issue where notes without AI-generated enhanced notes would fail to sync entirely
  - Notes will now sync if they have My Notes, Enhanced Notes, or Transcript content
  - Gracefully handles missing content types instead of failing silently

### Enhanced
- **Transcript Heading**: Changed transcript section heading from "# Transcript" to "## Transcript" for consistent hierarchy
- **API Enhancement**: Now requests additional panel data from Granola API for My Notes support
- **Settings Organization**: Improved settings UI with clear section headings for Note Content, Filename Settings, etc.

### Resolves
- Fixes [#32](https://github.com/dannymcc/Granola-to-Obsidian/issues/32): Notes without enhanced notes fail to export
- Fixes [#31](https://github.com/dannymcc/Granola-to-Obsidian/issues/31): Select folders to sync
- Fixes [#27](https://github.com/dannymcc/Granola-to-Obsidian/issues/27): Include full transcript (setting now properly initialized in defaults)
- Fixes [#17](https://github.com/dannymcc/Granola-to-Obsidian/issues/17): Sync 'My Notes' and 'Enhanced Notes' under different headers

## [1.7.3] - 2025-12-06
### Fixed
- **🗓️ Daily Note Integration**: Fixed daily note detection for custom date formats including day-of-week suffixes (e.g., `YYYY-MM-DD-ddd` producing `2025-12-06-Sat`)
  - Now reads date format and folder settings directly from Obsidian's Daily Notes core plugin
  - Supports all moment.js date format tokens: `YYYY`, `YY`, `MMMM`, `MMM`, `MM`, `M`, `dddd`, `ddd`, `DD`, `D`
  - Falls back to legacy matching for users without Daily Notes plugin enabled
- **🔄 Duplicate Note Prevention**: Fixed issue where duplicate notes were created on every sync
  - Changed `skipExistingNotes` default to `true` for new installations
  - Added secondary `granola_id` check when filename collisions occur to prevent duplicates even when search scope misses the original file

### Resolves
- Fixes [#30](https://github.com/dannymcc/Granola-to-Obsidian/issues/30): Daily Note integration not working with YYYY-MM-DD-ddd date format

## [1.7.2] - 2025-11-28
### Added
- **📜 Historical Notes Sync**: New `syncAllHistoricalNotes` setting to sync all historical notes from Granola, not just recent ones
- **📊 Document Sync Limit**: New `documentSyncLimit` setting to control maximum number of documents synced in a single operation
- **📁 Folder Reorganization**: New command to reorganize existing Granola notes into new folder structures
- **💬 Enhanced Status Updates**: Improved status bar updates with custom message support

### Fixed
- Resolves [#25](https://github.com/dannymcc/Granola-to-Obsidian/issues/25): Not syncing full history of Granola notes
- Resolves [#18](https://github.com/dannymcc/Granola-to-Obsidian/issues/18): Incomplete/Partial Sync

### Contributors
- Special thanks to [@andrewsong-tech](https://github.com/andrewsong-tech) for implementing these features!

## [1.7.1] - 2025-11-16
### Added
- **👥 Contributors Section**: Added contributors section to README to recognize community contributions

### Enhanced
- **Documentation**: Improved documentation for all features

## [1.7.0] - 2025-11-03
### Added
- **🔍 Duplicate Note Detection**: New "Find Duplicate Granola Notes" command to identify and review duplicate syncs
- **🛡️ Smart File Conflict Handling**: New option to either skip or timestamp files when naming conflicts occur
- **🎨 Customizable Filename Separators**: Choose between underscores, dashes, or no separators between words in filenames
- **📁 Granola Folder Organization**: Mirror your Granola folder structure in Obsidian with automatic folder-based tagging
- **🏷️ Folder Tag Templates**: Customize how folder hierarchy becomes tags (e.g., `folder/{name}`)

### Fixed
- Resolves [#16](https://github.com/dannymcc/Granola-to-Obsidian/issues/16): Request for customizable filename separators
- Resolves [#20](https://github.com/dannymcc/Granola-to-Obsidian/issues/20): File conflict handling improvements
- Resolves [#23](https://github.com/dannymcc/Granola-to-Obsidian/issues/23): Granola folder structure support
- Dynamic tag preservation to prevent tag duplication with custom attendee tag prefixes (thanks [@rylanfr](https://github.com/rylanfr))

### Contributors
- Special thanks to [@amscad](https://github.com/amscad) for implementing duplicate detection, file handling improvements, and folder organization features!
- Thanks to [@rylanfr](https://github.com/rylanfr) for the dynamic tag preservation fix!

## [1.6.0]
### Added
- **🗓️ Periodic Notes Integration**: New support for the Periodic Notes plugin alongside existing Daily Notes integration
  - Independent toggle for Periodic Notes integration (can be used with or without Daily Notes)
  - Configurable section heading for Periodic Notes (separate from Daily Notes section)
  - Automatic detection of Periodic Notes plugin availability
  - Settings UI automatically disables when Periodic Notes plugin is not installed
  - Seamlessly integrates with Periodic Notes' daily note creation and management

### Enhanced
- **Dual Integration Support**: Users can now enable Daily Notes, Periodic Notes, both, or neither
- **User Choice**: Flexible integration options to match different Obsidian workflows
- **Backward Compatibility**: All existing Daily Notes functionality preserved unchanged

### Technical
- Added `enablePeriodicNoteIntegration` and `periodicNoteSectionName` settings
- Added `isPeriodicNotesPluginAvailable()` method for plugin detection
- Added `getPeriodicNote()` method for Periodic Notes API integration
- Added `updatePeriodicNote()` method mirroring Daily Notes functionality
- Enhanced sync logic to support both integrations independently
- All changes maintain 100% backward compatibility with existing settings and workflows

### Fixes Issue
- Resolves [#6](https://github.com/dannymcc/Granola-to-Obsidian/issues/6): Request for Periodic Notes plugin support

## [1.5.2]
### Fixed
- **Settings UI**: Fixed JavaScript errors that prevented all settings from displaying
- **Heading Syntax**: Corrected `setHeading()` calls to use proper `createEl()` syntax
- **Sync Functionality**: Resolved sync issues caused by cached JavaScript errors
- **Console Output**: Cleaned up debug logs for cleaner production experience

### Technical
- Fixed `containerEl.createEl().setHeading()` runtime errors
- Restored all 19 settings to be properly displayed and functional
- Improved error handling and reduced verbose logging

## [1.5.1]
### Fixed
- **Platform Support**: Added proper Linux authentication path support (`~/.config/Granola/supabase.json`)
- **Modern Obsidian APIs**: Replaced deprecated APIs with current best practices
  - Use `Platform` instead of Node.js `os` module
  - Use `window.setTimeout`/`window.setInterval` instead of global versions
  - Use `Vault.process` instead of `Vault.modify` for background file operations
  - Use `Vault.getFolderByPath` instead of `getAbstractFileByPath`
  - Use `Vault.recurseChildren` for recursive folder operations
  - Use `Vault.getAllFolders` for folder enumeration
  - Use `FileManager.processFrontMatter` for atomic frontmatter updates
  - Use `MetadataCache.getFileCache` instead of regex for heading detection
- **UI Consistency**: Converted all UI text to sentence case per Obsidian guidelines
- **Settings Improvements**: 
  - Use `setHeading()` instead of HTML heading elements
  - Remove hardcoded CSS styling
  - Remove top-level settings heading
  - Remove ribbon icon toggle (users can customize via Obsidian settings)
- **Code Quality**: 
  - Reduced unnecessary console logging while preserving essential error messages
  - Improved error handling and performance
- **Version Requirements**: Updated minAppVersion to 1.6.6 to support modern APIs

### Technical
- All changes maintain backward compatibility for user data and settings
- No breaking changes to plugin functionality or user experience
- Addresses all Obsidian plugin review feedback for official plugin store inclusion

## [1.5.0]
### Added
- **🧪 Experimental: Search Scope for Existing Notes**: Control where the plugin searches for existing notes when checking for duplicates by granola-id
- **Flexible Search Options**: Choose between "Sync Directory Only" (default), "Entire Vault", or "Specific Folders"
- **Duplicate Prevention Tools**: Added "Find Duplicate Notes" button to scan for and identify existing duplicates
- **Auto-Sync Safety**: New "Re-enable Auto-Sync" button to safely restart auto-sync after testing new settings
- **Enhanced Settings Safety**: Search scope settings now save without triggering auto-sync to prevent accidental duplicates

### Enhanced
- **Experimental Features Section**: Clear UI separation for experimental features with backup warnings
- **User Safety**: Prominent warnings about backing up vault before using experimental features
- **Duplicate Management**: Added comprehensive duplicate detection and management tools
- **Error Prevention**: Auto-sync temporarily disabled when changing search scope settings

### Technical
- **Recursive Folder Search**: Added support for searching all markdown files within specified folders and subfolders
- **Safe Settings Management**: New `saveSettingsWithoutSync()` method to prevent unwanted auto-sync triggers
- **Validation Improvements**: Enhanced folder path validation with user-friendly error messages
- **Search Scope Flexibility**: Infrastructure for different search strategies based on user needs

## [1.4.0]
### Added
- **Customizable Attendee Tag Structure**: New setting to customize how attendee tags are formatted and organized
- **Tag Template System**: Use `{name}` placeholder to create custom tag hierarchies (e.g., `people/{name}`, `meeting-attendees/{name}`)
- **Flexible Tag Organization**: Allows users to control their tag hierarchy and reduce root-level tag clutter in Obsidian

### Enhanced
- **Attendee Tag Generation**: Now uses customizable templates instead of hardcoded `person/` prefix
- **Tag Validation**: Automatic cleanup of invalid tag structures (double slashes, leading/trailing slashes)
- **Settings UI**: Added new "Attendee Tag Template" setting with helpful examples and validation

## [1.3.2]
### Fixed
- **Nested bullet preservation**: Fixed issue where sub-bullets from Granola were being flattened instead of maintaining proper indentation in Obsidian
- **List structure**: Improved ProseMirror to Markdown conversion to properly handle nested bullet lists with correct indentation
- **Bullet formatting**: Sub-bullets now display with proper 2-space indentation per nesting level

## [1.3.1]
### Fixed
- **Granola URL format**: Fixed incorrect URL format from `https://app.granola.ai/documents/{id}` to correct `https://notes.granola.ai/d/{id}`
- Updated documentation examples to reflect correct URL format

## [1.3.0]
### Added
- **Granola URL integration**: Add links back to original Granola notes in frontmatter (`granola_url`)
- **Enhanced attendee extraction**: Improved name resolution using detailed person data from Granola API
- **Multi-folder infrastructure**: Code infrastructure ready for when Granola API includes folder information
- **Organized settings UI**: Grouped related settings into clear sections (Metadata & Tags, Daily Note Integration, etc.)
- **Better deduplication**: Prevents duplicate attendees from multiple sources (people array + calendar events)

### Enhanced
- **Attendee name detection**: Now uses `fullName`, `givenName`, `familyName` fields for more accurate names
- **Settings organization**: Related settings grouped under clear headings for better UX
- **Metadata management**: Unified handling of tags, URLs, and other frontmatter data
- **Console output**: Cleaner debug information with better organization

### Technical
- **Future-ready folder support**: All infrastructure in place for multi-folder tagging when API supports it
- **Improved email tracking**: Prevents processing same attendee multiple times across different data sources
- **Enhanced error handling**: Better error messages and graceful fallbacks
- **Code organization**: Cleaner separation of concerns and modular design

## [1.2.2]
### Fixed
- **Critical bug**: Fixed issue where meetings with duplicate titles (e.g., recurring "Enterprise Team | Project Update") were being skipped instead of created with unique filenames
- Daily note integration now works correctly for meetings that would have been skipped due to filename collisions
- Added timestamp-based unique filename generation when title conflicts occur

## [1.2.1]
### Fixed
- **Critical bug**: Fixed daily note integration using hardcoded date instead of current date
- Daily note meetings now correctly appear in today's note instead of a previous date
- Enhanced daily note detection to work with multiple date formats (DD-MM-YYYY, YYYY-MM-DD, etc.)

## [1.2.0]
### Added
- **Attendee tagging system**: Automatically extract meeting attendees and add them as tags in note frontmatter
- **Smart name filtering**: Exclude your own name from attendee tags with configurable settings
- **Organised tag structure**: Uses `person/` prefix for clean tag organisation (e.g. `person/john-smith`)
- **Existing note updates**: Updates attendee tags in existing notes while preserving manual edits when enabled
- **Conservative defaults**: Attendee tagging disabled by default to avoid disrupting existing workflows

### Changed
- Enhanced settings UI with attendee tagging configuration options
- Improved case-insensitive name matching for more reliable filtering

## [1.1.2]
### Fixed
- Completely resolved daily note integration issues by implementing a robust file search-based approach
- Daily note integration now works regardless of complex Daily Notes plugin configurations
- Meetings from today are now properly added to the daily note section as expected

## [1.1.1]
### Fixed
- Resolved "File already exists" error by adding proper file name conflict detection
- Fixed daily note integration to work with hierarchical folder structures (e.g. Notes/Daily/YYYY/MM)
- Enhanced daily note detection with better logging and error handling
- Improved folder creation for date-based daily note structures

## [1.1.0]
### Added
- Customisable daily note section name setting - users can now customise the heading used for Granola meetings in their Daily Note

## [1.0.9]
### Changed
- New version number bump to adpot new versioning

## [1.0.8]
### Fixed
- Updated version numbering to use simple X.X.X format for Obsidian compatibility
- Fixed manifest.json to remove "v" prefix from version numbers

### Changed
- GitHub releases now use clean version tags (e.g., 1.0.8) instead of v-prefixed tags

## [1.0.7]
### Added
- Daily Note integration feature
- Skip existing notes option

### Fixed
- Improved error handling for sync operations

## [1.0.6]
### Added
- Custom filename templates with variables
- Better date formatting options

### Fixed
- Status bar updates during sync operations

## [1.0.5]
### Fixed
- Authentication path detection improvements
- Better error messages for sync failures

## [1.0.4]
### Added
- Auto-sync frequency options
- Status bar integration

### Fixed
- File naming edge cases

## [1.0.3]
### Fixed
- Content conversion improvements
- Better handling of missing data

## [1.0.2]
### Added
- Customizable sync directory
- Note prefix options

### Fixed
- Frontmatter formatting improvements

## [1.0.1]
### Fixed
- Initial bug fixes and stability improvements

## [1.0.0]
### Added
- Initial release of Granola Sync plugin
- Basic sync functionality for Granola AI notes
- Automatic content conversion from ProseMirror to Markdown
- Frontmatter with metadata support 