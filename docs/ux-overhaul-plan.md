# UX overhaul plan

Written 2026-11-15 from the owner's 12 annotated screenshots of 2.5.0, a read of the code behind each one, a design critique, and a walk-through by the `lazy-user` persona agent (`.claude/agents/lazy-user.md`). Nothing here is built yet.

The owner settled the twelve product decisions behind it on 2026-11-15. They are listed at the end.

## Who this is for

The person who opens Saku for under a minute to put money in and leave. They do not read, do not long-press, and assume the app is broken when a button is grey for no stated reason. They are just as put off by a number with no label, or a tap that lands somewhere unexpected.

Five rules follow from that. Every change below is checked against them, and the persona agent is re-run on each pull request.

1. At most one short helper line per screen. Anything longer is deleted or moved behind an info tap.
2. A main button is never grey without a visible reason. It stays tappable and says what is missing, next to the field.
3. X and Back return to the screen you came from.
4. Nothing important is reachable only by long-press, swipe or a "…" menu.
5. Tapping a thing opens that thing: a pocket opens the pocket, an account opens the account.

## The 12 reported problems

### 1. Status bar icons vanish, and "System" ignores a dark phone

Both symptoms have one cause: the Android side and the web page decide "is it dark?" separately, and disagree.

- The page decides from `prefers-color-scheme` (`src/appearance.ts:19`). The Activity theme is `Theme.AppCompat.Light.NoActionBar` (`android/app/src/main/res/values/styles.xml:13`), and Android WebView reports that media query from the app theme, not from the phone. So under "System" the page always paints light. This part is documented WebView behaviour for apps targeting API 33 and later and matches the screenshots, but it has not been confirmed on the phone yet.
- The icon colour is decided from the phone's night mode, in two places: `SakuAppearance.applyChrome` (`SakuAppearance.kt:13, 28-32`) and Capacitor's own `SystemBars` plugin, whose default style reads the phone's night mode. Dark phone, light page: white icons on a white bar. Confirmed in code.
- `window.statusBarColor` no longer does anything: the app targets SDK 36, where the bar is transparent and the page shows through.

Fix:
- One decision, made once. Android reports the phone's dark or light to the page (a `systemDark` value plus a push when it changes, on the existing `HomeWidget` plugin). `resolveTheme` uses that on Android and keeps `matchMedia` on the web.
- The page then sets the icon colour itself through Capacitor's `SystemBars.setStyle`, from the theme it actually painted. Setting it explicitly also stops Capacitor re-deriving it on every configuration change.
- Remove `statusBarColor`, `navigationBarColor` and the deprecated `systemUiVisibility` from `applyChrome`.
- Switch `AppTheme.NoActionBar` to a DayNight parent and call `AppCompatDelegate.setDefaultNightMode(SakuAppearance.nightMode(...))` in `MainActivity`, as `QuickEntryActivity` already does, so the native date picker and the splash follow the same choice.

Check on the phone: phone light and dark, each with app System, Light and Dark (six cases). In every case the clock and icons are readable. Then switch the phone theme while Saku is open, and again after returning from the background.

### 2. Editing a pocket means leaving the pocket

The pocket page (`src/App.tsx:1049-1055`) has no edit action. Editing is only on the grid card's "…" menu or a long-press (`src/components.tsx:335, 361`).

Fix:
- A pencil button beside the pocket name on its page opens the pocket editor. Closing it returns to the pocket page.
- The editor already has Delete, so the page needs only the one button.
- Tapping the Budget tile opens the same editor with the budget field focused.
- Rename the three tiles to Budget, Spent and Left (or "Over by" when negative). Delete the paragraph under them ("Funding is your monthly budget and recorded moves between pockets…").
- The page shows two "Add transaction" buttons on a phone, one in the heading and one floating. Keep the floating one.

### 3 and 4. An account should open that account

The big cash card and every card in the account strip call the same thing, `setAccountsOpen(true)` (`src/App.tsx:858, 931`). Rows in "Money by account" open the rename sheet, not the account (`src/AccountsOverview.tsx:48`).

Fix: an account page, built the same way as the pocket page.
- Heading: back link, account name, pencil (rename), month picker.
- Tiles: Balance, In, Out for the month.
- Below: that account's transactions for the month, grouped by day, with the same "All history" switch the pocket page has. Transfers and balance fixes are included, since they move this account's balance.
- Actions: Add transaction (with this account already chosen), Transfer, Fix balance.
- Home account strip: tap opens the account page. The long-press shortcut is removed, because the pencil is now one tap away.
- "Money by account": tapping a row opens the account page. The big cash card keeps opening "Money by account".

### 5. X goes to Home instead of back

Sheets replace each other instead of stacking. Opening the account editor first closes "Money by account" (`src/App.tsx:932`), and "Fix balance" first closes the editor (`src/AccountsOverview.tsx:79`). So X has nothing to return to.

Fix:
- Keep a small stack of open sheets in `App.tsx`. Opening pushes, and X, the dimmed area, Escape and Android Back all pop one level.
- After a successful save, pop one level too. Saving a balance fix returns to the account page with the new balance showing.
- Pages follow the same rule: a pocket opened from Home goes back to Home, not to "All pockets" (`src/navigation.ts`).

Paths to check by hand: Home, Money by account, account, rename, X, X, X. Home, account, Fix balance, X. Home, pocket, edit, X, Back. Settings, Fix balance, X.

### 6. "Adjust balance" stays grey and does not say why

The button is disabled while Reason is empty (`src/App.tsx:1624`) and nothing on screen says so.

Fix:
- Reason becomes optional. An empty reason is saved as "Balance adjustment" in the user's language, so the stored record and older app versions are unaffected (`src/domain.ts:216-225` still receives a non-empty note).
- The button is enabled unless a save is running. If the balance is empty, or equals the current one, the message appears under the field and the field takes focus.
- The sheet loses its two-line subtitle and its closing paragraph. Date defaults to today and moves under "More".
- The same rule is applied to every form: search for `disabled=` on primary buttons and convert each to "enabled, with a message at the field".

### 7. A renamed notification keeps its new name on later ones

Two causes, both confirmed in code.

- The parser treats the bank's category as the merchant. For Indonesian myBCA text such as "… di kategori Transfer Rekening", `merchant()` in `NotificationParsers.kt` returns "kategori Transfer Rekening", and names keep a trailing "di kategori …". Only the English wording is handled. Every transfer therefore shares one "merchant", and so does every "Food and Beverages" payment.
- A manual rename is stored as that merchant's name (`learnMerchant` in `src/NotificationReview.tsx:99`), and applied to every later row with the same key (`cleanName` in `src/notificationRows.ts:27`).

Fix:
- A rename in Catch up changes that one row. Saku keeps remembering the pocket, not the name.
- A remembered name is shown on a notification row only when it came from automatic tidying, never from a manual edit. Rules gain an optional marker for this. Names the user already taught by accident stop appearing, with no migration.
- Parser: handle "di kategori X" the way "at X category" is handled. Strip it from names, and when the category is all there is, show the category ("Transfer Rekening") as the row's default name.
- Tests: new cases in `NotificationParsersTest.kt`, `src/notificationRows.test.ts` and `src/merchants.test.ts`, including "rename one, the next one keeps the bank's wording".

### 8. Dates should read "Wednesday, 11 November 2026"

Day headings are built with weekday, day and month only (`src/components.tsx:393`), and the phone's locale data decides the punctuation, which is why there is no comma.

Fix:
- One `longDate()` in `src/domain.ts`, assembled from parts so the comma and year are always there: "Wednesday, 11 November 2026", "Rabu, 11 November 2026".
- Used for day headings in Activity, the pocket page and the account page, for the Catch up day sheet, and as the text of the date field in forms in place of "11/11/2026". Tapping the field still opens the phone's date picker.
- In lists already grouped by day, drop the small date under each amount. The heading says it.
- Compact dates ("11 Nov") stay only where a full date cannot fit, such as Catch up rows.

### 9. An over-budget pocket barely looks different

Only the 5px bar turns red (`src/components.tsx:352`). The amount has the same colour and weight as a healthy pocket, and "over budget" is small grey text. The state is carried by colour alone on the smallest element of the card.

Fix (the tinted card, chosen by the owner from a mock-up):
- The whole card takes a soft red tint and a red outline, in both themes.
- The amount reads "−Rp 150.000" in red, with an "Over" chip and a warning icon, so the state does not depend on colour.
- The bottom line reads "Rp 150.000 spent of Rp 0" in place of a percentage that stops meaning anything past 100.
- Text on the tint keeps at least 4.5:1 contrast in light and dark.

### 10. Two paragraphs of warning on Pockets

Both banners are sentences (22 and 12 words), the second is hard-coded English (`src/App.tsx:1079-1085`), and their text colour on that background is about 3.4:1, below the 4.5:1 minimum for small text.

Fix: remove both.
- "1 pocket is over budget…" is redundant once the card itself is red (item 9).
- "Your remaining pocket budgets are … more than recorded cash…" becomes the third tile. Normally it reads "Free to spend Rp X". When the plan is above the cash, it reads "Short by Rp 2.500.000" in the warning colour. Tapping it opens a small sheet with two buttons, Add income and Adjust plan.

### 11. Recording a payment ahead of time

Activity stays a record of things that have happened. Account balances add up every recorded row whatever its date (`src/domain.ts:200`), and Catch up, the bank balance check and Monthly Check all assume nothing is dated after today. A future-dated row would make "Recorded cash" wrong the moment it is saved.

The example given (due on the 20th, paid on the 11th) is already recordable: it is an 11th transaction. The real gap is with repeating bills. Plans only offers a bill once its day arrives (`dueRules` in `src/domain.ts:269`), so a bill paid early by hand is asked for again on the 20th.

Fix:
- Plans lists this month's bills that are not due yet, each with "Pay now". It records today's date and ticks this month's occurrence, so nothing is asked on the 20th.
- A one-off payment that has not happened yet is a reminder, not a transaction. That is a separate, larger feature and is not part of this plan.

### 12. Adding last month's spending to a newer pocket

The form refuses any date before the pocket's first month (`src/App.tsx:1753`), and the same rule sits in the CSV, statement and Catch up imports and in the ledger validator (`src/domain.ts:570`).

Fix: let it save.
- On save, if the date is before the pocket's first month, the pocket's first month moves back to cover it. The months added this way get a budget of Rp 0, so earlier months' plans do not change.
- One helper in `src/domain.ts` does this, called from the six places that check today: `src/App.tsx:1753`, `src/CsvStatements.tsx:53`, `src/Statements.tsx:289`, `src/importTransactions.ts:157`, `src/Plans.tsx:119`, and the pocket pickers that hide "too new" pockets.
- The validator rule stays as it is, so phones still on an older version keep opening the synced data.

## Across the app (not in the list of 12)

Found while reading the code and screens.

### Text to delete

These add nothing a user acts on.

- Sheet subtitles: "Every transaction tells part of your story." and "Keep the details just right." on the transaction form, "Move money between your accounts without changing income or spending." on Transfer.
- "Your month, thoughtfully divided." under the Pockets heading on Home, and "A little awareness goes a long way." at the bottom of Home.
- "Counts against this pocket." and "You can categorize this later." under the Pocket field.
- "Captured on this phone and kept for 7 days. Only what you add joins your ledger." above the notification list moves behind an info tap.
- The English file has 75 strings of 14 words or more. Each is reviewed in the words pass: delete, shorten to one line, or move behind an info tap.

### Plain words

Labels a non-finance user has to decode, and their agreed replacements.

| Now | Proposed |
| --- | --- |
| Recorded cash | Cash |
| Budget availability, Within budget & cash | Free to spend |
| Funded this month | Budget |
| Unassigned | No pocket |
| Net change in this view | Total |
| available in your current plan | left this month |

### Smaller fixes

- **Untranslated text.** About a dozen strings are hard-coded in English and show as English in Indonesian: "Saku will add", "Not set", "Saving...", "A clean slate", "pocket is / pockets are over budget", "Remove … shortcut", "notification rows added", "balance adjusted", "of … paid", "Due …", "per year", and "Pocket" and "Unassigned" in the statement review. Move them into `src/locales`.
- **Balance fixes in Activity** read "Balance adjustment" twice, as title and as subtitle (`src/components.tsx:415`). Show the reason as the title when there is one, and the account once.
- **Account rename sheet.** "Save name" sits grey until the name changes. Show it only once the name has changed.
- **Home is eleven sections long.** Drop the bottom note, and drop the "Explore spending" link, which repeats "View insights" on the cash card.
- **Long-press on a pocket card** stays as a shortcut only. Everything it offers is also on the visible "…" button and, after item 2, on the pocket page.

### From the lazy-user agent

The agent walked ten everyday tasks through the code and the screenshots. Its counts for today, and the target after this plan:

| Task | Today | Target |
| --- | --- | --- |
| Add an expense | 2 to 6 taps, 2 typed fields | 2 to 4 taps, 1 typed field |
| Open one account's activity | 3 taps, through the Activity filter | 1 tap |
| Edit a pocket | 5 taps | 2 taps |
| Fix a balance | 5 taps, 2 typed fields | 3 taps, 1 typed field |
| Add last month's spending to a newer pocket | blocked | same as any expense |
| Clear the Pockets warnings | no path on screen | nothing to clear |
| Install to first expense | about 13 taps, ends on Pockets | ends on Home with the Add sheet open |

Its findings beyond the 12 follow. Each was checked against the code by hand, except the first, which needs a phone.

**Things that fail without saying so**

- Messages can be hidden behind an open sheet. Confirmations and errors are drawn in the page (`src/App.tsx:1452`), underneath the full-screen sheet, so "Save and add another" appears to just empty the form. Not yet confirmed on a phone. Fix: show the message inside the open sheet.
- Form errors appear at the very bottom and force "More details" open (`src/App.tsx:1906, 1923`). Fix: show each error under its own field, and leave "More details" closed.
- "Next day" in the day-by-day sheet does not count the day (`src/CatchUpDays.tsx:23`). After stepping through seven days, Home still says seven days to catch up. Fix: Next day on an empty day marks it as nothing spent, and the separate "Nothing spent" button goes.
- A transfer larger than the recorded balance is refused, with one sentence covering three different problems (`src/App.tsx:1741`). Fix: allow it, and let the account show a negative balance until it is fixed. The two remaining checks, the same account chosen twice and fewer than two accounts, each get their own message.
- Changing a pocket's budget changes the month on screen only (`src/App.tsx:2034`). This is deliberate today, and stated in a footnote, but a user who raises a budget sees the old figure return next month. Fix: a change applies from the month on screen onward. Earlier months keep their figures, the way the planner already pins them (`src/domain.ts:905`), and later months that had their own figure take the new one. The footnote is removed.

**Catch up**

- A captured move between the user's own accounts is added as spending, and cannot be turned into a transfer afterwards (`src/NotificationReview.tsx:130-141`, `src/App.tsx:1814`). Fix: "Moved to my other account" in the row sheet, which records a transfer.
- Rows say "Will add" without showing a pocket (`src/NotificationReview.tsx:126`), so "Add 6" can file everything under no pocket. Fix: a pocket chip on each row, tappable.
- The row sheet has no Done button, only X, and the "Will add" pill opens the sheet where a user expects it to switch. Fix: add Done, and let a tap on the pill switch between add and skip.
- The empty Notifications tab does not say when capture is turned off (`src/NotificationReview.tsx:117`). Fix: one line with a link to the setting.
- The save button on the screenshot list is disabled until the dates are confirmed elsewhere on the screen (`src/CatchUp.tsx:672`). Fix: the button itself asks for the confirmation.

**Accounts and pockets**

- One action has three names: Fix balance, Adjust balance, Balance adjustment. Accounts also open differently from Home and from Settings (`src/App.tsx:931, 2394`). Fix: "Fix balance" everywhere, and Settings opens the same account page as Home.
- A new account cannot be given a starting balance (`src/App.tsx:2421-2453`). Fix: a balance field on Add account.
- Deleting a pocket that has transactions ends in a sentence and a Cancel button (`src/App.tsx:1405-1407`). Fix: ask which pocket its transactions move to, then delete.
- An over-budget card gets a "Cover it" action, which opens Move budget with this pocket and the shortfall already filled in.

**Forms, Home and first run**

- "Paid with" always starts on the first account (`src/App.tsx:1682`). Fix: start on the last one used.
- The name is required. Proposal: optional, falling back to the pocket name.
- The form footer has three buttons and the middle one is clipped (screenshot 12, `src/App.tsx:1960-1968`). Fix: drop Cancel, since X already closes the sheet.
- The month picker also shows on Catch up and Plans, and adding a transaction while browsing another month saves it to today without saying so (`src/App.tsx:799, 1673`). Fix: hide the picker on those two screens. After a save into a month that is not on screen, the confirmation names the month and offers "View".
- Home shows one figure three times (`src/App.tsx:866, 876, 940`), and the floating Add button covers the cards under it. Fix: cash and one "free to spend" figure, and room below the last card.
- First run ends on Pockets, which has no Add button (`src/App.tsx:1447`). The Google button is grey until a box is ticked, with no reason shown (`src/App.tsx:2187`). Fix: finish on Home with the Add sheet open. The button stays tappable and points at the box. The agreement itself stays an explicit tick.
- "Add 6" in Catch up and the instant deletes (a quick entry, an empty account) have no Undo, unlike a single add (`src/NotificationReview.tsx:103`, `src/App.tsx:941`, `src/AccountsOverview.tsx:80`). Fix: the same Undo message.
- Bills waiting to be recorded sit under More, then Plans (`src/Plans.tsx:181`). Fix: a card on Home, built with item 11.
- Settings opened from the avatar goes back to More, not to where the user was (`src/navigation.ts:6`). Fixed with item 5.

The agent also found more untranslated strings than the dozen listed above, in `src/App.tsx`, `src/Plans.tsx`, `src/Onboarding.tsx`, `src/NotificationReview.tsx` and `src/domain.ts`. The translation fix covers all of them.

## Order of work

Six pull requests, each shippable on its own.

1. **Fixes with no design choice.** Items 1, 5, 6, 7, 8. Also the untranslated strings, messages shown inside the open sheet, errors under their own field, and "Next day" counting the day. Highest value, lowest risk.
2. **Pockets.** Items 2, 9, 10, 12, plus "Cover it" and deleting a pocket that has transactions.
3. **Accounts.** Items 3 and 4, one name for Fix balance, a starting balance on Add account, and Settings opening the same page. Uses the sheet stack from the first pull request.
4. **Catch up.** Own-account moves as transfers, the pocket chip, Done and the add or skip pill, the empty Notifications tab, Undo on "Add all".
5. **Words, forms and Home.** The text to delete, the plain words, form defaults, the Home trim, the month picker and the first-run ending.
6. **Bills.** Item 11 and the Home card for bills that are due.

Released together as 2.6.0 following `RELEASE.md`, or as 2.5.x after the first pull request if the status bar fix should not wait.

## How each pull request is checked

- `npm test` and `npm run build` pass. New logic (the sheet stack, `longDate`, the pocket back-fill, merchant memory, theme resolution) gets unit tests beside the existing ones.
- The Kotlin unit tests under `android/app/src/test` pass, with the new parser cases.
- The phone checks listed under items 1 and 5 are done on the owner's phone. These two cannot be proven from a desktop browser.
- The `lazy-user` agent is run on the changed screens and reports no "quits the task" finding.
- Both languages and both themes are looked at for every changed screen.

## Decisions

Settled by the owner on 2026-11-15.

1. **Tapping an account (items 3, 4)** opens a page of its own, built like the pocket page. Not the Activity tab with a filter.
2. **Reason on Fix balance (item 6)** is optional, and saved as "Balance adjustment" when empty.
3. **Renames (item 7)** stop being remembered for notifications only. Statement and screenshot imports keep today's behaviour.
4. **Long dates (item 8)** are used for day headings and the date field in forms. Tight rows keep "11 Nov".
5. **The over-budget card (item 9)** is the tinted card.
6. **The Pockets warnings (item 10)** are both removed, and the cash shortfall moves into the third tile.
7. **Future payments (item 11).** Activity stays a record of what has happened. Repeating bills get "Pay now". Upcoming one-off payments and future-dated transactions are not built.
8. **An older date in a newer pocket (item 12)** saves, and the pocket is extended back with a Rp 0 budget for the added months.
9. **Plain words.** The labels are renamed as in the table under "Across the app".
10. **Item 5** means every X and Back in the app.
11. **Changing a pocket's budget** applies from the month on screen onward.
12. **A transfer larger than the recorded balance** is allowed, and the account shows a negative balance until it is fixed.

One proposal sits outside these twelve and is not yet agreed: making the transaction name optional.
