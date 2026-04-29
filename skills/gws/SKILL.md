---
name: gws
description: Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs.
homepage: https://www.npmjs.com/package/@googleworkspace/cli
metadata:
  {
    "edwin":
      {
        "emoji": "🎮",
        "requires": { "bins": ["gws"] },
        "install":
          [
            {
              "id": "npm",
              "kind": "npm",
              "package": "@googleworkspace/cli",
              "bins": ["gws"],
              "label": "Install gws (npm)",
            },
          ],
      },
  }
---

# gws

Use `gws` for Gmail/Calendar/Drive/Contacts/Sheets/Docs. Requires OAuth setup.

Setup (once)

- `gws auth setup` (interactive — configures credentials)
- `gws auth login --services gmail,calendar,drive,contacts,docs,sheets`
- `gws auth status`

Common commands

- Gmail search: `gws gmail users messages list --params '{"userId": "me", "q": "newer_than:7d", "maxResults": 10}'`
- Gmail send (plain): `gws gmail +send --to a@b.com --subject "Hi" --body "Hello"`
- Gmail send (multi-line): `gws gmail +send --to a@b.com --subject "Hi" --body-file ./message.txt`
- Gmail send (stdin): `gws gmail +send --to a@b.com --subject "Hi" --body-file -`
- Gmail send (HTML): `gws gmail +send --to a@b.com --subject "Hi" --body-html "<p>Hello</p>"`
- Gmail draft: `gws gmail users drafts create --params '{"userId": "me"}' --body-file ./message.txt`
- Gmail reply: `gws gmail +send --to a@b.com --subject "Re: Hi" --body "Reply" --reply-to-message-id <msgId>`
- Calendar list events: `gws calendar events list --params '{"calendarId": "<calendarId>", "timeMin": "<iso>", "timeMax": "<iso>"}'`
- Calendar create event: `gws calendar events insert --params '{"calendarId": "<calendarId>"}' --body '{"summary": "Title", "start": {"dateTime": "<iso>"}, "end": {"dateTime": "<iso>"}}'`
- Calendar create with color: `gws calendar events insert --params '{"calendarId": "<calendarId>"}' --body '{"summary": "Title", "start": {"dateTime": "<iso>"}, "end": {"dateTime": "<iso>"}, "colorId": "7"}'`
- Calendar update event: `gws calendar events patch --params '{"calendarId": "<calendarId>", "eventId": "<eventId>"}' --body '{"summary": "New Title", "colorId": "4"}'`
- Calendar show colors: `gws calendar colors get`
- Drive search: `gws drive files list --params '{"q": "query", "pageSize": 10}'`
- Contacts: `gws people connections list --params '{"resourceName": "people/me", "pageSize": 20, "personFields": "names,emailAddresses"}'`
- Sheets get: `gws sheets spreadsheets values get --params '{"spreadsheetId": "<sheetId>", "range": "Tab!A1:D10"}'`
- Sheets update: `gws sheets spreadsheets values update --params '{"spreadsheetId": "<sheetId>", "range": "Tab!A1:B2", "valueInputOption": "USER_ENTERED"}' --body '{"values": [["A","B"],["1","2"]]}'`
- Sheets append: `gws sheets spreadsheets values append --params '{"spreadsheetId": "<sheetId>", "range": "Tab!A:C", "valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"}' --body '{"values": [["x","y","z"]]}'`
- Sheets clear: `gws sheets spreadsheets values clear --params '{"spreadsheetId": "<sheetId>", "range": "Tab!A2:Z"}'`
- Sheets metadata: `gws sheets spreadsheets get --params '{"spreadsheetId": "<sheetId>"}'`
- Docs export: `gws docs documents get --params '{"documentId": "<docId>"}'`

Calendar Colors

- Use `gws calendar colors get` to see all available event colors (IDs 1-11)
- Add colors to events with `"colorId"` in the request body
- Event color IDs:
  - 1: #a4bdfc
  - 2: #7ae7bf
  - 3: #dbadff
  - 4: #ff887c
  - 5: #fbd75b
  - 6: #ffb878
  - 7: #46d6db
  - 8: #e1e1e1
  - 9: #5484ed
  - 10: #51b749
  - 11: #dc2127

Email Formatting

- Prefer plain text. Use `--body-file` for multi-paragraph messages (or `--body-file -` for stdin).
- Same `--body-file` pattern works for drafts and replies.
- `--body` does not unescape `\n`. If you need inline newlines, use a heredoc or `$'Line 1\n\nLine 2'`.
- Use `--body-html` only when you need rich formatting.
- HTML tags: `<p>` for paragraphs, `<br>` for line breaks, `<strong>` for bold, `<em>` for italic, `<a href="url">` for links, `<ul>`/`<li>` for lists.
- Example (plain text via stdin):

  ```bash
  gws gmail +send --to recipient@example.com \
    --subject "Meeting Follow-up" \
    --body-file - <<'EOF'
  Hi Name,

  Thanks for meeting today. Next steps:
  - Item one
  - Item two

  Best regards,
  Your Name
  EOF
  ```

- Example (HTML list):
  ```bash
  gws gmail +send --to recipient@example.com \
    --subject "Meeting Follow-up" \
    --body-html "<p>Hi Name,</p><p>Thanks for meeting today. Here are the next steps:</p><ul><li>Item one</li><li>Item two</li></ul><p>Best regards,<br>Your Name</p>"
  ```

Notes

- Config is stored at `~/.config/gws/` (set `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` to override).
- For scripting, prefer `--output json`.
- Sheets values can be passed via `--body` JSON.
- Confirm before sending mail or creating events.
