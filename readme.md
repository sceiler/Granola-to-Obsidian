# Granola Sync for Obsidian

An Obsidian plugin that automatically syncs your [Granola AI](https://granola.ai) meeting notes to your Obsidian vault with full customization options and real-time status updates.

![Granola Sync Plugin](https://img.shields.io/badge/Obsidian-Plugin-purple) ![Version](https://img.shields.io/badge/version-1.0.8-blue) ![License](https://img.shields.io/badge/license-MIT-green)

With thanks to [Joseph Thacker](https://josephthacker.com/) for first discovering that it's possible to query the Granola [API using locally stored auth keys](https://josephthacker.com/hacking/2025/05/08/reverse-engineering-granola-notes.html)!

## 🚀 Features

- **🔄 Automatic Sync**: Configurable auto-sync from every minute to daily, or manual-only
- **📊 Status Bar Integration**: Real-time sync status in the bottom right corner (no more popup spam!)
- **📅 Custom Date Formats**: Support for multiple date formats (YYYY-MM-DD, DD-MM-YYYY, etc.)
- **📝 Flexible Filename Templates**: Customize how notes are named with variables like date, time, and title
- **📁 Custom Directory**: Choose where in your vault to sync notes
- **🏷️ Note Prefixes**: Add custom prefixes to all synced notes
- **🔧 Custom Auth Path**: Override the default Granola credentials location
- **🗓️ Daily Note Integration**: Automatically add today's meetings to your Daily Note with times and links
- **🛡️ Preserve Manual Additions**: Option to skip updating existing notes, preserving your tags, summaries, and custom properties
- **✨ Rich Metadata**: Includes frontmatter with creation/update dates and Granola IDs
- **📋 Content Conversion**: Converts ProseMirror content to clean Markdown
- **🔄 Update Handling**: Intelligently updates existing notes instead of creating duplicates

## 📦 Installation

### Manual Installation

1. Download the latest release from the [Releases page](https://github.com/dannymcc/Granola-to-Obsidian/releases)
2. Extract the files to your vault's plugins directory: `.obsidian/plugins/granola-sync/`
3. Enable the plugin in Obsidian Settings → Community Plugins
4. Configure your sync settings

### Files to Download
- `main.js`
- `manifest.json` 
- `styles.css`
- `versions.json`

## ⚙️ Configuration

Access plugin settings via **Settings → Community Plugins → Granola Sync**

### Sync Directory
Choose which folder in your vault to sync notes to (default: `Granola`)

### Note Prefix
Optional prefix to add to all synced note filenames (e.g., `meeting-`, `granola-`)

### Auth Key Path
Path to your Granola authentication file. Default locations:
- **macOS**: `Library/Application Support/Granola/supabase.json`
- **Windows**: `AppData/Roaming/Granola/supabase.json`

The plugin automatically detects your operating system and sets the appropriate default path.

### Filename Template
Customize how your notes are named using these variables:
- `{title}` - The meeting/note title
- `{id}` - Granola document ID
- `{created_date}` - Creation date
- `{updated_date}` - Last updated date  
- `{created_time}` - Creation time
- `{updated_time}` - Last updated time
- `{created_datetime}` - Full creation date and time
- `{updated_datetime}` - Full updated date and time

**Example Templates:**
- `{created_date}_{title}` → `2025-06-06_Team_Standup_Meeting.md`
- `Meeting_{created_datetime}_{title}` → `Meeting_2025-06-06_14-30-00_Team_Standup_Meeting.md`

### Date Format
Customize date formatting using these tokens:
- `YYYY` - 4-digit year (2025)
- `YY` - 2-digit year (25)
- `MM` - 2-digit month (06)
- `DD` - 2-digit day (06)
- `HH` - 2-digit hours (14)
- `mm` - 2-digit minutes (30)
- `ss` - 2-digit seconds (45)

**Popular Formats:**
- `YYYY-MM-DD` → 2025-06-06 (ISO)
- `DD-MM-YYYY` → 06-06-2025 (European)
- `MM-DD-YYYY` → 06-06-2025 (US)
- `DD.MM.YY` → 06.06.25 (German)

### Auto-Sync Frequency
Choose how often to automatically sync:
- Never (manual only)
- Every 1-2 minutes (frequent)
- Every 5-15 minutes (recommended)
- Every 30 minutes to 24 hours (conservative)

## 🎯 Usage

### Manual Sync
- Click the sync icon in the ribbon (left sidebar)
- Use Command Palette: "Sync Granola Notes"
- Click "Sync Now" in plugin settings
- **Watch the status bar** (bottom right) for real-time progress

### Auto-Sync
Set your preferred frequency in settings and the plugin will sync automatically in the background. Status updates appear in the status bar.

### Status Bar Indicators
- **"Granola Sync: Idle"** - Ready to sync
- **"Granola Sync: Syncing..."** - Currently syncing (with animation)
- **"Granola Sync: X notes synced"** - Success (shows for 3 seconds)
- **"Granola Sync: Error - [details]"** - Error occurred (shows for 5 seconds)

### Skip Existing Notes
When enabled, notes that already exist in your vault will not be updated during sync. This is perfect for preserving any manual additions you've made such as:
- Custom tags
- Personal summaries
- Additional notes or comments
- Custom frontmatter properties

**How it works**: The plugin uses the `granola_id` in the frontmatter to identify existing notes, so you can safely:
- Rename note files
- Change filename templates
- Modify note titles
- Move notes within the sync directory

As long as you don't modify the `granola_id` field, the plugin will recognize them as the same note.

**Note**: New notes from Granola will still be imported, but existing ones won't be overwritten.

### Daily Note Integration
When enabled, today's Granola meetings automatically appear in your Daily Note:

```markdown
## Granola Meetings
- 09:30 [[Granola/2025-06-09_Team_Standup|Team Standup]]
- 14:00 [[Granola/2025-06-09_Client_Review|Client Review Meeting]]
```

### Preview Your Settings
Use the preview buttons in settings to see how your filename template and date format will look before syncing.

## 📄 Note Format

Synced notes include rich frontmatter with metadata:

```markdown
---
granola_id: abc123def456
title: "Team Standup Meeting"
created_at: 2025-06-06T14:30:00.000Z
updated_at: 2025-06-06T15:45:00.000Z
---

# Meeting Notes

Your converted meeting content appears here in clean Markdown format.

- Action items are preserved
- Headings maintain their structure
- All formatting is converted appropriately
```

## 🔧 Requirements

- Obsidian v0.15.0+
- Active Granola AI account
- Granola desktop app installed and authenticated (available for macOS and Windows)

## 🐛 Troubleshooting

### Plugin Won't Enable
- Check that all plugin files are in the correct directory
- Ensure you have the latest version of Obsidian
- Check the console (Ctrl/Cmd + Shift + I) for error messages

### No Notes Syncing
- Verify your Granola auth key path is correct
- Check that you have meeting notes in your Granola account
- Ensure the sync directory exists or can be created
- Look for error messages in the Obsidian console

### Authentication Issues
- Make sure Granola desktop app is logged in
- Check that the auth key file exists at the expected location:
  - **macOS**: `~/Library/Application Support/Granola/supabase.json`
  - **Windows**: `C:\Users\[USERNAME]\AppData\Roaming\Granola\supabase.json`
- If the file is in a different location, update the "Auth Key Path" in plugin settings
- Try logging out and back in to Granola

### File Naming Issues
- Use the preview buttons to test your templates
- Avoid special characters in custom prefixes
- Check that your date format is valid

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup
1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to compile
4. Copy files to your Obsidian plugins directory for testing

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Granola AI](https://granola.ai) for creating an amazing meeting assistant
- The Obsidian community for plugin development resources
- Contributors and testers who helped improve this plugin

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/dannymcc/Granola-to-Obsidian/issues)
- **Documentation**: This README and plugin settings descriptions
- **Community**: [Obsidian Discord](https://discord.gg/veuWUTm) #plugin-dev channel

---

**Made with ❤️ by [Danny McClelland](https://github.com/dannymcc)**

*Not officially affiliated with Granola AI or Obsidian.*