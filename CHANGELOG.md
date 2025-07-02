# Changelog

All notable changes to this project will be documented in this file.

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