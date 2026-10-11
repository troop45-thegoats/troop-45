# Troop 45 Schedule Site

> Project instructions for Claude Code. Read this fully at the start of every session.
> Keep the checkboxes in "Plan" current as work completes.

## What this is

A public, searchable website showing Troop 45's schedule: upcoming meetings, campouts, PLC meetings, a to-do list for each event, and past meetings as a record. Built for scouts, parents, and the general public, mostly on phones. No logins, no accounts.

The job right now is to build it and ship it. Learning is deferred. Once it is live, I want a written analysis of how the site works (see Phase 4, `HOW-IT-WORKS.md`), so keep the code small and readable, with comments that say why.

## How to work with me (build mode)

- Build in the plan's order. Don't wait for me between steps inside a phase. At the end of each phase: what you built, how to run it, what to check.
- Keep explanations short. When something breaks, fix it and say in one line what was wrong.
- Pre-approved dependency: `gray-matter` (reads the header of a note). Ask before adding anything else, deleting files, running destructive commands, or pushing to GitHub.
- No framework, no bundler, no TypeScript, no Docker, no browser-automation test suites. My computer is low on memory, so keep tooling to Node, git, and a static file server. Tests use Node's built-in `node --test`.
- Prefer boring, widely used tools and the smallest design that works. Don't build features that aren't in the plan.
- If something I ask for is a bad idea or out of scope, say so plainly.

## Hard rules

1. **No scout names, photos, nicknames, phone numbers, emails, or home addresses anywhere in this repo.** Not in content, examples, commits, or test data. Use placeholders like "Scout A". The repo is public.
2. No adult leader contact info unless my Scoutmaster approves it. Default to "contact the Scoutmaster."
3. Static only: no server, no database, no user accounts. v1 uses no Supabase and no Render, and is fully operational without them. If a feature seems to need a backend, stop and discuss. Any backend means Supabase only, adult accounts only (never scouts), and a deliberate rewrite of rules 1 and 3 agreed with my Scoutmaster first.
4. Meeting data lives only as Markdown files in `content/meetings/`. Code never hard-codes real meetings. Notes are plain text, editable in any text editor or on GitHub's website. Nothing depends on Obsidian.
5. Pages are generated as plain HTML at build time. They must read correctly without JavaScript.
6. Design for a ~375px-wide phone first, then widen.
7. Accessibility basics: semantic HTML, readable color contrast, never convey meaning by color alone.
8. Past meetings are not editable through the site. There is no admin UI in v1. Git history is the record of what changed.

## Conventions

- Plain HTML, CSS, and JavaScript, plus one Node build script.
- 2-space indentation. Lowercase-hyphen filenames. Comments explain *why*, not *what*.
- Commit messages in the imperative: "Add past meetings page".
- Times are stored and shown as local troop time. The time zone lives in `site.config.json` and is `America/New_York`.
- Dates are `YYYY-MM-DD` strings. Never pass a date-only string to `new Date()`: JavaScript reads it as UTC and it can show as the previous day. Compare dates as strings or as plain year-month-day parts.
- Escape every piece of note text before putting it in HTML.

## Repo layout

```
troop-45/
├── CLAUDE.md
├── ADMIN.md               # Phase 4: non-technical guide for whoever maintains the site
├── HOW-IT-WORKS.md        # Phase 4: analysis of the site and its mechanisms
├── package.json
├── site.config.json       # troop name, town, meeting place, time zone, patrol names, base URL, allowed contacts
├── .gitignore             # node_modules/, dist/
├── .github/workflows/
│   └── deploy.yml         # Phase 3
├── scripts/
│   ├── build.js           # notes -> validated data -> pages in dist/
│   └── build.test.js
├── content/
│   ├── meetings/          # one .md file per real event, named YYYY-MM-DD-slug.md
│   ├── samples/           # fake events for development only; never deployed
│   └── templates/
│       └── meeting.md     # copy-paste starting point for a new event
├── src/
│   └── static/            # hand-written files copied as-is into dist/
│       ├── style.css
│       ├── favicon.svg
│       ├── og.png         # social preview card: troop name only, no photos
│       ├── robots.txt
│       └── fonts/         # self-hosted, no third-party requests
└── dist/                  # generated and gitignored: index, past, events/, about, 404, sitemap
```

## Meeting file format

```markdown
---
title: Fall Campout
type: campout          # meeting | campout | camp | plc | court-of-honor | service | other
date: 2026-10-18
end_date: 2026-10-19   # optional, multi-day events
start: "19:00"         # optional, 24h local time, quoted
end: "20:30"           # optional, quoted
location: Venue name
status: scheduled      # optional; scheduled | cancelled. Default: scheduled
---
Short public-safe note (what to bring, where to meet). No names.

## Tasks
- [ ] Return signed permission slip (due 2026-10-08)
- [ ] [Patrol A] Plan Saturday dinner menu (due 2026-10-07)
```

"Held" is never typed. A past event that isn't cancelled is shown as Held automatically.

`camp` is a sleepaway camp. It is usually multi-day (`end_date`) and its `location` can be a different camp each year. Every event carries its own `location`, so nothing about the troop's regular meeting place is hard-coded into events.

### Task rules

- Tasks live under a `## Tasks` heading inside the note, one checkbox line each.
- A patrol tag such as `[Patrol A]` is optional and must match a patrol name in `site.config.json`. No tag means Everyone. A task is never assigned to a person by name.
- `(due YYYY-MM-DD)` is optional. A malformed date is a build error.
- `[x]` means done: it leaves the home page To do list but stays in the note.
- The home To do list is the open tasks from upcoming events, sorted by due date, undated last.

### Build validation (the build fails with a plain message, and nothing deploys)

- Required: `title`, `type`, `date`. Type and status must be from the allowed lists.
- `date` and `end_date` are real calendar dates, and `end_date` is not before `date`.
- `start` and `end` are quoted `HH:MM` strings. An unquoted time can be read as a number.
- The filename starts with the same date as the `date` field.
- Task lines parse, and patrol tags are known.
- Privacy guard: fail if any note contains something that looks like an email address or phone number, unless it is listed in `site.config.json` under `allowedContacts`. The troop's accessibility email address goes there once the Scoutmaster approves it.

### Upcoming versus past

An event is Upcoming until the end of its last date (`end_date`, or `date`), in the configured time zone. After that it is Past: Held, or Cancelled if its status says so. Empty lists show a plain message ("Nothing scheduled yet.").

## Design (proposed UI)

Reference canvas: https://claude.ai/artifact/5v4zofk7wcYwfiCfbqJpoK (phone home, event detail, past meetings, desktop home, admin flow, about page). You may not be able to open it, so the essentials are here.

- **Home:** header with troop name, Upcoming and Past tabs, a "Next up" card, a To do list, then "Coming up" grouped by month, then a short Accessibility section.
- **Event detail:** one page per event. Title, type and status on one line, when, where, notes, to do.
- **Past:** newest first, each marked Held or Cancelled. Cancelled titles are struck through and also labelled in text.
- **Desktop home:** same content, with To do moved into a sidebar.
- **Home accessibility section:** two sentences stating the mission, linking to the full report on About.
- **About:** privacy, accessibility, and schedule-change statements, linked from every footer. The accessibility contact line reads: tell the Scoutmaster in person at any meeting, or email the troop address, with a reply timeframe. The Next up card has no label or badge above its headline: "Next up" is a heading outside the card, and the event type sits on a line below the title.
- **Colors (from the troop's neon sign):** near-black `#0C1410` for the header, the Next up card, and heading and body text on light surfaces. Neon green `#15E7B6` only on near-black surfaces (the Troop 45 wordmark, small highlights, the desktop nav underline). Deep green `#087558` on light surfaces (links, due dates, active tab underline). Ground `#F4F6F1`, surface `#FFFFFF`, pale green `#E3EBE1` (audience chips), line `#D9E0D5`, muted text `#566A5E` (light surfaces only).
- **Brand color rules:** neon green on a light surface fails contrast (about 1.5 to 1), so never use it for text or thin lines on light. Long reading stays on the light ground, because bright light-on-dark text is harder to read for many people. No glow, text-shadow, gradient, or animation that imitates a neon tube. The sign's script lettering is not reproduced: the wordmark is plain Big Shoulders Display text. There is no emblem and none should be invented.
- **Contrast checked (WCAG ratios):** neon on near-black 11.7, near-black on ground 17.2, deep green on ground 5.2 and on white 5.7, muted on ground 5.3. Re-check with a tool once the real CSS exists.
- **Fonts:** Big Shoulders Display for headings and dates, Libre Franklin for body text.
- **Rules:** event types are text pills (Meeting, Campout, Camp, PLC, Court of Honor, Service), never color alone. Touch targets at least 44px. Every page shows a "Last updated" date taken from build time. Include a skip-to-content link and visible focus outlines.

### Avoid the "vibecoded" look

Check every page against these before calling it done. Each is a tell of generic AI-built sites.

- No purple-to-blue gradients, gradient hero text, grain over a gradient, or glassmorphism cards.
- No emojis in headings. No Lucide-style icons on everything: icons only where they carry meaning (time, place, back).
- No Inter, Space Grotesk, or Instrument Serif. Use the fonts above. No serif italic accents.
- No colored-border cards, no row of three icon boxes, no badge or label sitting above a headline.
- No fade-in on scroll, no cursor-following effects, no buttons that fade on hover (use a clear color or underline change).
- No em dashes in copy. No generic buzzword copy: say the actual date, place, and thing to bring.
- One spacing scale only: 4, 8, 12, 16, 24, 32, 48 px. The mockup canvas is not strictly on this scale, so enforce it in the real CSS.
- Dark mode, if ever added, must pass the same contrast checks.

### Self-hosted fonts

Big Shoulders Display and Libre Franklin are open-licensed. Download the font files into `src/static/fonts/` (the Google Fonts GitHub repository hosts them) and load them with `@font-face`. Don't load fonts from Google's servers: that sends every visitor's address to a third party and contradicts the privacy statement.

## Deployment decision

GitHub Pages, deployed by a GitHub Actions workflow. Pages can publish a branch's root or `/docs` directly, but this site is generated, so the workflow builds it and publishes `dist/`. The repo's Pages source setting must be "GitHub Actions". Vercel is a later option only if a feature needs functions that hold secrets. Supabase and Render are not part of v1.

The workflow runs on every push to `main`, on a manual trigger, and on a daily schedule. The schedule keeps "Upcoming", "Past", and "in N days" correct without anyone editing. GitHub may pause scheduled workflows in a public repo after about 60 days with no repo activity, and any edit resets that. Note this in `HOW-IT-WORKS.md`.

Jobs: `build` (install, test, build, upload `dist/`), then `deploy` (needs `build`). A failed test or failed validation means nothing deploys and the live site is untouched.

## How edits are handled (admins)

Admins are the people added as collaborators on the GitHub repo. There is no shared password and no admin screen on the site. Each admin uses their own GitHub account with two-factor login on. Admins edit notes on GitHub's website (nothing to install, works on a phone) or in any text editor.

**The path of an edit**
1. An admin edits or creates one note in `content/meetings/` and commits it with a plain message like "Move Oct 14 meeting to the 15th".
2. GitHub runs the tests and the validation. A bad date, an unknown type, or an unquoted time is rejected with a plain message.
3. If the check passes, the site rebuilds and deploys, usually within minutes. If it fails, the old site stays live and the admin sees the error in the repo's Actions tab.
4. The change is recorded permanently: who, when, and exactly what changed.

**Rules**
- One note per event, so two admins rarely touch the same file. Tell the other admin before editing the same event. If GitHub reports a conflict when saving, reload the file and redo the edit.
- Generated files (`dist/`) are never committed.
- Mistakes are fixed by a new edit or by reverting the commit. Never rewrite history.
- Past meetings are corrected by editing the note, never deleted. A cancelled event keeps `status: cancelled`.
- Start with direct pushes by me and one backup admin. If more admins join, or my Scoutmaster wants oversight, turn on branch protection so each change goes through a pull request that a second person approves.

## Address and short link

- The repo is owned by the free GitHub organization `troop45-thegoats`, which I own (decided). The organization keeps my username out of the site address, and I keep my membership in it private. Commits use a neutral author name ("Troop 45 Admin") and my GitHub noreply address, never my personal email. Turn on two-factor login (and require it for organization members). Add the backup admin as an organization member. Write the succession steps in `ADMIN.md`: make the next person an owner of the organization. Because the organization stays the same, the Pages address does not change on handoff. The Scoutmaster should hold recovery details for the GitHub account and organization.
- Name the repo `troop-45`, so the address is `troop45-thegoats.github.io/troop-45/` and includes the troop name. The site lives in a subpath, so the build must produce correct relative links for every page depth (`events/x.html` needs `../style.css`). Canonical links, the sitemap, and social tags use the absolute `baseUrl` from `site.config.json`.
- The canonical (indexed) address is the GitHub Pages URL, and it is the only address. Use it on flyers and QR codes.
- No short link and no purchased domain for v1 (decided: a TinyURL was considered and dropped as unnecessary).
- If the site ever moves hosts or gets a domain, printed flyers and QR codes with the old address will need replacing.

## Being found (the site is searchable)

- Pages are real HTML generated at build time, one per event, so search engines can read and list each event.
- `robots.txt` allows crawling and points to `sitemap.xml`. The build writes `sitemap.xml` listing the home page, past page, every event page, and `about.html`.
- Every page gets a unique `<title>` with "Troop 45" and the town, a meta description with real details (meeting day and place), a canonical link, and social preview tags. Town is Winfield and the meeting place is Mary St (see Decided). The meeting day is still a placeholder.
- Never put scout names, photos, or personal contact details in titles, descriptions, or alt text. Search engines keep copies, so a mistake is hard to take back.
- Optional in Phase 5: Event structured data (JSON-LD) generated from the notes so search engines can show upcoming events. Check Google's current event guidelines first.
- Optional: register the site in Google Search Console and submit the sitemap, using an account I control.

## Launch checklist (before announcing the site)

Run these in Phases 3 and 4. Check each one.

- [ ] No sample data in `content/meetings/`, and real events entered.
- [ ] Privacy and accessibility page (`about.html`) published, with every [placeholder] filled in. Claims on it must be true: no cookies, no analytics, no third-party requests.
- [ ] HTTPS enforced (the "Enforce HTTPS" setting on GitHub Pages).
- [ ] Unique title and meta description on every page.
- [ ] Social preview image (`og.png`) with Open Graph tags. Troop name only, no photos.
- [ ] Favicon.
- [ ] `robots.txt` allowing crawling and a `sitemap.xml`, both reachable at the site root.
- [ ] Canonical link on every page, pointing at the GitHub Pages address.
- [x] ~~TinyURL created~~ Dropped: no short link for v1.
- [ ] Alt text on any informative image. Decorative images get empty alt. No photos of scouts.
- [ ] Images compressed (there should be almost none).
- [ ] Lighthouse page-speed check passes on phone settings (Chrome DevTools has it built in).
- [ ] Color contrast checked with a tool, not just by eye: normal text 4.5:1 or better.
- [ ] Mobile layout checked at 375px on a real phone.
- [ ] Custom 404 page.
- [ ] Broken links checked.
- [ ] One clear call to action per page. Home: open the next event.
- [ ] Accessibility tests: keyboard-only walkthrough, VoiceOver pass, and an axe or Lighthouse accessibility audit. Fix what they find before publishing the statement.
- [ ] A deliberately bad note leaves the live site untouched and shows a clear error.

Deliberately skipped for v1, with reasons:
- Terms and conditions page: nothing to agree to. The "Schedule changes" note on `about.html` covers the one real disclaimer.
- Cookie consent banner: no cookies are set. Revisit only if a tracker or login is ever added.
- Secrets off the frontend: no secrets exist. This matters the day a backend appears.
- Form validation and spam protection: no forms exist.
- Analytics: skipped to keep the privacy statement simple. If wanted later, use a cookieless counter and update `about.html`.

## Plan

### Phase 0: Setup
- [ ] Node and git installed. Git email set to my GitHub noreply address.
- [ ] Public repo `troop-45` under the `troop45-thegoats` organization, two-factor login on, Pages source set to "GitHub Actions"
- [x] Folder structure above created, `.gitignore` in place, `site.config.json` with the known values (time zone, town, meeting place) and placeholders for the rest
- [x] First commit pushed

### Phase 1: Content model and build script
- [x] `package.json` (scripts: `build`, `build:samples`, `test`) with `gray-matter` as the only dependency
- [x] `scripts/build.js` reads notes, validates them (see Build validation), parses tasks, and derives Upcoming, Past, Held, Cancelled, and "in N days" in the configured time zone
- [x] `scripts/build.test.js` using `node --test`: task parsing, date handling, upcoming versus past at day boundaries, each validation error
- [x] Five or more fake notes in `content/samples/` covering a meeting, a multi-day campout, a PLC, a cancelled event, and tasks with and without patrol tags and due dates
- [x] `content/templates/meeting.md`

**Done when:** `npm test` passes and a broken note produces one clear error message that names the file and the problem.

### Phase 2: Pages and styling
- [x] The build writes `index.html`, `past.html`, one page per event under `events/`, `about.html`, `404.html`, and `sitemap.xml` into `dist/`, using template functions in `build.js`
- [x] `src/static/style.css` implements the Design section, phone first, with the spacing scale and self-hosted fonts
- [x] Meta tags, canonical links, skip link, and focus styles on every page
- [x] Empty states for no upcoming events and no past events
- [x] Relative links correct at every page depth

**Done when:** `npm run build:samples`, then `python3 -m http.server --directory dist`, shows a site that matches the design at 375px and 1200px with JavaScript turned off.

### Phase 3: Deploy
- [x] `.github/workflows/deploy.yml`: build job then deploy job, triggers on push, manual, and a daily schedule
- [x] Site live at `https://troop45-thegoats.github.io/troop-45/` with HTTPS enforced
- [x] Favicon, social preview image, `robots.txt` in place
- [x] ~~TinyURL created and tested~~ Dropped: no short link for v1.

**Done when:** pushing a valid change publishes it within minutes, and pushing an invalid note leaves the live site untouched with a readable error.

### Phase 4: Launch and handoff
- [ ] Launch checklist complete
- [ ] `ADMIN.md`: how to add or change an event on GitHub's website with the copy-paste template, what the errors mean, who has repo access, who the backup admin is, succession steps
- [ ] A second person has repo access as a collaborator
- [ ] Decision recorded: direct push or pull-request approval
- [ ] `HOW-IT-WORKS.md`: a plain-language analysis of the finished site. Cover the data flow from note to published page, what each file does, the build and deploy pipeline, how upcoming and past are decided, what happens when a note is wrong, the failure modes and their limits (daily schedule pausing, one-owner risk), and how to extend it

**Done when:** someone else could follow `ADMIN.md` without me, and `HOW-IT-WORKS.md` explains every moving part.

### Phase 5: Polish (optional, in this order)
- [ ] Calendar subscription: the build writes `dist/troop.ics` so people can subscribe from their phone calendar
- [ ] Print stylesheet: a one-page schedule for the meeting room wall
- [ ] Event structured data (JSON-LD)
- [ ] Past-meeting guard: a workflow step fails when a commit changes the note of a past meeting unless the commit message contains "[correction]", so silent rewrites of the record become visible

### Phase 6: Admin form (optional, only after the site is live and I decide)
A browser form for adding events, for admins who are not comfortable with GitHub. A git-based CMS form (Decap or Sveltia CMS) at `/admin` saves the same Markdown notes. Check each project's current sign-in options first: any option that needs a small server conflicts with hard rule 3. Notes would need tasks as a structured list in the header, so the build would accept both formats.

## Out of scope for v1

Logins or an admin panel, attendance, RSVPs, scout names or photos, tasks assigned to individual scouts (tasks are for Everyone or a patrol), per-patrol pages, comments, tracking of individuals. Role and tenure tracking needs scout names, so it would need a separate private system, not this public site.

## Decided

- **Build mode:** learning is deferred. A written analysis comes after launch (Phase 4).
- **No Obsidian:** my computer may not handle it. Notes are plain Markdown, edited on GitHub's website or in any text editor. Obsidian could open `content/` later with no changes.
- **Searchable:** yes. The site is public and meant to be found. The repo is public too, and holds nothing private by design.
- **Audience:** the general public, not only scouts and parents. The home page must make sense to someone who has never heard of the troop.
- **Address:** no purchased domain and no short link for now. The GitHub Pages address is the only address.
- **Identity:** no emblem. The troop's symbol is a neon-green script "Troop 45" sign. Don't reproduce or redraw it. Use its colors only as set out in Design.
- **Approval:** none needed from the chartering organization or council. Still don't use the Scouting America emblem or logos.
- **Ownership:** the `troop45-thegoats` GitHub organization owns the repo, and I own the organization.
- **Accessibility reports:** go to the Scoutmaster, in person at a meeting or by email to a dedicated troop Gmail address. The address itself is still needed (see below).
- **Time zone:** `America/New_York`.
- **Town and meeting place:** Winfield, New York; the regular meeting place is Mary St, as given. Events can be elsewhere, including sleepaway camps that rotate, so `location` is per event.
- **Backup admin:** I will decide before Phase 4. Until then `ADMIN.md` keeps a placeholder.
- **Accessibility:** a short Accessibility section on the home page states the mission and links to the full report on `about.html`.

## Still open (ask me; don't assume)

1. Does the troop already have a site or Scoutbook calendar this would duplicate? Does my Scoutmaster know about this?
2. The accessibility email address. Use a dedicated troop Gmail address, not a personal one, because it will be published on a public, searchable page. The Scoutmaster approves it before it is published (hard rule 2) and holds its password and recovery details. Also the reply timeframe to state on the About page.
3. The site serves the public, so should it say how to visit or join? That needs a contact channel, which has the same approval rule.
4. The regular meeting day. Whether "Mary St" means Street or Saint, and the exact wording to publish for the meeting place. Whether the venue's owner is fine with it being published.
5. Which meeting types and fields does the troop actually use?
