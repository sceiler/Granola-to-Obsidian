# Granola Sync for Obsidian (Fork)

> This is a simplified fork of [dannymcc/Granola-to-Obsidian](https://github.com/dannymcc/Granola-to-Obsidian) focused on core sync functionality with configurable frontmatter.

An Obsidian plugin that automatically syncs your [Granola AI](https://granola.ai) meeting notes to your Obsidian vault.

## Features

- **Automatic & Manual Sync**: Sync on demand or set auto-sync intervals (1 min to 24 hours)
- **Configurable Frontmatter**: Customize category, tags, and choose which fields to include
- **People as Wiki Links**: Attendees appear as `[[John Smith]]` for easy linking
- **Daily Note Integration**: Automatically adds today's meetings to your daily note
- **German Umlaut Support**: Converts `ae` → `ä`, `oe` → `ö`, `ue` → `ü` in names
- **Smart Content Detection**: Only creates notes when Granola has finished processing (no empty notes)

## Frontmatter Example

```yaml
---
category:
  - "[[Meetings]]"
type:
date: 2026-02-03T14:00:06
org:
loc:
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
created_at: 2026-02-03T14:00:06.931Z
updated_at: 2026-02-03T14:50:53.150Z
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
| Skip Existing Notes | Don't overwrite notes that already exist |

### Filename Settings

| Setting | Description |
|---------|-------------|
| Filename Template | Use `{title}`, `{created_date}`, `{id}`, etc. |
| Date Format | Format for dates (e.g., `YYYY-MM-DD`) |
| Word Separator | Character between words (`_`, `-`, space, or none) |

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
| Exclude My Name | Filter your name from people list |
| Enable Custom Frontmatter | Add category, type, org, loc, topics fields |
| Category | Default category value (e.g., `[[Meetings]]`) |
| Tags | Default tags (comma-separated) |

### Daily Note Integration

| Setting | Description |
|---------|-------------|
| Enable Daily Note Integration | Add today's meetings to your daily note |
| Section Heading | Heading for the meetings section (e.g., `## Granola Meetings`) |

## Differences from Original

This fork is streamlined for a specific workflow:

| Feature | Original | This Fork |
|---------|----------|-----------|
| People format | Tags (`person/john-smith`) | Wiki links (`[[John Smith]]`) |
| Frontmatter | Fixed format | Configurable |
| Empty fields | Not included | Optional (`type`, `org`, `loc`, `topics`) |
| Codebase | ~2900 lines | ~1470 lines |

**Removed features**: Periodic notes integration, Granola folders, folder filtering, attendee tags, folder tags, date-based subfolders, duplicate detection command, reorganize notes command, note prefix, experimental search scope.

## Requirements

- Obsidian v1.6.6+
- Active Granola AI account
- Granola desktop app installed and authenticated

## Credits

- **Original Plugin**: [Danny McClelland](https://github.com/dannymcc) - [Granola-to-Obsidian](https://github.com/dannymcc/Granola-to-Obsidian)
- **Original Contributors**: [@amscad](https://github.com/amscad), [@rylanfr](https://github.com/rylanfr), [@CaptainCucumber](https://github.com/CaptainCucumber), [@andrewsong-tech](https://github.com/andrewsong-tech)
- **API Discovery**: [Joseph Thacker](https://josephthacker.com/) for [discovering the Granola API](https://josephthacker.com/hacking/2025/05/08/reverse-engineering-granola-notes.html)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Fork maintained by [Yi Min Yang](https://www.yiminyang.dev/)**

*Not officially affiliated with Granola AI or Obsidian.*
