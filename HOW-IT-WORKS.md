# How the Troop 45 site works

A plain-language tour of the whole system: where the data lives, how it becomes a website, what can go wrong, and how to change it.

## The short version

There is no server, no database, and no login. Each event is one small text file. When someone changes a file on GitHub, GitHub runs a script that checks every file, turns them into plain web pages, and publishes those pages. If any check fails, nothing is published and the old site stays up.

```
content/meetings/*.md   ->   scripts/build.js   ->   dist/*.html   ->   GitHub Pages
 (one note per event)        (check, then build)     (plain pages)      (the live site)
```

## The pieces

| File or folder | What it does |
|---|---|
| `content/meetings/` | The real events, one Markdown note each. The only place schedule data lives. |
| `content/samples/` | Made-up events for testing the design. Never published. |
| `content/templates/meeting.md` | Copy-paste starting point for a new event. |
| `site.config.json` | Settings: troop name, town, meeting place, time zone, patrols, the site's address, approved contacts. |
| `scripts/build.js` | The whole program: reads notes, checks them, works out dates, writes the pages. |
| `scripts/build.test.js` | Automatic tests for the program. |
| `scripts/og-card.html` | Source for the social preview image (`og.png`), with the command to redraw it. |
| `src/static/` | Files copied to the site unchanged: stylesheet, fonts, icon, preview image, `robots.txt`. |
| `.github/workflows/deploy.yml` | Instructions GitHub follows to test, build, and publish. |
| `dist/` | The finished website. Made fresh on every build and never saved in the repo. |
| `ADMIN.md` | The guide for people who update events. |

The only outside library is `gray-matter`, which reads the header at the top of each note.

## From note to page

### 1. A note

Each note has a header between two `---` lines (title, type, date, times, place, status), a short public message, and an optional `## Tasks` list. The format is plain text, so it can be edited on GitHub's website or in any text editor.

### 2. Checking

`build.js` reads every note in `content/meetings/` and checks it before anything is built:

- `title`, `type` and `date` are present, and the type and status are on the allowed lists. Unknown header lines (usually typos) are rejected.
- Dates are real calendar days, and `end_date` isn't before `date`.
- Times are 24-hour times like `19:00`.
- The file name starts with the same date as the `date` line.
- Every line under `## Tasks` is a proper task, patrol tags match `site.config.json`, and due dates are real.
- **Privacy guard:** anything that looks like an email address or US phone number stops the build, unless it's listed in `allowedContacts`.

It also checks `site.config.json`: an accessibility email must be listed in `allowedContacts`, which records that the Scoutmaster approved it.

Two quirks of the header format are handled on purpose. The format quietly turns `2026-02-30` into March 2, and an unquoted `19:00` into the number 1140. So dates and times are both read from the text as typed, with or without quotes, and dates are checked against the real calendar.

All problems are collected and printed together, each naming the file and the problem in plain words.

### 3. Working out dates

Dates are kept as `YYYY-MM-DD` text throughout. The program never asks JavaScript to read a bare date, because it would treat it as midnight in London, which is the previous evening in New York.

- **Today** is today's date in New York (from `timeZone` in `site.config.json`), no matter where the build runs. GitHub's machines run on UTC.
- An event is **Upcoming** through the end of its last day (`end_date`, or `date`), New York time. After that it's **Past**.
- A past event is **Cancelled** if its status says so, otherwise **Held**. Nobody types "held".
- **"In N days"** counts calendar days, so daylight saving changes can't shift it. A multi-day event that has started shows "Happening now".
- The home page **To do** list is every open task from upcoming events that aren't cancelled, sorted by due date, with undated tasks last.

### 4. Writing pages

The same file then writes plain HTML into `dist/`:

- `index.html`: the intro, Next up (the first upcoming event that isn't cancelled), To do, Coming up grouped by month, and the Accessibility note.
- `past.html`: past events, newest first, each marked Held or Cancelled.
- `events/<file name>.html`: one page per event.
- `about.html`: the privacy, accessibility, and schedule-changes statements.
- `404.html`: shown by GitHub for any address that doesn't exist.
- `sitemap.xml`: the list of pages for search engines.

Every piece of note text is escaped before it goes into a page, so a stray `<` can't break the layout. Links between pages are relative (`../style.css` from an event page), because the site lives in a sub-folder, `/troop-45/`. The 404 page is the exception: GitHub serves it at any depth, so its links start from `/troop-45/`. Canonical links, the sitemap, and social preview tags use the full address from `baseUrl`.

The pages contain no JavaScript at all. The styling is one hand-written stylesheet, and the fonts are stored on the site itself, so visiting sends nothing to any other company. That's what lets the About page truthfully say there are no cookies, analytics, or third-party requests.

## The editing form

`/troop-45/admin/` is a second way to edit, for admins who'd rather fill in boxes than edit text. It is Sveltia CMS, a ready-made editor that runs entirely in the browser:

- The build writes `admin/index.html` (which loads Sveltia CMS, pinned to one version) and `admin/config.yml` (which describes the fields). The config is generated from `site.config.json`, so the patrol list and event types always match what the checks accept.
- An admin signs in by pasting their own GitHub token, which only allows writing to this one repo. The form then reads and writes `content/meetings/` through GitHub's API. Each save is an ordinary commit under the admin's own account, so it triggers the same checks and the same deploy as any other edit.
- The form saves tasks as a `tasks:` list in the header, not as `## Tasks` lines. The build accepts both, so hand-written and form-made notes can be mixed.
- New files are named from the event's own date and title. Moving an event to another date needs a rename in the form's Slug panel; otherwise the check stops the update and says so.
- Sveltia insists on an upload folder. It's `content/uploads`, which is never published, and any file there stops the build, because photos are never allowed and the repo is public.

The admin page needs JavaScript and is marked `noindex` and left out of the sitemap. It loads the editor from unpkg.com, so unlike the public pages, it does contact another company's server.

## Build and deploy

The workflow in `.github/workflows/deploy.yml` runs:

- on every change pushed to `main` (including edits made on GitHub's website);
- when someone presses **Run workflow** on the Actions page;
- once a day, so Upcoming, Past and "in N days" stay correct without anyone editing.

It has two jobs. **build** installs the library, runs the tests, runs `npm run build`, and uploads `dist/`. **deploy** publishes that upload to GitHub Pages, and runs only if every build step passed.

## When a note is wrong

The build stops with a message such as:

```
2026-10-27-troop-meeting.md: start must be a 24-hour time like 19:00 (got 7pm).
```

On GitHub, the run turns red, the same message appears on the run's summary page under **Site not updated**, and the deploy job is skipped. The live site keeps showing the last good version. This was tested on the real site on 2026-10-12 with a deliberately broken note (an unquoted time, which was an error then), and the note was then reverted. `ADMIN.md` lists every message and its fix.

Because every edit is a Git commit, the repo also keeps a permanent public record of who changed what and when. Mistakes are fixed with a new edit, never by rewriting history.

## Failure modes and limits

| Risk | What happens | What to do |
|---|---|---|
| **The daily rebuild runs late** | It's scheduled for 05:10 UTC (just after midnight in New York), but GitHub delays scheduled runs when it's busy. On 2026-10-12 it ran about 8 hours late. Until it runs, the site can show yesterday's "Upcoming" and "in N days". | Usually nothing. If it matters on a given day, press Run workflow. |
| **The daily rebuild pauses** | GitHub pauses scheduled workflows in a public repo after about 60 days with no activity. The site stays up but stops moving events to Past. | Make any edit, or re-enable the workflow on the Actions page. |
| **One owner** | If the only owner loses access, nobody can change settings or add admins. | Keep at least two organization owners, and give the Scoutmaster recovery details (see `ADMIN.md`). |
| **GitHub dependency** | The site, the history, the editing, and the build all live on GitHub. If GitHub Pages ends or changes its free terms, the site goes down. | The notes are plain text and the build is one script, so moving to another static host is small. Printed flyers with the old address would need replacing. |
| **Build machine changes** | The workflow uses `ubuntu-latest` and Node 24, which GitHub updates over time (Ubuntu 26 from 2026-10-19). | The build uses only basic Node features. If a run fails after an update, the log says why. |
| **Editing form breaks or changes** | Sveltia CMS is beta software (version 0.x). A future version could change how it saves files, and tokens expire after at most a year. | The version is pinned, so nothing changes until someone upgrades it on purpose. If the form fails, edit on GitHub's website instead (`ADMIN.md`). |
| **Address only on GitHub** | There's no short link or own domain. The bare `troop45-thegoats.github.io/` shows GitHub's 404 page; only `/troop-45/` is the site. | Always share the full address. |
| **`robots.txt` location** | Search engines only read `robots.txt` at the domain root, not inside `/troop-45/`. With nothing at the root, crawling is allowed anyway. | Submit `sitemap.xml` in Google Search Console if search listing matters. |
| **The privacy guard is a pattern match** | It catches emails and common US phone formats, not names, addresses, or photos. | Admins follow rule 1 themselves. Review notes before committing. |

## Extending it

All changes go through `scripts/build.js` (and tests in `build.test.js`). Run `npm test`, then `npm run build:samples`, then `python3 -m http.server --directory dist` to check locally before pushing.

- **A new patrol:** add its exact name to `patrols` in `site.config.json`.
- **A new event type:** add it to `TYPES` and `TYPE_LABELS` in `build.js`, and update the type list in `ADMIN.md` and the template.
- **A new header field:** add it to `FIELDS`, read it in `parseNote`, show it in `eventPage`, and add a test.
- **Planned polish (Phase 5):** a calendar file people can subscribe to (`troop.ics`), a print stylesheet, event data for search engines (JSON-LD), and a check that flags silent edits to past events.
- **Upgrading the editing form:** change `CMS_VERSION` in `build.js` to a newer Sveltia CMS release that has been out at least two weeks, read its release notes for breaking changes, and try the form after deploying.

Anything that needs a server, a database, or accounts is a deliberate rewrite of the project's hard rules, agreed with the Scoutmaster first, and it would use Supabase only, with adult accounts only.
