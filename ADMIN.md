# Admin guide: updating the Troop 45 schedule

This is for whoever keeps the schedule up to date. You don't need to install anything, and it works on a phone.

- **Live site:** https://troop45-thegoats.github.io/troop-45/
- **Where events live:** https://github.com/troop45-thegoats/troop-45/tree/main/content/meetings
- **What happened to recent edits:** https://github.com/troop45-thegoats/troop-45/actions

## Who has access

| Role | Who |
|---|---|
| Owner of the `troop45-thegoats` GitHub organization | The site's maintainer |
| Backup admin | [backup admin, still to be chosen] |
| Holds recovery details for the GitHub account and organization | The Scoutmaster |

Every admin uses their own GitHub account with two-factor login turned on. There is no shared password and no login on the site itself.

**How changes are approved:** [decision still open: direct edits, or every change goes through a pull request that a second person approves].

## The rules (the site and its history are public)

1. **No scout names, photos, nicknames, phone numbers, emails, or home addresses.** Not in an event, a task, or a commit message. Say "Patrol A", never a person.
2. **No adult contact details** unless the Scoutmaster approved them. Write "contact the Scoutmaster" instead.
3. **Never delete a past event.** If it was called off, mark it `status: cancelled`. Fix mistakes with a new edit.
4. **One file per event.** If another admin is editing the same event, tell them first.

The site checks rule 1 for you: anything that looks like an email address or phone number stops the update.

## Add an event

1. Open the events folder: https://github.com/troop45-thegoats/troop-45/tree/main/content/meetings
2. Tap **Add file**, then **Create new file**.
3. Name the file with the event's date, then a short name, using lowercase and hyphens:
   `2026-11-03-troop-meeting.md`
4. Paste the template below and change the details.
5. Tap **Commit changes**. In the message box, say what you did, for example "Add Nov 3 meeting". Keep **Commit directly to the main branch** selected, then tap **Commit changes** again.
6. Wait about two minutes, then reload the site. To watch progress, open the Actions page: a green tick means the site is updated, a red cross means it isn't (see "If something goes wrong").

### Template

```
---
title: Troop Meeting
type: meeting
date: 2026-11-03
start: "19:00"
end: "20:30"
location: Mary St
---
What to bring and where to meet. No names, phone numbers, or emails.

## Tasks
- [ ] Task for everyone (due 2026-11-02)
- [ ] [Patrol A] Task for one patrol
```

The same template, with a note on every line, is in `content/templates/meeting.md`.

### What each line means

| Line | What to write |
|---|---|
| `title` | The event's name, e.g. `Fall Campout` |
| `type` | One of: `meeting`, `campout`, `camp`, `plc`, `court-of-honor`, `service`, `other` |
| `date` | First day, as `YYYY-MM-DD`. Must match the start of the file name. |
| `end_date` | Only for events longer than one day. Last day, as `YYYY-MM-DD`. Delete the line otherwise. |
| `start`, `end` | 24-hour time **inside quotes**: `"19:00"`, not `19:00` or `7pm`. Both are optional. |
| `location` | Where it happens. Optional. |
| `status` | Leave it out normally. Add `status: cancelled` if the event is called off. |

Below the second `---` line, write a short public note: what to bring, where to meet, when pickup is.

### Tasks

Tasks go under the `## Tasks` heading, one per line:

- `- [ ] Bring a flashlight` is a task for everyone.
- `- [ ] [Patrol A] Plan the menu` is for one patrol. The patrol name must match one in `site.config.json` exactly.
- `- [ ] Return permission slip (due 2026-10-08)` has a due date. It must be at the very end of the line.
- `- [x] Reserve campsite` is done. It drops off the home page's To do list but stays on the event page.

Leave out the `## Tasks` heading entirely if there are no tasks.

## Change, cancel, or finish an event

1. Open the event's file in the events folder.
2. Tap the **pencil** icon (Edit).
3. Make the change:
   - **Moved to another day:** change `date`, and rename the file so it starts with the new date (the file name box is at the top of the edit screen).
   - **Called off:** add a line `status: cancelled` above the second `---`. The event stays on the site, marked Cancelled.
   - **Task done:** change `[ ]` to `[x]` on that line.
4. Tap **Commit changes** and describe the change, e.g. "Move Oct 14 meeting to the 15th".

Past events move to the Past page by themselves the day after they end, and are shown as Held unless they're marked cancelled. You never type "held".

## If something goes wrong

If your change breaks a rule, **the live site is not touched**: it keeps showing the last good version. The Actions page shows a red cross, and the run's page shows a box titled **Site not updated** with the file and the problem. Open the file, fix it, and commit again.

| The message says | What to do |
|---|---|
| `start must be a quoted 24-hour time like "19:00"` | Put the time in quotes and use 24-hour time: `start: "19:00"`. Same for `end`. |
| `date "..." is not a real date` | Use `YYYY-MM-DD` and a day that exists (no February 30). |
| `file name starts with ... but the date field is ...` | Rename the file so it starts with the same date as the `date` line. |
| `file name must look like YYYY-MM-DD-short-name.md` | Lowercase letters, numbers and hyphens only, ending in `.md`. |
| `is missing "title"` (or `"type"`, `"date"`) | Add the missing line between the `---` lines. |
| `type "..." is not allowed` | Use one of the types in the table above, spelled exactly. |
| `status "..." is not allowed` | Use `cancelled`, or delete the status line. |
| `unknown field "..."` | A line between the `---` lines is misspelled (e.g. `loaction`). |
| `end_date ... is before date ...` | Swap them or fix the typo. |
| `unknown patrol "[...]"` | Match the patrol name in `site.config.json` exactly, or leave the tag off for everyone. |
| `line N under "## Tasks" is not a task` | Every line under `## Tasks` must start with `- [ ] ` (dash, space, brackets with a space, space). |
| `write the due date at the end of the line` | Move `(due YYYY-MM-DD)` to the end of the task. |
| `contains what looks like contact info` | Remove the email address or phone number. If the Scoutmaster approved it, the maintainer adds it to `allowedContacts`. |
| `the header between the --- lines can't be read` | Usually a missing `---` line or a missing colon. Compare with the template. |

**Undoing a change:** open the file's **History**, see what changed, and edit it back. Never delete history or force anything; every change is kept on record on purpose.

**If GitHub says there is a conflict when you save:** someone else changed the same file. Reload the page and make your edit again.

## Settings that rarely change

`site.config.json` holds the troop name, town, meeting place, meeting day, time zone, patrol names, and approved contact addresses. Edit it the same way as an event. A mistake there also stops the update and leaves the live site as it was.

## Handing the site on (succession)

The site belongs to the `troop45-thegoats` GitHub organization, not to any one person, so its address never changes when people do.

1. The new maintainer creates their own GitHub account (with a username that isn't their real name) and turns on two-factor login.
2. An organization owner invites them: organization page, **People**, **Invite member**, role **Owner**.
3. Once they accept, the old maintainer can step down to member or leave.
4. Update the "Who has access" table at the top of this file.
5. Give the Scoutmaster the new owner's recovery details.

Always keep at least two owners, so losing one account never locks everyone out.
