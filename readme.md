# Granola Sync for Obsidian (Fork)

> This is a fork of [dannymcc/Granola-to-Obsidian](https://github.com/dannymcc/Granola-to-Obsidian) with custom frontmatter templates and additional improvements.

An Obsidian plugin that automatically syncs your [Granola AI](https://granola.ai) meeting notes to your Obsidian vault with full customization options and real-time status updates.

## Fork Changes

This fork includes the following modifications to better integrate with custom Obsidian workflows:

### Custom Frontmatter Template

The frontmatter format has been customized to match a specific meeting note template:

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

### Key Differences from Original

| Feature | Original | This Fork |
|---------|----------|-----------|
| **People format** | Tags (`person/john-smith`) | Wiki links (`[[John Smith]]`) |
| **Date field** | ISO timestamp with timezone | Local time without timezone (Obsidian Date & Time property) |
| **Emails** | Not included | Extracted from attendees |
| **Tags** | Dynamic attendee tags | Static `meetings` tag |
| **Empty fields** | Not included | Included for manual entry (`type`, `org`, `loc`, `topics`) |
| **Category** | Not included | Always `[[Meetings]]` |

### Additional Improvements

1. **German Umlaut Support**: Converts ASCII representations back to proper umlauts (`ae` → `ä`, `oe` → `ö`, `ue` → `ü`)

2. **Improved Name Extraction**: Prioritizes display names from Granola over email-derived names, with proper title-casing as fallback

3. **Better Filename Handling**:
   - Preserves `<>` characters in filenames (valid on macOS)
   - Only removes truly invalid characters (`:`, `/`, `\`, `|`, `?`, `*`, `"`)
   - Collapses multiple spaces properly

4. **Title Preservation**: Note headings retain the original title without character stripping

## Installation

### Manual Installation

1. Download the latest release from the [Releases page](https://github.com/sceiler/Granola-to-Obsidian/releases)
2. Extract the files to your vault's plugins directory: `.obsidian/plugins/granola-sync/`
3. Enable the plugin in Obsidian Settings → Community Plugins
4. Configure your sync settings

### Files to Download
- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`

## Configuration

Access plugin settings via **Settings → Community Plugins → Granola Sync**

### Core Settings

- **Sync Directory**: Folder to sync notes to (default: `Granola`)
- **Auth Key Path**: Path to Granola authentication file
- **Auto-Sync Frequency**: From manual-only to every 24 hours
- **Filename Template**: Customize note filenames with variables

### Frontmatter Settings

The frontmatter is generated with the following structure:
- User template fields first (category, type, date, org, loc, people, topics, tags)
- Emails list extracted from meeting attendees
- Granola-specific fields (granola_id, title, granola_url, created_at, updated_at)

### People Filtering

- **Exclude My Name**: Enable to filter out your own name from the people list
- **My Name**: Set your name as it appears in meetings for accurate filtering

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
