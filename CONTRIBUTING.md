# Contributing to SDA Hymnal Yoruba

Thank you for your interest in contributing. This project serves Yoruba-speaking Seventh-day Adventist communities, and every correction or addition makes a real difference.

## Ways to Contribute

### Hymn Corrections

The most valuable contributions are fixes to the hymn text in `hymns.json`:

- **Diacritics** - correcting missing or incorrect marks (ẹ, ọ, ṣ, and tonal marks like à, é, ì, ò, ù). These change word meaning in Yoruba, so accuracy matters.
- **Typos** - fixing misspelled words or incorrect lines
- **Missing verses** - adding verses that were left out
- **Chorus placement** - ensuring choruses appear in the correct position

### Cross-References

Each hymn can reference its number in other hymnals:

- `SDAH` - SDA Hymnal (English)
- `NAH` - New Advent Hymnal
- `CH` - Christ in Song Hymnal

If you know the corresponding number in any of these, add it to the hymn's `references` object.

### Missing Hymns

If a hymn is missing entirely, add it to `hymns.json` following the structure below.

### Code Contributions

Bug fixes, accessibility improvements, and performance enhancements are welcome. Please open an issue first to discuss larger changes.

## Hymn Data Structure

Each hymn in `hymns.json` follows this format:

```json
{
  "index": "001",
  "number": 1,
  "title": "Gbogbo Ẹ̀yin Tí Ń Gbé Ayé",
  "english_title": "All People On Earth Do Dwell",
  "references": {
    "SDAH": 16,
    "NAH": 2,
    "CH": 14
  },
  "lyrics": [
    {
      "type": "verse",
      "index": 1,
      "lines": [
        "Line one of the verse",
        "Line two of the verse"
      ]
    },
    {
      "type": "chorus",
      "index": 1,
      "lines": [
        "Line one of the chorus",
        "Line two of the chorus"
      ]
    }
  ],
  "revision": 1
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `index` | string | Zero-padded hymn number (e.g. `"001"`) |
| `number` | number | Hymn number |
| `title` | string | Yoruba title with full diacritics |
| `english_title` | string | English equivalent title |
| `references` | object | Corresponding numbers in other hymnals |
| `lyrics` | array | Ordered list of verses and choruses |
| `lyrics[].type` | string | `"verse"`, `"chorus"`, or `"call_response"` |
| `lyrics[].index` | number | Verse/chorus number |
| `lyrics[].lines` | array | Lines of text |
| `revision` | number | Incremented on each edit |

## Submitting Changes

### Setup

```bash
# Fork and clone the repo
git clone https://github.com/fisayoafolayan/sdahymnalyorubaweb.git
cd sdahymnalyorubaweb

# Run locally
npx serve .
```

### Workflow

1. Create a branch with a descriptive name:
   ```bash
   git checkout -b fix/hymn-42-diacritics
   ```

2. Make your changes

3. Validate the JSON:
   ```bash
   node -e "require('./hymns.json'); console.log('Valid')"
   ```

4. Test locally with `npx serve .` and verify your changes in the browser

5. Commit with a clear message:
   ```bash
   git add hymns.json
   git commit -m "Fix diacritics in hymn 42, verse 3"
   ```

6. Push and open a pull request

### PR Guidelines

- **One hymn per PR** for corrections - this makes review easier
- **Bump the `revision` field** when editing an existing hymn
- **Include the hymn number** in the PR title (e.g. "Fix hymn 42 - missing tonal marks in verse 3")
- **Describe what changed and why** - especially for diacritics changes, explain which marks were wrong

## Diacritics Guide

Yoruba diacritics are critical. Here are the special characters used:

### Sub-dots
| Character | Description |
|-----------|-------------|
| ẹ / Ẹ | e with dot below |
| ọ / Ọ | o with dot below |
| ṣ / Ṣ | s with dot below |

### Tonal Marks
| Mark | Example | Tone |
|------|---------|------|
| à | low | grave accent |
| á | high | acute accent |
| a | mid | no mark |

Tonal marks can combine with sub-dots: ẹ̀, ẹ́, ọ̀, ọ́

### Tips
- Use a Yoruba keyboard layout or character map
- Copy characters from existing hymns in the file if unsure
- When in doubt, open an issue and someone will help with the correct marks

## Code of Conduct

Be respectful. This is a worship resource used by churches. Keep discussions focused on improving the hymnal for the community it serves.

## Questions?

Open an issue on [GitHub](https://github.com/fisayoafolayan/sdahymnalyorubaweb/issues).
