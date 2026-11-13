// The Guide (Robin chose the one-page home, 2026-11-04). Organised around what people
// want to do: Start here, Your rhythm, How do I..., Every tool. An answer is short and
// its button goes to the real place, reusing that place's existing data-attribute.
// Loaded after app.js; everything here runs at call time.
const GUIDE_ANSWERS = {
  'set-down': { title: 'Set something down', lead: "Get it out of your head in a few seconds. Kaya works out what it is and where it goes.", go: ['Try it now', 'data-cap-open'], steps: [
    '<b>Open it from anywhere.</b> Press <kbd>⌘.</kbd> or the Set something down bar. On a phone, tap the gold <b>+</b> at the bottom.',
    '<b>Write it as you\'d say it,</b> or tap Speak. For example, "Dentist Tuesday at 9am" or "Ring Mum tomorrow".',
    '<b>Check what it understood.</b> It shows whether it\'s an event, a task or a note, with the day and any Space. Tap anything that\'s wrong.',
    '<b>Set it down.</b> Press Return and carry on with your day.',
  ], next: ['notepad', 'find', 'spaces'] },
  notepad: { title: 'Keep a Notepad', lead: 'One running page for rough thoughts, always exactly as you left it.', go: ['Open the Notepad', 'data-notepad-open'], steps: [
    'Press <kbd>⌘J</kbd>, or choose <b>Notepad</b> in the top bar or the Menu.',
    'Write as much or as little as you like. It saves as you go.',
    'To keep a line, choose <b>Make it a note</b> or <b>Make it a task</b>.',
  ], next: ['set-down', 'note-start'] },
  find: { title: 'Find anything', lead: 'Search reaches your notes, tasks, people, events and more from wherever you are.', go: ['Open Search', 'data-palette'], steps: [
    'Press <kbd>⌘K</kbd>, or choose <b>Search</b>. On a phone it\'s at the bottom right.',
    'Type a few words, then choose a result to go straight there.',
  ], next: ['set-down', 'linked'] },
  'side-by-side': { title: 'Work with two things side by side', lead: 'Keep one thing open while you work on another - an email beside a note, your calendar beside your tasks. A second pane opens alongside the page you\'re on, and you set how much room each side gets.', go: ['Open Split', 'data-split-open'], steps: [
    'On a computer, choose <b>Split</b> in the top bar. A second pane opens beside the page you\'re on.',
    'Search for what to show there - a tool, a note, a task, a Space or an email - and choose it.',
    'Drag the divider in the middle to give either side more room.',
    'A quicker way in: <b>shift-click</b> almost anything to open it in the pane beside you.',
    'Choose <b>Split</b> again to close the second pane and go back to one page.',
  ], note: 'Side by side is a desktop view - there\'s the room for two things at once there.', next: ['linked', 'mail-action'] },
  linked: { title: 'Link things together', lead: 'A note, task or person can be joined to whatever belongs with it, so it\'s all a click away.', go: ['Open Notes', 'data-open-notes'], steps: [
    'Open a note or a task, and find <b>Linked &amp; attached</b>.',
    'Type in the search box to link a page, person, task or event.',
    'Add a <b>Web link</b> or <b>Attach file</b> from the buttons beneath it. A note can also start a <b>New task</b> from there.',
    'Hover over a row and press <b>✕</b> to remove it. Removing a link leaves the thing itself. Removing an attached file deletes the file.',
  ], next: ['note-start', 'task-add'] },

  calendar: { title: 'Bring in your calendar', lead: 'Your Kaya account has its own beautiful calendar. You don\'t need to sync it with a third-party calendar tool - but if you\'d like to bring in Google, iCloud or Yahoo, you can.', go: ['Connect a calendar', 'data-onb-open-hub="calendar"'], steps: [
    'Choose <b>Connect a calendar</b> above, then pick your provider.',
    'Follow the steps to sign in, or to add an app password for iCloud and Yahoo.',
    'Your events appear on your Calendar and on Today.',
  ], next: ['event-add', 'holidays', 'email'] },
  'event-add': { title: 'Add an event', lead: 'The quickest way is to write it as you\'d say it.', go: ['Open Calendar', 'data-open-calendar'], steps: [
    'Set it down with <kbd>⌘.</kbd> and a day and time, such as "Lunch with Ana Friday at 1".',
    'Or open <b>Calendar</b> and add it there, where you can also make it repeat.',
      ], next: ['set-down', 'holidays'] },
  holidays: { title: 'Add holidays and sport', lead: 'Show your country\'s public holidays and your team\'s fixtures on your calendar.', go: ['Open the settings', 'data-guide-settings="feeds"'], steps: [
    'Choose <b>Open the settings</b> above, to go to the calendar section.',
    'Search for a country or a team, and choose it.',
    'Press <b>×</b> whenever you want it gone. These are read-only.',
  ], next: ['calendar', 'event-add'] },
  email: { title: 'Bring in your email', lead: 'Your mail stays where it lives. Kaya is a better place to work with it.', go: ['Connect your email', 'data-onb-open-hub="email"'], steps: [
    'Choose <b>Connect your email</b> above, and pick your provider: Gmail, Outlook, iCloud, Yahoo or another.',
    'Enter your address and password. Gmail, iCloud and Yahoo need an <a class="g-inline" data-help-open="app-password">app password</a>, not your everyday one.',
    'Add as many mailboxes as you like. They all merge into one inbox.',
  ], next: ['app-password', 'mail-sort', 'mail-action'] },
  'app-password': { title: 'Make an app password', lead: 'A separate password just for Kaya, which your email provider gives you.', steps: [
    '<b>Gmail or Google Workspace:</b> turn on <a class="g-link" href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener">2-Step Verification</a>, then make one at <a class="g-link" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Google App passwords</a>. On Workspace, your admin must have IMAP turned on.',
    '<b>iCloud:</b> make one at <a class="g-link" href="https://appleid.apple.com" target="_blank" rel="noopener">appleid.apple.com</a>, under Sign-In and Security.',
    '<b>Yahoo:</b> make one in your Yahoo Account Security settings.',
    '<b>Outlook and most others:</b> your normal password usually works. If you use two-factor, make an app password in that account\'s security settings.',
  ], note: 'If your Google password changes, Google cancels the app password, so just make a new one.', next: ['email'] },
  'mail-sort': { title: 'Sort your inbox', lead: 'New mail arrives in the Inbox. Sort each one, and the Inbox empties.', go: ['Open Mail', 'data-open-mail'], steps: [
    'Open an email. Under <b>Move to</b>, choose <b>Urgent</b>, <b>Important</b>, <b>Later</b> or <b>Archive</b>.',
    'On a keyboard, press <kbd>U</kbd>, <kbd>I</kbd>, <kbd>L</kbd> or <kbd>A</kbd>. Sorting from the Inbox moves you on to the next email.',
    'Tap a pile along the top to see only that one.',
  ], next: ['mail-action', 'email'] },
  'mail-action': { title: 'Turn an email into a task, note or event', lead: 'An email is often really something to do or remember.', go: ['Open Mail', 'data-open-mail'], steps: [
    'Open the email.',
    'Under <b>Tools</b>, choose to make a task or a note, or <b>Add event</b>, which uses AI.',
    'Check the details and save. A task or note keeps a copy of the email.',
    'If the email is a calendar invitation, Kaya offers to add it to your calendar.',
  ], next: ['mail-sort', 'task-add'] },
  'keep-in-touch': { title: 'Keep in touch with someone', lead: 'A gentle nudge when it\'s been too long, measured from when you last actually spoke.', go: ['Open Contacts', 'data-open-contacts'], steps: [
    'Open a contact and turn on <b>Keep in touch</b>.',
    'Choose how often you\'d like to speak.',
    'They appear in <b>Keep in touch</b> on Today when it\'s been that long. Tick them, and the clock starts again.',
  ], next: ['connect', 'invite'] },
  connect: { title: 'Connect with someone on Kaya', lead: 'Connecting is what opens up sharing. Nothing of yours is shared until you choose it.', go: ['Open Contacts', 'data-open-contacts'], steps: [
    'Open <b>Contacts</b>. Kaya shows which of your people are already here.',
    'Choose <b>Connect</b>, or add someone by name or email. They need to accept.',
    'Once connected, you can share a Space, a note or a task, and send messages.',
  ], next: ['share-space', 'invite'] },
  invite: { title: 'Invite a friend', lead: 'Put in their email and a note, and we send the invitation.', go: ['Invite someone', 'data-create-invite'], steps: [
    'Choose <b>Invite someone</b> above.',
    'Add their email and, if you like, a note from you.',
    'You can also give them six months of Premium, free. You have up to ten of these to give.',
  ], next: ['connect', 'share-space'] },

  'task-add': { title: 'Add and manage tasks', lead: 'Every task has a priority: First, Soon or Whenever.', go: ['Open Tasks', 'data-view-tasks'], steps: [
    'Set one down with <kbd>⌘.</kbd>, or use the quick add on <b>Tasks</b>.',
    'Keep <b>First</b> for what truly matters. Those are what surface on Today and in your morning brief.',
    'Open a task to give it a date, a Space, notes or links.',
    'Tick it anywhere, and it\'s done everywhere.',
  ], next: ['flow', 'linked', 'set-down'] },
  flow: { title: 'Plan your day in the Day Planner', lead: 'Drag your practices and tasks onto a timed day. It\'s a plan to work from, never a timetable to obey.', go: ['Open Day Planner', 'data-open-today'], steps: [
    'Open the <b>Day Planner</b> from Plans.',
    'Drag a task or a timed practice onto the day.',
    'Tick each one as you do it. Ticking a practice counts towards it too.',
  ], next: ['practices', 'task-add'] },
  practices: { title: 'Keep up a practice', lead: 'The things you do again and again, with no alarms and no guilt.', go: ['Open Tracker', 'data-open-practices'], steps: [
    'Open the <b>Tracker</b> from Plans, and add one.',
    'Give it a Space and, if you like, an aim such as every other day.',
    'Tick it when you\'ve done it. A timed practice can also be dragged onto your day in the Day Planner.',
  ], next: ['flow', 'review'] },
  goals: { title: 'Set a goal', lead: 'Connect the bigger picture to what you do each day.', go: ['Open Goals', 'data-open-goals'], steps: [
    'Open <b>Goals</b> from Plans, and add one.',
    'Give it a Space and, if you like, a date to finish by.',
    'Add tasks as the steps towards it.',
    'Drag its slider as you go. A goal is achieved when the slider reaches 100%.',
  ], next: ['review', 'task-add'] },
  review: { title: 'Do your weekly review', lead: 'A few minutes to see where you stand and what comes next.', go: ['Open Weekly reviews', 'data-open-reviewtype="weekly"'], steps: [
    'Open <b>Reviews</b> from Plans, then <b>Weekly</b>.',
    'Choose <b>Begin this review</b>, and go through it at your own pace.',
    'Reflect in words, score each Space out of 5, or both. Then choose <b>Submit this review</b>. Past reviews gather on the same page, so you can see how the weeks have felt.',
  ], note: 'Monthly and quarterly reviews work the same way, over a longer stretch.', next: ['goals', 'practices'] },

  'note-start': { title: 'Write a note', lead: 'For anything you want to write down and find again.', go: ['Open Notes', 'data-open-notes'], steps: [
    'Open <b>Notes</b> from Keep, and start a new one.',
    'Just type. It saves as you go, and headings can fold a long note shut.',
    'Add it to one or more <b>Spaces</b> at the top, so it shows up there.',
  ], next: ['linked', 'table-start', 'spaces'] },
  'table-start': { title: 'Make a table', lead: 'For rows and columns: a reading list, flats to view, anything you\'d keep in a spreadsheet.', go: ['Open Tables', 'data-open-tables'], steps: [
    'Open <b>Tables</b> from Keep, and start a new one.',
    'Name your columns, and add a row at a time.',
  ], next: ['note-start', 'linked'] },
  'read-watch': { title: 'Save something to read or watch', lead: 'One list for everything you mean to get to.', go: ['Open Library', 'data-open-readwatch'], steps: [
    'Open <b>Library</b> from Keep.',
    'Paste a link, or type the title of a book or film. Kaya fills in the details.',
    'Tick it when you\'re through it, and rate it if you like.',
    'To save from anywhere, set up the bookmarklet or iPhone Shortcut from the same page.',
  ], next: ['find', 'spaces'] },
  discover: { title: 'Find local events', lead: 'Follow what\'s on, and add what you like to your calendar.', go: ['Open Local Events', 'data-open-discover'], steps: [
    'Open <b>Local Events</b> from Plans.',
    'Search a city to find what\'s on near you, then browse by day.',
    'Add anything you like the look of to your calendar.',
  ], next: ['event-add', 'calendar'] },

  spaces: { title: 'Shape your Spaces', lead: 'A Space is one part of your life: an area, a project, even a person. Everything to do with it gathers there.', go: ['Open Spaces', 'data-open-areas'], steps: [
    'We\'ve started you off with a few. Rename or remove any that don\'t fit.',
    'Add your own: a house move, a band, the kids.',
    'When you make a task, note or event, add it to a Space, and it shows up there.',
  ], next: ['share-space', 'note-start'] },
  'share-space': { title: 'Share a Space', lead: 'Run a family, a house move or a team from the same place.', go: ['Open Spaces', 'data-open-areas'], steps: [
    'First <a class="g-inline" data-help-open="connect">connect with them</a> on Kaya.',
    'Open the Space, and choose who to share it with.',
    'They can see and edit what\'s in that Space, unless you choose View only, and nothing else of yours. You can stop sharing at any time.',
  ], next: ['connect', 'spaces'] },
  journal: { title: 'Write in your Journal', lead: 'Free-write, or start from a prompt. It\'s private to you.', go: ['Open Journal', 'data-open-journal'], steps: [
    'Open <b>Journal</b> from Reflection.',
    'Write freely, or start from a prompt.',
    'If you\'ve added AI, you can also dictate, and <b>Dig deeper</b> asks one thoughtful follow-up question.',
  ], next: ['review', 'ai'] },
  spending: { title: 'See where your money goes', lead: 'Your statement in, and the shape of the month out, without a spreadsheet.', go: ['Open Money', 'data-open-money'], steps: [
    'Open <b>Spending</b> from Money.',
    'Import a statement as a CSV or PDF. Kaya reads the transactions and sorts them. Reading a PDF uses AI.',
    'Your Spaces double as spending categories, so your money lines up with your life.',
  ], next: ['set-down', 'spaces'] },

  phone: { title: 'Put Kaya on your phone', lead: 'It installs from your browser in a moment, with no app store, and opens full screen like any other app.', installed: 'phone', parts: [
    ['iPhone', [
      'Open <b>koyeba.co</b> in <b>Safari</b> and sign in.',
      'Tap <b>Share</b>, the square with an arrow, at the bottom of the screen.',
      'Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>.',
    ]],
    ['Android', [
      'Open <b>koyeba.co</b> in <b>Chrome</b> and sign in.',
      'Tap the <b>⋮</b> menu at the top right.',
      'Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.',
    ]],
  ], note: 'Open it from your home screen from now on. The +, the Menu and Search sit along the bottom.', next: ['desktop', 'set-down', 'twofa'] },
  desktop: { title: 'Put Kaya on your computer', lead: 'It opens in its own clean window, from your Dock or taskbar, with no browser tabs or address bar.', installed: 'computer', parts: [
    ['Mac, in Safari', [
      'Open <b>koyeba.co</b> in Safari and sign in.',
      'Click <b>Share</b>, the square with an arrow, in the toolbar.',
      'Choose <b>Add to Dock</b>. This needs a recent version of macOS.',
    ]],
    ['Mac or Windows, in Chrome or Edge', [
      'Open <b>koyeba.co</b> and sign in.',
      'Click the <b>install icon</b>, a small screen with a down arrow, at the right-hand end of the address bar.',
      'Click <b>Install</b>.',
      'No icon? In Chrome, open the <b>⋮</b> menu at the top right and look for <b>Install Kaya</b>. Menu wording changes between browser versions, so it may sit under <b>Cast, save and share</b>. In Edge, it is under <b>Apps</b> in the <b>…</b> menu.',
    ]],
  ], note: 'Kaya now lives in your Dock on a Mac, or can be pinned to your taskbar on Windows.', next: ['phone', 'set-down', 'find'] },
  twofa: { title: 'Turn on two-factor sign-in', lead: 'A second step at sign-in, from an authenticator app. It becomes required 90 days after you join.', go: ['Set it up', 'data-onb-open-hub="twofa"'], steps: [
    'Choose <b>Set it up</b> above.',
    'Scan the code with your authenticator app.',
    'Enter the six digits it shows.',
  ], next: ['phone', 'data'] },
  ai: { title: 'Add AI (optional)', lead: 'AI is an optional extra. You can enjoy all the essentials of Kaya without it. If you do add it, a few tools can do a little more, and each has its own switch.', go: ['Open the AI settings', 'data-guide-settings="ai"'], steps: [
    'Choose <b>Open the AI settings</b> above.',
    'On Premium, add your own key from Claude, ChatGPT or Gemini. On Premium Plus, we run it for you, so there\'s no key to add.',
    'Turn off any use you\'d rather it didn\'t make, or switch it all off.',
  ], next: ['data', 'journal'] },
  tools: { title: 'Hide the tools you don\'t use', lead: 'Keep Kaya to what you actually need.', go: ['Open the settings', 'data-guide-settings="sections"'], steps: [
    'Open <b>Settings</b>, then the tools section.',
    'Untick anything you don\'t use.',
    'Nothing is deleted. Turn it back on any time, and it\'s all still there.',
  ], next: ['spaces', 'ai'] },
  import: { title: 'Bring your notes in', lead: 'Move over from Obsidian, Bear, Apple Notes, Notion or anywhere that saves Markdown or plain text.', go: ['Open the settings', 'data-guide-settings="import"'], steps: [
    'Export your notes from the other app as <b>.md</b> or <b>.txt</b> files.',
    'Open <b>Settings</b>, then Import, and choose the files.',
    'Each file becomes a note. A # heading on the first line becomes its title. Otherwise, the filename does.',
  ], next: ['note-start', 'spaces'] },
  data: { title: 'Your data', lead: 'What you put in Kaya is yours. We don\'t sell it, read it or train AI on it.', go: ['Open the settings', 'data-open-settings'], steps: [
    'Your mail stays on your provider\'s servers, and your mailbox passwords are encrypted.',
    'People only ever see exactly what you share with them.',
    'You can take everything with you, or close your account, from <b>Your data</b> in Settings.',
  ], next: ['twofa', 'ai'] },
};
const GUIDE_RHYTHM = [
  { id: 'r-day', title: 'Each day', lead: 'Start on Today. Set things down as they come. Close the day with a line, if you like.', go: ['Go to Today', 'data-view-home'], steps: [
    '<b>Begin on Today.</b> Your day, what\'s next and what\'s coming into view are all there.',
    '<b>Set things down as they come.</b> Press <kbd>⌘.</kbd> or tap <b>+</b>, and get back to what you were doing. Trust that it will come back when you need it.',
    '<b>Sort your mail once or twice,</b> not all day.',
    '<b>Close the day,</b> if you like, with a line in your daily review.',
  ], next: ['set-down', 'mail-sort', 'flow'] },
  { id: 'r-week', title: 'Each week', lead: 'A few minutes with your review, to see where you stand and what comes next.', go: ['Open Weekly reviews', 'data-open-reviewtype="weekly"'], steps: [
    '<b>Look back.</b> See what you did, and how each Space felt.',
    '<b>Choose what matters.</b> Decide what\'s First for the week ahead, and let the rest be.',
    '<b>Look ahead.</b> Glance at your calendar, and make room for what you care about.',
  ], next: ['review', 'task-add', 'practices'] },
  { id: 'r-long', title: 'The longer view', lead: 'Goals, your bucket list and the bigger reviews, for the life you\'re steering towards.', go: ['Open Goals', 'data-open-goals'], steps: [
    '<b>Each month and quarter,</b> take a longer review, and see what has changed.',
    '<b>Keep a few goals in view.</b> Star the ones you want close, and let tasks be the steps towards them.',
    '<b>Keep a bucket list</b> for the things you mean to do one day.',
  ], next: ['goals', 'review', 'spaces'] },
];
GUIDE_RHYTHM.forEach((r) => { GUIDE_ANSWERS[r.id] = r; });
const GUIDE_START = [
  ['set-down', () => !!homeWelcomeSteps().first, 'Show me'],
  ['calendar', () => (state.gcalAccounts || []).length > 0, 'Connect'],
  ['email', () => !!(state.mail && (state.mail.accounts || []).length), 'Connect'],
  ['spaces', () => !!homeWelcomeSteps().spaces, 'Open'],
  ['phone', () => guideInstalled('phone'), 'Show me'],
  ['desktop', () => guideInstalled('computer'), 'Show me'],
];
const GUIDE_HOW = [
  ['Every day', ['set-down', 'find', 'notepad', 'side-by-side', 'linked']],
  ['Mail and people', ['mail-sort', 'mail-action', 'email', 'app-password', 'keep-in-touch', 'connect', 'invite']],
  ['Plans', ['task-add', 'event-add', 'calendar', 'holidays', 'flow', 'practices', 'goals', 'review', 'discover']],
  ['Keep', ['note-start', 'table-start', 'read-watch', 'import']],
  ['Spaces', ['spaces', 'share-space']],
  ['Reflection and Money', ['journal', 'spending']],
  ['Your account', ['phone', 'desktop', 'twofa', 'ai', 'tools', 'data']],
];
const GUIDE_TOOLS = [
  { id: 'tool-spaces', title: 'Spaces', sub: 'Each part of your life', lead: 'A Space gathers one part of your life: its notes and tables, tasks, goals, events, people, links and files. Give each one the people who belong in it.', go: ['Open Spaces', 'data-open-areas'], list: ['spaces', 'share-space'] },
  { id: 'tool-people', title: 'People', sub: 'Mail, Messages, Contacts', lead: 'Everyone who writes to you. Mail brings every inbox into one, Messages is for chatting with people you\'re connected to, and Contacts keeps the people in your life close.', go: ['Open Mail', 'data-open-mail'], list: ['mail-sort', 'mail-action', 'email', 'keep-in-touch', 'connect', 'invite'] },
  { id: 'tool-plans', title: 'Plans', sub: 'Calendar, Tasks, Tracker, Local Events, Day Planner, Goals, Reviews', lead: 'From today to one day. Calendar and Tasks hold what\'s soon, the Day Planner plans the day, Goals and your bucket list look further off, and Reviews look back.', go: ['Open Tasks', 'data-view-tasks'], list: ['task-add', 'event-add', 'flow', 'practices', 'discover', 'goals', 'review'] },
  { id: 'tool-keep', title: 'Keep', sub: 'Notes, Tables, Library', lead: 'Your reference shelf. Notes are for words, Tables for rows and columns, and Library for what you mean to get to.', go: ['Open Notes', 'data-open-notes'], list: ['note-start', 'table-start', 'read-watch', 'linked', 'import'] },
  { id: 'tool-reflection', title: 'Reflection', sub: 'Journal, Dreams, Coaching, Compass, I Ching and more', lead: 'Room for the rest of you. Journal, Dreams and Coaching are places to think, and the other reflection tools offer a different lens when you want one. Those that write back to you use AI.', go: ['Open Reflection', 'data-open-wellbeing'], list: ['journal', 'ai'] },
  { id: 'tool-money', title: 'Money', sub: 'Spending, Investments, Advice', lead: 'What things cost, and what\'s growing. Spending reads your statements, Investments values what you hold, and Advice sums up the finance channels you follow. Advice uses AI, and is general reading rather than personal financial advice.', go: ['Open Money', 'data-open-money'], list: ['spending', 'ai'] },
];
GUIDE_TOOLS.forEach((x) => { GUIDE_ANSWERS[x.id] = x; });
// Old keys still in the wild (tabs saved in a browser, older links).
const GUIDE_OLD_KEYS = { home: 'r-day', today: 'flow', tasks: 'task-add', notes: 'note-start', mail: 'tool-people', contacts: 'tool-people', friends: 'connect', financial: 'tool-money', goals: 'goals', areas: 'tool-spaces', reflect: 'tool-reflection', saved: 'read-watch', settings: 'data', tabs: 'index', timer: 'index' };
// What the Help panel offers, by page.
const GUIDE_HELP_FOR = {
  notes: ['Notes', ['note-start', 'linked', 'spaces']], note: ['Notes', ['note-start', 'linked', 'spaces']], tables: ['Tables', ['table-start', 'linked']], table: ['Tables', ['table-start', 'linked']],
  tasks: ['Tasks', ['task-add', 'flow', 'set-down']], taskcard: ['Tasks', ['task-add', 'linked', 'flow']],
  calendar: ['Calendar', ['event-add', 'calendar', 'holidays']], today: ['Day Planner', ['flow', 'practices', 'task-add']], practices: ['Tracker', ['practices', 'flow']], practicecard: ['Tracker', ['practices', 'flow']], discover: ['Local Events', ['discover', 'event-add']],
  goals: ['Goals', ['goals', 'review']], goalcard: ['Goals', ['goals', 'task-add']], reviews: ['Reviews', ['review', 'r-week', 'goals']], reviewcard: ['Reviews', ['review', 'r-week']],
  mail: ['Mail', ['mail-sort', 'mail-action', 'email']], mailaccounts: ['Mail', ['email', 'app-password']], contacts: ['Contacts', ['keep-in-touch', 'connect', 'invite']], contactcard: ['Contacts', ['keep-in-touch', 'connect']], messages: ['Messages', ['connect', 'share-space']],
  area: ['Spaces', ['spaces', 'share-space', 'note-start']], areas: ['Spaces', ['spaces', 'share-space']],
  readwatch: ['Library', ['read-watch', 'find']], wellbeing: ['Reflection', ['tool-reflection', 'journal']], journal: ['Journal', ['journal', 'ai']], money: ['Money', ['tool-money', 'spending']], financial: ['Money', ['spending', 'tool-money']],
  settings: ['Settings', ['ai', 'tools', 'data', 'twofa']], admin: null,
};
// Installing happens on one device, but the list shows on all of them, so it's kept
// on the account as well as noticed from the installed app itself.
function guideInstalled(which) {
  if (homeWelcomeSteps()[which]) return true;
  if (!appInstalled(which)) return false;
  if (state.hwSteps !== undefined) homeWelcomeMark(which);
  return true;
}
const guideEsc = (s) => esc(String(s).replace(/<[^>]+>/g, ''));
function guideOpen(k) { try { const s = JSON.parse(localStorage.getItem('life.guide.fold') || '{}'); return s[k] !== false; } catch { return true; } }
function guideFold(k, title, meta) {
  const open = guideOpen(k);
  return `<h2 class="g-h"><button type="button" class="g-fold" data-guide-fold="${k}" aria-expanded="${open}"><span class="g-fold-t">${title}</span>${meta ? `<span class="g-fold-n">${meta}</span>` : ''}<span class="g-sign" aria-hidden="true">${open ? '−' : '+'}</span></button></h2>`;
}
const guideRow = (id, label) => `<button type="button" class="g-row" data-help-open="${id}"><span>${esc(label || GUIDE_ANSWERS[id].title)}</span><span class="g-arrow" aria-hidden="true">→</span></button>`;
function guideEnsureLoaded() {
  if (state._guideLoaded) return; state._guideLoaded = true;
  const rr = () => { if (state.view && state.view.type === 'help' && !document.activeElement.matches('[data-guide-q]')) renderHelp(state.view.tool); };
  api('/api/kv/onb_steps').then((r) => { state.hwSteps = (r && r.value) || '{}'; rr(); }).catch(() => {});
  if (state.gcalAccounts === undefined) { state.gcalAccounts = []; api('/api/gcal/accounts').then((r) => { state.gcalAccounts = (r && r.accounts) || []; rr(); }).catch(() => {}); }
  state.mail = state.mail || {};
  if (!Array.isArray(state.mail.accounts)) { try { mailApi('/accounts').then((r) => { state.mail.accounts = Array.isArray(r) ? r : ((r && r.accounts) || []); rr(); }).catch(() => {}); } catch {} }
}
function renderGuideIndex() {
  guideEnsureLoaded();
  const steps = GUIDE_START.map(([id, done, go]) => {
    let ok = false; try { ok = !!done(); } catch {}
    return { id, ok, go };
  });
  const n = steps.filter((x) => x.ok).length;
  const start = `<section class="g-start"><h2 class="g-start-h">Start here</h2><span class="g-start-n">${n} of ${steps.length}</span>
    <div class="g-start-rows">${steps.map((s) => `<div class="g-start-row${s.ok ? ' is-done' : ''}"><span class="g-tick" aria-hidden="true">${s.ok ? '✓' : ''}</span><span class="g-start-t">${esc(GUIDE_ANSWERS[s.id].title)}${s.ok ? '<span class="hw-sr"> - done</span>' : ''}</span><button type="button" class="g-start-go" data-help-open="${s.id}">${s.go} →</button></div>`).join('')}</div></section>`;
  const rhythm = `<section>${guideFold('rhythm', 'Your rhythm')}${guideOpen('rhythm') ? `<div class="g-tiles">${GUIDE_RHYTHM.map((r) => `<button type="button" class="g-tile" data-help-open="${r.id}"><span class="g-tile-t">${r.title}</span><span class="g-tile-s">${r.lead}</span></button>`).join('')}</div>` : ''}</section>`;
  const how = `<section>${guideFold('how', 'How do I…')}${guideOpen('how') ? GUIDE_HOW.map(([label, ids]) => `<div class="g-group"><h3 class="g-group-h">${label}</h3><div class="g-rows">${ids.map((id) => guideRow(id)).join('')}</div></div>`).join('') : ''}</section>`;
  const tools = `<section>${guideFold('tools', 'Every tool')}${guideOpen('tools') ? `<div class="g-tiles">${GUIDE_TOOLS.map((x) => `<button type="button" class="g-tile" data-help-open="${x.id}"><span class="g-tile-b">${esc(x.title)}</span><span class="g-tile-s">${esc(x.sub)}</span></button>`).join('')}</div>` : ''}</section>`;
  const yours = `<section>${guideFold('yours', 'Your data and our promise')}${guideOpen('yours') ? `<div class="g-body"><p>Kaya is paid for by its subscribers, never by advertisers or by selling what you put in. We don't read your notes, pass on your information or use it to train AI.</p><p class="g-links"><a class="g-link" href="https://koyeba.co/privacy" target="_blank" rel="noopener">Privacy Policy</a><a class="g-link" href="https://koyeba.co/terms" target="_blank" rel="noopener">Terms of Service</a><a class="g-link" href="mailto:contact@koyeba.co">contact@koyeba.co</a></p></div>` : ''}</section>`;
  $('#pane').innerHTML = `${crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label: 'Guide' }], null, null, { omitGroup: true, noHelp: true })}
    <div class="g-page">
      <h1 class="g-title">The Guide</h1>
      <label class="g-search"><span class="hw-sr">Search the Guide</span><input class="g-input" type="search" data-guide-q placeholder="What would you like to do?" autocomplete="off"></label>
      <div class="g-results" id="g-results" hidden></div>
      <div id="g-sections" class="g-sections">${start}${rhythm}${how}${tools}${yours}
        <p class="g-foot">Can't find it? <button type="button" class="g-inline" data-guide-feedback="Guide">Ask us</button>, and we'll add the answer here.</p>
        <p class="g-tagline">For a life well lived</p>
      </div>
    </div>`;
}
function guideSearch(q) {
  const box = document.getElementById('g-results'), rest = document.getElementById('g-sections'); if (!box || !rest) return;
  const words = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.hidden = true; box.innerHTML = ''; rest.hidden = false; return; }
  const hits = Object.keys(GUIDE_ANSWERS).map((id) => {
    const a = GUIDE_ANSWERS[id];
    const title = a.title.toLowerCase(), text = `${a.lead} ${a.sub || ''} ${(a.steps || []).concat(...(a.parts || []).map((x) => [x[0], ...x[1]])).join(' ')}`.replace(/<[^>]+>/g, ' ').toLowerCase();
    if (!words.every((w) => title.includes(w) || text.includes(w))) return null;
    return { id, score: words.filter((w) => title.includes(w)).length };
  }).filter(Boolean).sort((x, y) => y.score - x.score);
  rest.hidden = true; box.hidden = false;
  box.innerHTML = hits.length ? `<div class="g-rows">${hits.map((h) => guideRow(h.id)).join('')}</div>` : `<p class="g-foot">Nothing for that yet. <button type="button" class="g-inline" data-guide-feedback="Guide search: ${esc(q)}">Tell us what you were looking for</button>.</p>`;
}
function renderHelp(key0) {
  const key = GUIDE_ANSWERS[key0] ? key0 : (GUIDE_OLD_KEYS[key0] || 'index');
  if (key === 'index') return renderGuideIndex();
  const a = GUIDE_ANSWERS[key];
  const stepList = (steps) => `<ol class="g-steps">${steps.map((s, i) => `<li class="g-step"><span class="g-step-n" aria-hidden="true">${i + 1}</span><div>${s}</div></li>`).join('')}</ol>`;
  const body = a.list
    ? `<div class="g-rows g-tool-list">${a.list.map((id) => guideRow(id)).join('')}</div>`
    : a.parts ? a.parts.map(([h, steps]) => `<section><h2 class="g-part-h">${esc(h)}</h2>${stepList(steps)}</section>`).join('')
    : stepList(a.steps);
  if (a.installed) guideEnsureLoaded();
  const installed = a.installed ? `<div>${guideInstalled(a.installed) ? '<p class="g-note g-done"><span class="g-tick-s" aria-hidden="true">✓</span> Done, and ticked off in your first steps.</p>' : `<button type="button" class="g-cta" data-guide-installed="${a.installed}">I've done this ✓</button>`}</div>` : '';
  const next = (a.next || []).filter((id) => GUIDE_ANSWERS[id]);
  $('#pane').innerHTML = `${crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label: 'Guide', attr: 'data-open-guide' }, { label: a.title }], null, null, { omitGroup: true, noHelp: true })}
    <article class="g-page g-answer">
      <h1 class="g-title g-title-a">${esc(a.title)}</h1>
      <p class="g-lead">${esc(a.lead)}</p>
      ${body}
      ${a.note ? `<p class="g-note">${esc(a.note)}</p>` : ''}
      ${a.go ? `<div class="g-cta-after"><button type="button" class="g-cta" ${a.go[1]}>${esc(a.go[0])} →</button></div>` : ''}
      ${installed}
      ${next.length ? `<section><h2 class="g-next-h">Next, you might like</h2><div class="g-rows">${next.map((id) => guideRow(id)).join('')}</div></section>` : ''}
      <p class="g-foot">Something missing or wrong here? <button type="button" class="g-inline" data-guide-feedback="${esc(a.title)}">Tell us</button>.</p>
    </article>`;
}
// The Help button on a page, and the panel it opens beside the page.
function guideHelpFor(view) { const t = view && view.type; return (t && Object.prototype.hasOwnProperty.call(GUIDE_HELP_FOR, t) && GUIDE_HELP_FOR[t]) || null; }
// Help lives in the menubar now (renderNav), so pages no longer draw their own button.
function guideHelpBtn() { return ''; }
function guideClosePanel() { const el = document.getElementById('g-panel'); if (el) el.remove(); }
function guideOpenPanel() {
  const h = guideHelpFor(state.view);
  if (!h) { openHelp('index'); return; }   // a page with no guide of its own: the whole Guide
  guideClosePanel();
  const el = document.createElement('aside');
  el.id = 'g-panel'; el.className = 'g-panel'; el.setAttribute('aria-label', `Help with ${h[0]}`);
  el.innerHTML = `<div class="g-panel-h"><h2 class="g-panel-t">Help with ${esc(h[0])}</h2><button type="button" class="g-panel-x" data-guide-help-close aria-label="Close help">✕</button></div>
    <div class="g-rows">${h[1].filter((id) => GUIDE_ANSWERS[id]).map((id) => guideRow(id)).join('')}</div>
    <button type="button" class="g-panel-all" data-open-guide>The whole Guide →</button>`;
  document.body.appendChild(el);
  const x = el.querySelector('.g-panel-x'); if (x) x.focus();
}
document.addEventListener('input', (e) => { if (e.target && e.target.matches && e.target.matches('[data-guide-q]')) guideSearch(e.target.value); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('g-panel')) guideClosePanel(); });
document.addEventListener('click', (e) => {
  const t = e.target; if (!t || !t.closest) return;
  const f = t.closest('[data-guide-fold]');
  if (f) { const k = f.dataset.guideFold; try { const s = JSON.parse(localStorage.getItem('life.guide.fold') || '{}'); s[k] = !guideOpen(k); localStorage.setItem('life.guide.fold', JSON.stringify(s)); } catch {} renderGuideIndex(); return; }
  if (t.closest('[data-guide-help]')) {
    if (document.getElementById('g-panel')) { guideClosePanel(); return; }
    // Press Help again, on the Help page, to go back where you were - same as Back.
    // (Robin, 2026-11-05: "pressing Help again does the same thing as the back button".)
    if (state.view && state.view.type === 'help') { if (typeof navBack === 'function') navBack(); else history.back(); return; }
    guideOpenPanel(); return;
  }
  if (t.closest('[data-guide-help-close]')) { guideClosePanel(); return; }
  if (t.closest('#g-panel [data-help-open], #g-panel [data-open-guide]')) { guideClosePanel(); return; }
  const gi = t.closest('[data-guide-installed]');
  if (gi) { markAppInstalled(gi.dataset.guideInstalled); homeWelcomeMark(gi.dataset.guideInstalled); if (state.view && state.view.type === 'help') renderHelp(state.view.tool); return; }
  const gs = t.closest('[data-guide-settings]'); if (gs) { openSettings(gs.dataset.guideSettings); }
});
