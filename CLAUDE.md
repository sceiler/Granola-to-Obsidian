# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Granola Sync for Obsidian (Fork)** - A streamlined Obsidian plugin that syncs meeting notes from Granola AI to an Obsidian vault. This is a simplified fork of [dannymcc/Granola-to-Obsidian](https://github.com/dannymcc/Granola-to-Obsidian) focused on core sync functionality with configurable frontmatter.

- **Type**: Obsidian plugin (no build process - raw JavaScript)
- **Language**: JavaScript (Node.js runtime in Obsidian)
- **Current Version**: Check `manifest.json` for the current version
- **Minimum Obsidian Version**: 1.6.6

## Fork-Specific Features

This fork is streamlined for a specific workflow:

| Feature | Description |
|---------|-------------|
| People as wiki links | `[[John Smith]]` instead of tags |
| Company as wiki links | Organizations extracted from attendees as `[[Company Name]]` in `org` field |
| Meeting platform detection | Auto-detects Zoom/Google Meet/Teams and adds `[[Platform]]` to `loc` field |
| Auto-detect user | Automatically identifies your name from calendar (no manual config needed) |
| Attachment downloads | Downloads meeting screenshots/files and embeds them in notes |
| German umlaut conversion | `ae` → `ä`, `oe` → `ö`, `ue` → `ü` (smart: preserves Miguel, Michael, Joel, etc.) |
| Calendar-based dates | `date`/`dateEnd` from Google Calendar, `noteStarted`/`noteEnded` from Granola timestamps |
| Attendee filtering | Filter by calendar response status (accepted, tentative, declined) |
| Email extraction | Attendee emails in frontmatter |
| Configurable frontmatter | Custom category, tags, empty fields for manual entry |
| Daily note integration | Adds today's meetings to your daily note |
| Simplified settings | Removed rarely-used features |

**Removed from original**: Periodic note integration, Granola folders, attendee tags, folder tags, date-based folders, duplicate detection, reorganize notes, note prefix, experimental search scope.

## Architecture

### Single-File Architecture
All plugin code lives in `main.js` (~1450 lines) with two main classes:

1. **`GranolaSyncPlugin`** (extends `obsidian.Plugin`)
   - Plugin lifecycle, initialization, and sync orchestration
   - Key methods: `onload()`, `syncNotes()`, `loadCredentials()`, `fetchGranolaDocuments()`, `processDocument()`, `buildFrontmatter()`, `updateDailyNote()`, `extractCompanyNames()`, `detectMeetingPlatform()`, `getMyNameFromDocument()`, `downloadAttachments()`, `convertGermanUmlauts()`

2. **`GranolaSyncSettingTab`** (extends `obsidian.PluginSettingTab`)
   - Simplified settings UI

### Document Processing Flow

```
syncNotes()
  ↓
fetchGranolaDocuments(token) → [documents]
  ↓
for each document:
  → fetchTranscript() if enabled
  → processDocument()
    → downloadAttachments() [if enabled]
    → extractAttendeeNames() + generatePeopleLinks()
    → extractCompanyNames() [for org wiki links]
    → detectMeetingPlatform() [for loc: [[Zoom]]/[[Google Meet]]/[[Teams]]]
    → getEffectiveMyName() [auto-detect or manual override]
    → buildFrontmatter() [date, dateEnd, noteStarted, noteEnded, org, loc, people, attachments, etc.]
    → buildNoteContent() [My Notes, Enhanced Notes, Transcript, Attachments]
    → generateFilename() [template + date formatting]
    → create/update file
  → track today's notes for daily note integration
  ↓
if enableDailyNoteIntegration:
  → updateDailyNote() [append to Daily/YYYY-MM-DD note]
```

### Key Integration Points

- **Granola API**: Reads auth token from `~/Library/Application Support/Granola/supabase.json` (macOS) or `~/.config/Granola/supabase.json` (Linux)
- **Obsidian**: Uses Plugin API for file management, settings, status bar, commands
- **ProseMirror**: `convertProseMirrorToMarkdown()` converts Granola's rich editor format to markdown

## Development

**No build process**: The plugin is delivered as raw JavaScript files that Obsidian loads directly.

**Files to distribute**:
- `main.js` - All plugin code
- `manifest.json` - Plugin metadata
- `styles.css` - Plugin UI styles
- `versions.json` - Version history

**Testing manually**:
1. Copy `main.js`, `manifest.json`, `styles.css` to `.obsidian/plugins/granola-sync/`
2. Restart Obsidian or reload plugin (`Cmd+Shift+I` → reload)
3. Trigger manual sync from ribbon icon or command palette

**Debugging**: Check Obsidian console (`Cmd/Ctrl + Shift + I` → Console tab)

## Settings Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `syncDirectory` | `Notes` | Where to save synced notes |
| `filenameTemplate` | `{created_date}_{title}` | Filename format |
| `dateFormat` | `YYYY-MM-DD` | Date format in filenames |
| `autoSyncFrequency` | 5 minutes | Auto-sync interval (0 = manual) |
| `skipExistingNotes` | `true` | Don't overwrite existing notes |
| `includeMyNotes` | `true` | Include personal notes section |
| `includeEnhancedNotes` | `true` | Include AI summaries |
| `includeFullTranscript` | `false` | Include meeting transcript |
| `includeGranolaUrl` | `true` | Add link back to Granola |
| `includeEmails` | `true` | Include attendee emails |
| `attendeeFilter` | `all` | Filter attendees by response status: `all`, `accepted`, `accepted_tentative`, `exclude_declined` |
| `autoDetectMyName` | `true` | Auto-detect user name from calendar attendees |
| `myName` | `''` | Manual override for user name |
| `enableLocationDetection` | `true` | Auto-detect Zoom/Google Meet/Teams for `loc` field |
| `downloadAttachments` | `true` | Download and embed meeting attachments (uses Obsidian's attachment folder setting) |
| `enableCustomFrontmatter` | `true` | Use custom frontmatter template |
| `enableDailyNoteIntegration` | `true` | Add meetings to daily note |
| `dailyNoteSectionName` | `## Granola Meetings` | Section heading in daily note |

## Common Development Tasks

### Adding a New Setting
1. Add to `DEFAULT_SETTINGS` object
2. Add UI control in `GranolaSyncSettingTab.display()`
3. Reference via `this.settings.yourNewSetting`
4. Call `await this.saveSettings()` to persist

### Modifying Frontmatter
Edit `buildFrontmatter()` method. The frontmatter is YAML format between `---` delimiters.

### German Umlaut Conversion Logic
The `convertGermanUmlauts()` method converts `ae` → `ä`, `oe` → `ö`, `ue` → `ü` but uses pattern detection to preserve non-German names:
- `uel` not followed by another `l` → preserved (Miguel, Samuel, Manuela)
- `ael` anywhere → preserved (Michael, Raphael, Michaela)
- `oel` anywhere → preserved (Joel, Noel)
- Otherwise → converted (Mueller → Müller, Schroeder → Schröder)

### Adding New API Integration
1. Get auth token via `loadCredentials()`
2. Make fetch requests following the pattern in `fetchGranolaDocuments()`, `fetchTranscript()`

## Key Files

| File | Purpose |
|------|---------|
| `main.js` | All plugin code |
| `manifest.json` | Plugin metadata, version |
| `styles.css` | Plugin UI styles |
| `versions.json` | Version history |
| `CHANGELOG.md` | Release notes |
