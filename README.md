# Granola Sync for Obsidian (Fork)

> A fork of [dannymcc/Granola-to-Obsidian](https://github.com/dannymcc/Granola-to-Obsidian) with enhanced metadata extraction, wiki-link formatting, and configurable frontmatter.

An Obsidian plugin that automatically syncs your [Granola AI](https://granola.ai) meeting notes to your Obsidian vault.

**Key differences from original**: Wiki links for people/companies, calendar-based date fields, meeting platform detection, auto-detection of your name, attachment downloads, attendee filtering, smart German umlaut conversion. See [Differences from Original](#differences-from-original) for details.

## Features

- **Automatic & Manual Sync**: Sync on demand or set auto-sync intervals (1 min to 24 hours)
- **Configurable Frontmatter**: Customize category, tags, and choose which fields to include
- **People as Wiki Links**: Attendees appear as `[[John Smith]]` for easy linking
- **Company Wiki Links**: Organizations extracted from attendees as `[[Company Name]]` in `org` field
- **Meeting Platform Detection**: Automatically detects Zoom, Google Meet, or Teams and adds `[[Zoom]]`, `[[Google Meet]]`, or `[[Teams]]` to the `loc` field
- **Auto-Detect Your Name**: Automatically identifies you from calendar attendees (no manual configuration needed)
- **Attachment Downloads**: Downloads meeting screenshots and files, embeds them in notes
- **Calendar-Based Dates**: `date`/`dateEnd` from scheduled calendar times, `noteStarted`/`noteEnded` from actual Granola timestamps
- **Attendee Filtering**: Filter by calendar response status (accepted, tentative, declined, or include everyone)
- **Smart German Umlaut Conversion**: Converts `ae` → `ä`, `oe` → `ö`, `ue` → `ü` while preserving names like Miguel, Michael, Joel
- **Daily Note Integration**: Automatically adds today's meetings to your daily note
- **Smart Content Detection**: Only creates notes when Granola has finished processing (no empty notes)

## Frontmatter Example

```yaml
---
category:
  - "[[Meetings]]"
type:
date: 2026-02-03T14:00:00        # Scheduled meeting start (from calendar)
dateEnd: 2026-02-03T14:30:00     # Scheduled meeting end (from calendar)
noteStarted: 2026-02-03T14:00:06 # When Granola note-taking started
noteEnded: 2026-02-03T14:50:53   # Last note update (proxy for meeting end)
org:
  - "[[Acme Corp]]"              # Companies extracted from attendees
  - "[[Globex Inc]]"
loc:
  - "[[Zoom]]"                   # Auto-detected from calendar (Zoom/Google Meet/Teams)
people:
  - "[[John Smith]]"
  - "[[Jane Doe]]"
topics:
tags:
  - meetings
emails:
  - john.smith@example.com
  - jane.doe@example.com
granola_id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
title: "Weekly Team Standup"
granola_url: https://notes.granola.ai/d/a1b2c3d4-e5f6-7890-abcd-ef1234567890
---
```

## Installation

### Manual Installation

1. Download the latest release from the [Releases page](../../releases)
2. Extract the files to your vault's plugins directory: `.obsidian/plugins/granola-sync/`
3. Enable the plugin in Obsidian Settings → Community Plugins
4. Configure your sync settings

### Files to Download
- `main.js`
- `manifest.json`
- `styles.css`

## Configuration

Access plugin settings via **Settings → Community Plugins → Granola Sync**

### Sync Settings

| Setting | Description |
|---------|-------------|
| Sync Directory | Folder where notes are saved (default: `Notes`) |
| Auth Key Path | Path to Granola authentication file |
| Auto-Sync Frequency | How often to sync (manual to every 24 hours) |
| Document Limit | Maximum number of recent documents to sync |
| Skip Existing Notes | Don't overwrite notes that already exist (see below) |

#### Skip Existing Notes Behavior

When **Skip Existing Notes** is enabled:
- Existing notes are generally preserved (your manual edits to frontmatter are safe)
- **However**, if Granola has updated the document since your last sync (e.g., enhanced notes became available after initial sync), the plugin will:
  - **Preserve your frontmatter** (manual corrections to people, tags, org, etc.)
  - **Update the note body** with new content from Granola (enhanced notes, attachments)
  - **Update `noteEnded`** timestamp to track the sync

This handles the race condition where a note is synced before Granola finishes generating enhanced notes. Your frontmatter edits remain intact while you still get the latest content from Granola.

### Filename Settings

| Setting | Description |
|---------|-------------|
| Filename Template | Use `{title}`, `{created_date}`, `{id}`, etc. |
| Date Format | Format for dates (e.g., `YYYY-MM-DD`) |
| Word Separator | Character between words (`_`, `-`, space, or none) |
| Slash Replacement | Replace `/` in titles with `&`, `-`, `+`, `~`, `x`, or remove |

### Note Content

| Setting | Description |
|---------|-------------|
| Include My Notes | Your personal notes from Granola |
| Include Enhanced Notes | AI-generated summaries |
| Include Transcript | Full meeting transcript (slower sync) |

### Frontmatter Options

| Setting | Description |
|---------|-------------|
| Include Granola URL | Link back to original Granola note |
| Include Emails | Attendee email addresses |
| Attendee Filter | Filter by calendar response: `Include everyone`, `Only accepted`, `Accepted + tentative`, `Exclude declined` |
| Exclude My Name | Filter your name from people list |
| Auto-Detect My Name | Automatically detect your name from calendar (default: on) |
| My Name (Override) | Manual override if auto-detection doesn't work |
| Detect Meeting Platform | Auto-detect Zoom/Google Meet/Teams for `loc` field (default: on) |
| Enable Custom Frontmatter | Add category, type, org, loc, topics fields |
| Category | Default category value (e.g., `[[Meetings]]`) |
| Tags | Default tags (comma-separated) |

### Attachments

| Setting | Description |
|---------|-------------|
| Download Attachments | Download meeting attachments and embed in notes (default: on) |

Attachments are saved to the folder configured in **Obsidian Settings → Files & Links → Default location for new attachments**. Images are embedded with `![[filename]]`, other files are linked with `[[filename]]`.

### Daily Note Integration

| Setting | Description |
|---------|-------------|
| Enable Daily Note Integration | Add today's meetings to your daily note |
| Section Heading | Heading for the meetings section (e.g., `## Granola Meetings`) |

## Differences from Original

This fork is streamlined for a specific workflow with enhanced metadata extraction:

### Added Features (not in original)

| Feature | Description |
|---------|-------------|
| Company wiki links | `org` field populated with `[[Company Name]]` from attendee enrichment data |
| Meeting platform detection | `loc` field auto-populated with `[[Zoom]]`, `[[Google Meet]]`, or `[[Teams]]` |
| Auto-detect user | Automatically identifies your name from calendar attendees (no manual config needed) |
| Attachment downloads | Downloads screenshots and files, embeds them in notes |
| Calendar-based dates | `date`/`dateEnd` from scheduled times, `noteStarted`/`noteEnded` from Granola timestamps |
| Attendee filtering | Filter by calendar response status (accepted, declined, tentative) |
| Smart umlaut conversion | Preserves names like Miguel, Michael, Joel while converting German surnames |

### Changed Features

| Feature | Original | This Fork |
|---------|----------|-----------|
| People format | Tags (`person/john-smith`) | Wiki links (`[[John Smith]]`) |
| Frontmatter | Fixed format | Configurable template with empty fields |
| Date source | `created_at` only | Calendar start/end + note start/end timestamps |
| Umlaut conversion | Simple replacement | Pattern-aware (preserves non-German names) |

### Removed Features

The following features were removed to simplify the codebase:

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

## Requirements

- Obsidian v1.6.6+
- Active Granola AI account
- Granola desktop app installed and authenticated

## Granola API Reference

This plugin uses Granola's internal API. Below is documentation for developers who want to understand or extend the integration.

### Authentication

Granola stores authentication tokens locally:
- **macOS**: `~/Library/Application Support/Granola/supabase.json`
- **Linux**: `~/.config/Granola/supabase.json`
- **Windows**: `%APPDATA%/Granola/supabase.json`

Extract the access token:

```bash
# macOS/Linux
cat ~/Library/Application\ Support/Granola/supabase.json | \
  python3 -c "import json,sys; data=json.load(sys.stdin); tokens=json.loads(data['workos_tokens']); print(tokens['access_token'])"
```

### Fetching Documents

```bash
TOKEN="your_access_token_here"

curl -s --compressed "https://api.granola.ai/v2/get-documents" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"limit": 10, "offset": 0}' | jq '.docs[0]'
```

### Example API Response (Anonymized)

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "created_at": "2025-03-07T13:00:13.451Z",
  "updated_at": "2025-09-15T11:30:57.056Z",
  "title": "Weekly Team Standup",
  "notes": {
    "type": "doc",
    "content": [{"type": "paragraph", "attrs": {"id": "..."}}]
  },
  "notes_plain": "",
  "notes_markdown": "",
  "transcribe": false,
  "valid_meeting": true,
  "privacy_mode_enabled": true,
  "creation_source": "macOS",
  "google_calendar_event": {
    "id": "abc123xyz",
    "summary": "Weekly Team Standup",
    "start": {"dateTime": "2025-03-07T14:00:00+01:00", "timeZone": "Europe/Berlin"},
    "end": {"dateTime": "2025-03-07T14:30:00+01:00", "timeZone": "Europe/Berlin"},
    "creator": {"email": "organizer@example.com"},
    "organizer": {"email": "organizer@example.com"},
    "attendees": [
      {
        "email": "organizer@example.com",
        "organizer": true,
        "responseStatus": "accepted"
      },
      {
        "email": "attendee1@example.com",
        "self": true,
        "responseStatus": "accepted"
      },
      {
        "email": "attendee2@example.com",
        "responseStatus": "accepted"
      },
      {
        "email": "attendee3@example.com",
        "responseStatus": "needsAction"
      }
    ],
    "location": "https://example.zoom.us/j/123456789",
    "conferenceData": {
      "entryPoints": [{"uri": "https://example.zoom.us/j/123456789", "entryPointType": "video"}]
    }
  },
  "people": {
    "creator": {
      "name": "Your Name",
      "email": "you@example.com",
      "details": {
        "person": {
          "name": {"fullName": "Your Name"},
          "avatar": "https://..."
        },
        "company": {"name": "Your Company"}
      }
    },
    "attendees": [
      {
        "email": "colleague@example.com",
        "details": {
          "person": {
            "name": {"fullName": "Colleague Name"},
            "avatar": "https://..."
          },
          "company": {"name": "Their Company"}
        }
      }
    ]
  },
  "panels": [
    {
      "type": "my_notes",
      "content": {"type": "doc", "content": [...]}
    },
    {
      "type": "enhanced_notes",
      "content": {"type": "doc", "content": [...]}
    }
  ],
  "chapters": null,
  "meeting_end_count": 1,
  "summary": null,
  "has_shareable_link": false,
  "attachments": [
    {
      "id": "abc123-attachment-id",
      "url": "https://d1ywymt16s8sdr.cloudfront.net/...",
      "type": "image",
      "width": 2000,
      "height": 160
    }
  ]
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `id` | Unique document identifier |
| `created_at` | When Granola note-taking started (you joined the meeting) |
| `updated_at` | Last update timestamp (proxy for meeting end) |
| `google_calendar_event.start.dateTime` | Scheduled meeting start time |
| `google_calendar_event.end.dateTime` | Scheduled meeting end time |
| `google_calendar_event.attendees[].responseStatus` | Calendar response: `accepted`, `declined`, `tentative`, `needsAction` |
| `people.attendees[].details.company.name` | Attendee's company (from enrichment) |
| `panels` | Contains `my_notes` and `enhanced_notes` in ProseMirror format |
| `attachments` | Array of meeting attachments with `url`, `type`, `width`, `height` |

### Fetching Transcripts

```bash
curl -s --compressed "https://api.granola.ai/v1/get-document-transcript" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"document_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}'
```

## Development

This plugin is written in TypeScript and uses esbuild for bundling.

### Project Structure

```
src/
├── main.ts        # Main plugin class with sync logic
├── settings.ts    # Settings tab UI
├── types.ts       # TypeScript interfaces
├── constants.ts   # API constants and defaults
└── utils.ts       # Utility functions
```

### Building

```bash
# Install dependencies
npm install

# Development (watch mode)
npm run dev

# Production build
npm run build
```

The build outputs `main.js` to the project root.

### Testing Locally

1. Build the plugin: `npm run build`
2. Copy `main.js`, `manifest.json`, `styles.css` to your vault's `.obsidian/plugins/granola-sync/`
3. Reload Obsidian or the plugin

## Credits

- **Original Plugin**: [Danny McClelland](https://github.com/dannymcc) - [Granola-to-Obsidian](https://github.com/dannymcc/Granola-to-Obsidian)
- **Original Contributors**: [@amscad](https://github.com/amscad), [@rylanfr](https://github.com/rylanfr), [@CaptainCucumber](https://github.com/CaptainCucumber), [@andrewsong-tech](https://github.com/andrewsong-tech)
- **API Discovery**: [Joseph Thacker](https://josephthacker.com/) for [discovering the Granola API](https://josephthacker.com/hacking/2025/05/08/reverse-engineering-granola-notes.html)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Fork maintained by [Yi Min Yang](https://www.yiminyang.dev/)**

*Not officially affiliated with Granola AI or Obsidian.*
