# Changelog

All notable changes to this project will be documented in this file.

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