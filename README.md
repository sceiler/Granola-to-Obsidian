# Granola Sync for Obsidian (Fork)

> A fork of [dannymcc/Granola-to-Obsidian](https://github.com/dannymcc/Granola-to-Obsidian) with enhanced metadata extraction, wiki-link formatting, and configurable frontmatter.

An Obsidian plugin that automatically syncs your [Granola AI](https://granola.ai) meeting notes to your Obsidian vault.

> **v3.0.0 is a breaking release.** The plugin now uses Granola's official public API (`public-api.granola.ai/v1`) instead of scraping the desktop app's local auth file. You must paste a personal API key into settings. A few features are gone because the official API doesn't expose them. See the [v3.0.0 Migration](#v300-migration) section below.

**Key differences from upstream**: official API integration, wiki links for people/companies, calendar-based date fields, auto-detection of your name, email-domain-based company extraction, attendee name overrides, smart German umlaut conversion, incremental sync via `updated_after`. See [Differences from Original](#differences-from-original) for details.

## Features

- **Official API**: Uses Granola's public API with a stable personal API key (no token expiry)
- **Automatic & Manual Sync**: Sync on demand or set auto-sync intervals (1 min to 24 hours)
- **Incremental Sync**: After the first sync, subsequent runs only pull notes Granola has updated since the last successful sync
- **Configurable Frontmatter**: Customize category, tags, and choose which fields to include
- **People as Wiki Links**: Attendees appear as `[[John Smith]]` for easy linking
- **Company Wiki Links**: Organizations extracted from attendee email domains (e.g., `user@acme.com` → `[[Acme]]`) in `org` field
- **Auto-Detect Your Name**: Uses the API key owner's name (the account the key belongs to) — no manual configuration needed
- **Attendee Name Overrides**: Map an email to a fixed display name for cases where you want a different label than Granola provides
- **Calendar-Based Dates**: `date`/`dateEnd` from `calendar_event.scheduled_*_time`, `noteStarted`/`noteEnded` from note timestamps
- **Smart German Umlaut Conversion**: Converts `ae` → `ä`, `oe` → `ö`, `ue` → `ü` while preserving names like Miguel, Michael, Joel
- **Daily Note Integration**: Automatically adds today's meetings to your daily note
- **Auto-Relink Legacy Notes**: If you had earlier versions of this plugin installed, your existing notes' `granola_id` (UUID) gets auto-migrated to the new `not_*` slug on first sync, preventing duplicates

## Frontmatter Example

```yaml
---
category:
  - "[[Meetings]]"
type:
date: 2026-02-03T14:00              # From calendar_event.scheduled_start_time
dateEnd: 2026-02-03T14:30           # From calendar_event.scheduled_end_time
noteStarted: 2026-02-03T14:00       # note.created_at
noteEnded: 2026-02-03T14:50         # note.updated_at
org:
  - "[[Acme]]"                      # Extracted from attendee email domains
  - "[[Globex]]"
loc:                                # Empty by default — meeting-platform auto-detection
                                    # was removed in v3 (no source data in the new API)
people:
  - "[[John Smith]]"
  - "[[Jane Doe]]"
topics:
tags:
  - meetings
emails:
  - john.smith@example.com
  - jane.doe@example.com
granola_id: not_aBcDeFgHiJkLmN      # New format: not_* slug (was UUID in v2.x)
title: "Weekly Team Standup"
granola_url: https://notes.granola.ai/d/a1b2c3d4-e5f6-7890-abcd-ef1234567890
---
```

## Installation

### Prerequisites

You need a personal Granola API key. Generate one in the Granola app (Business or Enterprise plan required as of writing) — see [docs.granola.ai → Personal API](https://docs.granola.ai/help-center/sharing/integrations/personal-api).

### Manual Installation

1. Download the latest release from the [Releases page](../../releases)
2. Extract the files to your vault's plugins directory: `.obsidian/plugins/granola-sync/`
3. Enable the plugin in Obsidian Settings → Community Plugins
4. Open plugin settings and paste your API key (`grn_…`) into the **API key** field
5. Hit the ribbon icon or run "Sync Granola Notes" from the command palette

### Files to Download
- `main.js`
- `manifest.json`
- `styles.css`

## Configuration

Access plugin settings via **Settings → Community Plugins → Granola Sync**

### Authentication

| Setting | Description |
|---------|-------------|
| API Key | Your personal Granola API key (`grn_…`). Required. Stored locally in plugin data. |

### Sync Settings

| Setting | Description |
|---------|-------------|
| Sync Directory | Folder where notes are saved (default: `Notes`) |
| Auto-Sync Frequency | How often to sync (manual to every 24 hours) |
| Document Limit | Maximum number of recent documents to sync (1–1000; API hard cap is 30 per page so the plugin paginates internally) |
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
| Include Enhanced Notes | The AI-generated meeting summary (`summary_markdown` from the API) |
| Include Transcript | Full meeting transcript — adds one extra `?include=transcript` request per note, so the sync is slower |

> **Note:** v2.x had an "Include My Notes" toggle for your raw user-typed notes. The official API doesn't expose that field, so it was removed in v3.

### Frontmatter Options

| Setting | Description |
|---------|-------------|
| Include Granola URL | Add `granola_url` (= `note.web_url`) to frontmatter |
| Include Emails | Attendee email addresses |
| Exclude My Name | Filter your name from people list |
| Auto-Detect My Name | Use the API key owner's name (default: on) |
| My Name (Override) | Manual override if you prefer a different label than the API returns |
| Attendee Name Overrides | Per-email name overrides (e.g. fix diacritics, force a nickname) |
| Enable Custom Frontmatter | Add category, type, org, loc, topics fields |
| Category | Default category value (e.g., `[[Meetings]]`) |
| Tags | Default tags (comma-separated) |

### Frontmatter Field Order

Configure which fields appear in frontmatter and in what order. Access via **Settings → Frontmatter field order**.

- **Toggle fields on/off** - Disable fields you don't need
- **Reorder with up/down buttons** - Arrange fields in your preferred order
- **Required fields** - `granola_id` and `noteEnded` cannot be disabled (needed for sync)

| Field | Description |
|-------|-------------|
| `category` | Custom category (e.g., `[[Meetings]]`) |
| `type` | Empty placeholder for manual entry |
| `date` | Scheduled meeting start time |
| `dateEnd` | Scheduled meeting end time |
| `noteStarted` | When Granola note-taking started |
| `noteEnded` | Last note update (required) |
| `org` | Company names as wiki links (extracted from attendee email domains) |
| `loc` | Empty placeholder (was meeting platform in v2; see [v3.0.0 Migration](#v300-migration)) |
| `people` | Attendee names as wiki links |
| `topics` | Empty placeholder for manual entry |
| `tags` | Custom tags |
| `emails` | Attendee email addresses |
| `granola_id` | Unique document ID (required) |
| `title` | Meeting title |
| `granola_url` | Link to original Granola note |

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
| Official Granola API | Stable, supported integration via `public-api.granola.ai/v1` instead of scraping the desktop app |
| Incremental sync | Uses `updated_after` query param so subsequent syncs only fetch changed notes |
| Company wiki links | `org` field populated with `[[Company Name]]` from attendee email domains |
| Auto-detect user | Uses the API key owner's name (the account the key belongs to) |
| Attendee name overrides | Per-email manual name mapping for diacritics/nicknames |
| Calendar-based dates | `date`/`dateEnd` from `calendar_event.scheduled_*_time`, `noteStarted`/`noteEnded` from note timestamps |
| Smart umlaut conversion | Preserves names like Miguel, Michael, Joel while converting German surnames |
| Auto-relink legacy notes | Notes synced with prior plugin versions (UUID `granola_id`) get auto-migrated to the new `not_*` slug on first sync |

### Changed Features

| Feature | Upstream | This Fork |
|---------|----------|-----------|
| Auth | Reads `supabase.json` from desktop app | User-supplied API key (`grn_…`) |
| API endpoint | `api.granola.ai/v2/get-documents` (POST) | `public-api.granola.ai/v1/notes` (GET, cursor-paginated) |
| People format | Tags (`person/john-smith`) | Wiki links (`[[John Smith]]`) |
| Frontmatter | Fixed format | Configurable template with empty fields |
| Date source | `created_at` only | Calendar scheduled times + note timestamps |
| Umlaut conversion | Simple replacement | Pattern-aware (preserves non-German names) |

### Removed Features

Removed in v3.0.0 because the official public API doesn't expose them:

- **My Notes section** — only the AI `summary_markdown` is exposed
- **Attachment downloads** — no attachment schema in the public API
- **Meeting platform auto-detection** (`loc: [[Zoom]]`) — `calendar_event` has no conferencing URL field
- **Attendee response-status filtering** — flat `{name, email}` attendees, no RSVP status

Removed previously (to simplify the codebase):

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
- Active Granola AI account on a plan that allows API access (Business or Enterprise at time of writing)
- A personal Granola API key — generate at [docs.granola.ai → Personal API](https://docs.granola.ai/help-center/sharing/integrations/personal-api)

## v3.0.0 Migration

### Why v3 exists

Versions 1.x–2.x authenticated by reading the access token from Granola's local desktop-app storage:

```
~/Library/Application Support/Granola/supabase.json   (macOS)
~/.config/Granola/supabase.json                       (Linux)
%APPDATA%/Granola/supabase.json                       (Windows)
```

Around May 2026, the Granola desktop app migrated credential storage to an encrypted blob (keyed via the OS keychain). The plaintext `supabase.json` is no longer kept fresh — the token written there expires after ~6 hours and is never rotated, so every API call from any plugin reading that file returns `401 Unauthorized`.

Meanwhile, Granola shipped an official public API at `https://public-api.granola.ai/v1` that uses user-generated keys (`grn_*`) with no expiry or rotation. v3.0.0 switches to this API.

### What changed

| Aspect | v2.x | v3.0.0 |
|--------|------|--------|
| Auth | Bearer token scraped from `supabase.json` | User-pasted API key (`grn_…`) |
| Base URL | `api.granola.ai/v2/get-documents` (POST) | `public-api.granola.ai/v1/notes` (GET) |
| Pagination | offset/limit (100/page) | cursor (30/page, internal) |
| Per-note shape | One POST returns everything (rich ProseMirror doc) | List + per-note GET (summary metadata only on list) |
| Body content | ProseMirror → markdown conversion in plugin | API serves `summary_markdown` directly |
| `granola_id` format | UUID (e.g. `a1b2c3d4-…`) | Slug (e.g. `not_aBcDeFgHiJkLmN`) |
| `granola_url` | Constructed by the plugin | Returned as `note.web_url` |
| Transcript | Separate `POST /v1/get-document-transcript` | Same endpoint, `?include=transcript` |
| Incremental sync | Not supported (always full pass) | `updated_after` query param |
| Rate limit | None enforced | 5 req/s sustained, 25 burst (plugin throttles to ~4 req/s) |

### Features removed in v3

Three features are gone because the official API doesn't expose the underlying data. Verified against the [OpenAPI 3.1 spec](https://docs.granola.ai/api-reference/openapi.json) and live probes against 30 real notes (tried 14 `include=` variants, 6 hypothetical subpaths — all rejected):

- **"My Notes" section** — your own typed notes are not exposed. Only the AI-generated `summary_markdown` is.
- **Attachment downloads** — no attachment schema, no attachment endpoint.
- **Meeting platform auto-detection** (`loc: [[Zoom]]`) — `calendar_event` has exactly 6 fields (`event_title`, `invitees`, `organiser`, `calendar_event_id`, `scheduled_start_time`, `scheduled_end_time`). No conferencing URL, no `location`, no `hangoutLink`.

The corresponding settings have been removed from the UI. Old saved values for these settings are quietly stripped on plugin load.

### Auto-relinking your existing notes

Notes synced with v2.x have a UUID `granola_id` in their frontmatter (e.g. `granola_id: a1b2c3d4-…`). The new API returns `not_*` slugs instead. Without intervention, every existing note would look "new" to the plugin and a duplicate would be created on the next sync.

v3 solves this by extracting the underlying UUID from the new API's `web_url` (e.g. `https://notes.granola.ai/d/a1b2c3d4-…`) and matching it against your existing notes' `granola_id`. When a match is found, the plugin rewrites that file's `granola_id` to the new `not_*` slug in place — your manual frontmatter edits and note body are preserved.

The relink runs automatically on every sync, so you don't need to do anything. If you have more than `documentSyncLimit` notes (default 100), bump the limit temporarily on the first v3 sync if you want everything migrated in one pass; otherwise older notes stay frozen with their UUID `granola_id` and just won't receive future content updates.

### What if I have v2.x duplicates already?

If you ran v3 with a stale build before the relink logic existed (early-access users), your vault may have `<name>_HH-mm.md` duplicate files with `not_*` IDs alongside the originals. Match each `not_*` file's `granola_url` UUID to the existing UUID file, then delete the `not_*` copy — the next sync will relink the original.

## Granola API Reference (v3)

The plugin uses Granola's official public API. Full documentation: [docs.granola.ai/introduction](https://docs.granola.ai/introduction).

### Endpoints used

- `GET /v1/notes` — list notes (cursor pagination, max `page_size=30`)
- `GET /v1/notes/{note_id}` — fetch a single note's full body (optionally `?include=transcript`)
- `GET /v1/folders` — list folders (not currently used by this plugin)

### Authentication

```
Authorization: Bearer grn_YOUR_API_KEY
```

Personal API keys access notes you own and notes shared with you. Enterprise keys access team-wide notes. Both use the same Bearer scheme.

### Listing notes

```bash
KEY="grn_REPLACE_ME"
curl -s "https://public-api.granola.ai/v1/notes?page_size=30&updated_after=2026-01-01T00:00:00Z" \
  -H "Authorization: Bearer ${KEY}"
```

```json
{
  "notes": [
    {
      "id": "not_aBcDeFgHiJkLmN",
      "object": "note",
      "title": "Weekly Team Standup",
      "owner": { "name": "Your Name", "email": "you@example.com" },
      "created_at": "2026-01-15T14:00:13.451Z",
      "updated_at": "2026-01-15T14:50:57.056Z"
    }
  ],
  "hasMore": true,
  "cursor": "eyJjcmVhdGVkX2F0Ijoi..."
}
```

The list endpoint returns metadata only. You must call the per-note endpoint to get the body.

### Fetching a single note (with transcript)

```bash
curl -s "https://public-api.granola.ai/v1/notes/not_aBcDeFgHiJkLmN?include=transcript" \
  -H "Authorization: Bearer ${KEY}"
```

```json
{
  "id": "not_aBcDeFgHiJkLmN",
  "object": "note",
  "title": "Weekly Team Standup",
  "web_url": "https://notes.granola.ai/d/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "owner": { "name": "Your Name", "email": "you@example.com" },
  "created_at": "2026-01-15T14:00:13.451Z",
  "updated_at": "2026-01-15T14:50:57.056Z",
  "calendar_event": {
    "event_title": "Weekly Team Standup",
    "invitees": [
      { "email": "you@example.com" },
      { "email": "colleague@example.com" }
    ],
    "organiser": "you@example.com",
    "calendar_event_id": "abc123xyz_20260115T140000Z",
    "scheduled_start_time": "2026-01-15T14:00:00Z",
    "scheduled_end_time": "2026-01-15T14:30:00Z"
  },
  "attendees": [
    { "name": "Your Name", "email": "you@example.com" },
    { "name": "Colleague Name", "email": "colleague@example.com" }
  ],
  "folder_membership": [],
  "summary_text": "Discussed Q1 planning. Action items: ship the launch by Feb 28.",
  "summary_markdown": "### Q1 Planning\n\n- Discussed roadmap\n- **Action item:** ship the launch by Feb 28",
  "transcript": [
    {
      "text": "Hey, can you hear me?",
      "start_time": "2026-01-15T14:00:20.637Z",
      "end_time": "2026-01-15T14:00:21.717Z",
      "speaker": { "source": "microphone" }
    },
    {
      "text": "Yep, loud and clear.",
      "start_time": "2026-01-15T14:00:21.880Z",
      "end_time": "2026-01-15T14:00:22.840Z",
      "speaker": { "source": "speaker" }
    }
  ]
}
```

### Field mapping

| Frontmatter field | Source on the API response |
|-------------------|----------------------------|
| `granola_id` | `note.id` |
| `title` | `note.title` |
| `granola_url` | `note.web_url` |
| `date` | `note.calendar_event.scheduled_start_time` |
| `dateEnd` | `note.calendar_event.scheduled_end_time` |
| `noteStarted` | `note.created_at` |
| `noteEnded` | `note.updated_at` |
| `people` | `note.attendees[].name`, deduped, wiki-linked, self-excluded |
| `emails` | `note.attendees[].email` |
| `org` | Extracted from `note.attendees[].email` domain (non-personal domains) |
| `loc` | Empty (no source data) |

The "Enhanced Notes" section is `note.summary_markdown` verbatim — the plugin no longer parses ProseMirror.

The speaker source in transcript segments is `microphone` (the API key owner's mic) or `speaker` / other (system audio, i.e. other participants).

### Rate limits

5 req/s sustained, 25 burst per workspace/user. The plugin enforces a 250 ms minimum interval between requests (≈4 req/s) and retries once on HTTP 429 honoring `Retry-After`.

### Caveats

> Per the Granola docs: "The API only returns notes that have a generated AI summary and transcript. Notes that are still being processed or were never summarized won't appear in responses."

This is enforced server-side and replaces the v2 client-side check that gated on enhanced-notes presence.

## Development

The original plugin was written in plain JavaScript (~2,200 lines in a single file). This fork has been refactored to TypeScript with a modular architecture and esbuild for bundling.

### Why TypeScript?

| Benefit | Description |
|---------|-------------|
| Type safety | Catch errors at build time instead of runtime in Obsidian |
| IDE support | Autocompletion for Granola API responses, settings, and Obsidian APIs |
| Maintainability | Modular codebase with single-responsibility files |
| Smaller bundle | Minified output is 48% smaller than the original JavaScript |

### Bundle Size

| Version | Size | Source lines |
|---------|------|--------------|
| Upstream v0.x (raw JS, single file) | ~67 KB | ~2,181 |
| v2.x (TS, minified) | ~35 KB | ~2,317 |
| v3.0.0 (TS, minified) | ~30 KB | ~1,870 |

v3 deletes ~450 source lines: the ProseMirror → markdown converter, attachment download path, meeting-platform detection, panel extraction, complex attendee resolution, and credentials-from-disk logic.

### Project Structure

```
src/
├── main.ts        # Main plugin class with sync logic
├── settings.ts    # Settings tab UI
├── types.ts       # TypeScript interfaces
├── constants.ts   # API constants and defaults
└── utils.ts       # Utility functions
```

### Requirements

- Node.js 24+
- npm

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
