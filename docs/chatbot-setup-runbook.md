# Runbook: connect EATRO's chat assistant to OpenRouter and Meta

For the Claude desktop app (or Claude in Chrome), working in the owner's own browser with the owner present.
The owner starts it by saying, for example: "Read docs/chatbot-setup-runbook.md in the restora-pos project and do Stage A."

## Who you are helping and why

The owner of EATRO, a restaurant in Bangladesh, has a chat assistant built into their own POS system:

- website: eatrobd.com
- admin: admin.eatrobd.com
- API: api.eatrobd.com

The assistant answers customers on the website now. Facebook Messenger, Instagram DMs, WhatsApp and post comments follow in later code phases.

A separate coding session writes and deploys the code. Your job is only the account setup in the browser. You change no code and no menu data.

## What "done" looks like

- **AI model (Stage A and B1):** Admin → Marketing → Chat Assistant → **AI Models** shows at least one AI connection with a self-test score of 60% or more. That connection is set as the first choice for **Chat replies**.
- **Website chat on:** in **Settings & Test**, the website chat is switched on and a test message from the owner's phone gets a reply.
- **Meta (later stages):** each social channel receives a test message from the owner's phone, and the Meta review is ready for the owner to submit.

## Ground rules

These protect the owner's accounts. Hold to them even when a step would be faster otherwise.

**Secrets never go through you.** This covers the OpenRouter key, the Meta App Secret and any access token. The owner copies them from one tab into the admin field.
- Bring both tabs to the right screen, tell the owner what to copy where, and wait.
- Don't read a revealed secret aloud, write it in chat, save it to a file, or take a screenshot while one is visible.

**The owner does these personally.** Bring them to the screen, explain what it asks, and wait:
- logging in, passwords and two-factor codes;
- card or payment details;
- accepting terms of service;
- pressing the final Submit on the Meta review;
- uploading business documents.

**Ask before anything hard to undo:**
- deleting or removing anything;
- changing who has a role on the Page, app or business;
- switching an app between Development and Live;
- touching anything under Ads or billing.

**Send no messages yourself.** Test messages come from the owner's own phone. Don't message, comment or post as the Page.

**Read each screen as it is today.** Meta's and OpenRouter's screens change often, so the steps below describe the goal of each step, not exact button names. If a screen doesn't match and the right path isn't clear, stop and tell the owner what you see.

**Reuse an existing Meta app if there is one.** The system already posts to the Facebook Page and sends WhatsApp documents to suppliers, so an app probably exists. A WhatsApp number can't simply be moved between apps, so check before creating anything.

**Stop after two failures.** If a step fails twice, report what happened and what the screen says. Don't work around a permission error.

## Values you'll need (not secret)

| Item | Value | Live from |
|---|---|---|
| Admin page | `https://admin.eatrobd.com/chatbot` | Phase 1 |
| Privacy policy | `https://eatrobd.com/privacy` | Phase 1 |
| Data deletion instructions | `https://eatrobd.com/data-deletion` | Phase 1 |
| App domain | `eatrobd.com` | — |
| Messenger/Instagram webhook | `https://api.eatrobd.com/api/v1/chatbot/webhook/meta` | Phase 2 |
| WhatsApp webhook | `https://api.eatrobd.com/api/v1/chatbot/webhook/whatsapp` | Phase 3 |
| Facebook Login redirect address | `https://api.eatrobd.com/api/v1/chatbot/connect/facebook/callback` | Phase 2 |
| Webhook verify token | Shown in admin once phase 2 is live (the system generates it) | Phase 2 |

If an address returns "not found", that code phase isn't live yet. Stop and tell the owner which stage is waiting on it.

## Stage A: accounts (any time)

**1. OpenRouter**
- Open openrouter.ai. If the owner has no account, bring them to sign-up and wait.
- Go to the credits page and explain: a one-time $10 purchase raises the free-model limit from 50 to 1,000 requests a day. The owner pays.
- Go to the API keys page and have the owner create a key named "EATRO chatbot". It is shown only once, so they should keep the tab open, or store it in their password manager.

**2. Meta developer account.** Open developers.facebook.com/apps. If the owner isn't registered as a developer, bring them through registration and wait at each confirmation.

**3. Find or create the app.**
- List the apps shown. For each, note its name, whether WhatsApp, Messenger or Instagram is added, and whether it's in Development or Live mode.
- Report the list to the owner and recommend one:
  - reuse the app that holds the WhatsApp number, if one exists;
  - otherwise create a new Business-type app named "EATRO Assistant" under the owner's business portfolio.

**4. Add products and use cases** to the chosen app, if missing:
- Messenger
- Instagram messaging
- WhatsApp
- Webhooks
- Facebook Login for Business

**5. Basic settings.**
- Set the app domain, privacy policy address and data-deletion address from the table.
- Set a 1024×1024 app icon if the owner provides the EATRO logo file.

**6. Report:** App ID (not secret), which products are added, the app's mode, and anything left undone.

## Stage B: connect

### B1. AI model (phase 1, live now)

**1. Open the page.** Go to admin.eatrobd.com → Marketing → **Chat Assistant** → **AI Models**. The owner must be logged in as Owner.

**2. Add the first model.**
- Click **Connect OpenRouter (free)**.
- The owner pastes the key, then clicks **Check key and list free models**.
- Read out the daily limit shown, and whether it says to buy credit.

**3. Pick models to try.**
- From the free model list, suggest two or three general chat models from well-known makers.
- Prefer models that mention multilingual support. The bot must reply in Bangla and Banglish as well as English.
- The owner chooses. Add each one with **Add and run self-test**.

**4. Compare the scores.**
- Wait for the self-tests to finish; the card shows "Self-test running…" until then.
- Open **Show results** on each and read out the score, the average reply time, and which questions failed.
- A model needs 60% or more.

**5. Set the first choice.**
- Under **Which AI does what → Chat replies**, add the best-scoring model as First, and a second model as Backup 1 if one passed.
- Save.

**6. Test before going live.**
- Go to **Settings & Test**. In the **Test the bot** panel, send:
  - kokhon khole?
  - pizza price koto?
  - birthday party for 30 people, cost per head?
  - book a table for 4 tomorrow 8pm
- Report each reply. Nothing is saved from the test panel.

**7. Switch on the website chat.**
- Only when the owner is happy with the test replies: set **Website chat** to **Auto** and save.
- Ask the owner to open eatrobd.com on their phone and send a message.
- It should appear in **Inbox** within a few seconds.

### B2. Facebook and Instagram (after the coding session says phase 2 is live)

1. In admin, open the **Connect** section.
2. Paste the App ID yourself. For the App Secret, open the app's basic settings in the other tab and have the owner reveal and copy it into the admin field. Click Save; the system registers the webhooks on its own.
3. In the Meta app's Facebook Login settings, add the redirect address from the table to the valid redirect addresses.
4. Click **Connect with Facebook** in admin. In Facebook's window, the owner chooses the EATRO Page and the linked Instagram account and approves the permissions. Check the Connect section then shows the Page name, the Instagram handle and the granted permissions.
5. If no Instagram account is found, the Instagram account is probably not a professional account, or not linked to the Page.
   - Show the owner where that's set in Instagram or Meta Business settings, and wait.
   - Also check that "Allow access to messages" is on in the Instagram account's message settings.

### B3. WhatsApp (after phase 3 is live)

1. Click **Subscribe** for WhatsApp in admin.
2. In WhatsApp Manager, bring the owner to the payment method screen and explain: since 1 October 2026 only the first 1,000 replies a month are free, and Meta stops delivering after that if no payment method is on file.
3. The owner adds the payment method.

### B4. Check and test

**Check the subscriptions (read only)** in Meta's dashboard. The webhook shows as verified, and these are subscribed:
- **Page:** messages, message echoes, postbacks, feed
- **Instagram:** messages, comments
- **WhatsApp:** messages

**Test with every social channel in Suggest mode** (Settings & Test). Ask the owner to, from their phone:
- send "hi" to the Page on Messenger;
- send "hi" to the Instagram account;
- send "hi" to the WhatsApp number;
- comment "price?" on one Page post.

Each should appear in the Inbox (or Comments) within a minute, with a suggested reply waiting. Nothing should be sent automatically.

**Report:** a table of channel, received yes/no, suggested reply yes/no, and any error shown, with its exact wording.

## Stage C: Meta review (after B2 passes)

**1. Add the permissions** in the app's review section:
- `pages_messaging`
- `pages_manage_metadata`
- `pages_show_list`
- `pages_read_engagement`
- `pages_read_user_content`
- `pages_manage_engagement`
- `instagram_basic`
- `instagram_manage_messages`
- `instagram_manage_comments`
- `business_management`, stating that it is requested only as a dependency of the others

Add the Human Agent feature only if the owner wants staff to be able to reply up to 7 days after the customer's last message.

**2. Paste the explanations.** For each permission, paste the matching text from `docs/chatbot-meta-review-text.md`.

**3. Screen recording.** The owner records it. Tell them to show, in this order:
1. logging into admin;
2. clicking Connect with Facebook and approving;
3. a customer account sending a message, and the reply arriving;
4. a comment receiving a public reply and a private message;
5. a staff member taking over a chat in the Inbox.

Upload the file they give you.

**4. Business verification.** If the dashboard asks for it, show the owner the documents it lists, and stop.

**5. Submit.** Bring the owner to the final screen, summarise what is being submitted, and let them press Submit.

**6. Report:** what was submitted, the date, and where the review status will appear. Until approval, the bot only answers people who have a role on the app or Page; the website chat is unaffected.

## After approval

- With the owner's go-ahead, switch the app to Live mode if it isn't already.
- Ask the owner to test once from an account with no role on the Page.
- The owner can then move each social channel from Suggest to Auto in admin when comfortable.
