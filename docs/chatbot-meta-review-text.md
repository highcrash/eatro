# Meta App Review: permission explanations for the EATRO Assistant

Each section below is pasted into the matching permission's "How will your app use this permission?" box. Every explanation is complete on its own, because Meta reviews permissions separately.

The reviewer test steps at the end go in the "Instructions for reviewers" box.

Before submitting, replace each `[placeholder]` with the real value:

| Placeholder | Where to find it |
|---|---|
| `[Page name]` | The EATRO Facebook Page's name |
| `[@instagram handle]` | The Instagram account linked to that Page |
| `[test login]` | A temporary reviewer login: create a staff account with the Owner role in admin |

Create that reviewer account just before you submit. Remove it after Meta's decision.

---

## pages_messaging

EATRO is a restaurant in Bangladesh. This app is used only by EATRO and only for its own Facebook Page, [Page name]. It is not offered to other businesses.

When a customer sends a message to the Page, the app replies about the menu, prices, current offers, opening hours, table bookings and party arrangements. Replies come either from answers the restaurant has prepared or from an AI assistant whose prices are checked against the restaurant's live menu. The app replies only within the standard 24-hour window after the customer's message. It never sends promotional messages.

Complaints, unclear questions and booking requests are passed to staff. Staff see every conversation in the restaurant's admin panel. They can take over a conversation and reply in person, and the automated replies then stop for that conversation.

The first automated reply in each conversation is labelled as coming from the EATRO Assistant (automated).

## pages_manage_metadata

This app is used only by EATRO for its own Facebook Page, [Page name].

The app uses this permission to subscribe that Page to webhook events: messages, message echoes, postbacks and feed. This lets it receive customers' messages and comments on the Page's own posts as they arrive. Without the subscription, the app cannot answer customers.

The subscription is made once, when the restaurant's owner connects the Page in the admin panel. It is renewed only when the Page is reconnected.

## pages_show_list

This app is used only by EATRO.

When the restaurant's owner clicks "Connect with Facebook" in the admin panel, the app uses this permission to list the Pages the owner manages. The owner then chooses the EATRO Page, [Page name]. The app stores only the chosen Page's id, name and access token.

## pages_read_engagement

This app is used only by EATRO for its own Facebook Page, [Page name].

The app reads the Page's own posts (caption and id) so that, when a customer comments on a post or shares it in Messenger, it knows which dish or offer the post is about. It can then reply with that dish's current price. Post details are cached briefly and are not used for anything else.

## pages_read_user_content

This app is used only by EATRO for its own Facebook Page, [Page name].

The app reads comments that people leave on the Page's own posts. It sorts each comment:

- Questions about price, opening hours or booking get a short public reply. Where useful, a private message with the details follows.
- Complaints are not answered automatically. Staff are alerted in the admin panel, and a person decides the reply.

Comments are not used for advertising or profiling, and they are deleted from the app after the restaurant's retention period (90 days by default).

## pages_manage_engagement

This app is used only by EATRO for its own Facebook Page, [Page name].

The app uses this permission to reply to comments on the Page's own posts, and to like positive comments, both on the Page's behalf. For example, when someone comments "price?", the Page replies under the comment, sometimes with the price.

At most one automated reply is made per person per post, and replies are rate-limited per hour. Complaints never receive an automated public reply; staff answer them.

Staff can also hide spam or abusive comments with one tap in the admin panel. The restaurant can optionally turn on automatic hiding, which applies only to swearing and spam links. Real complaints are never hidden automatically.

## instagram_basic

This app is used only by EATRO for its own Instagram professional account, [@instagram handle], which is linked to its Facebook Page.

The app reads the account's id and username so the owner can confirm the right account is connected. It also reads the account's own posts (caption and id), so that comments and shared posts can be matched to the dish they show.

## instagram_manage_messages

This app is used only by EATRO for its own Instagram professional account, [@instagram handle].

When a customer sends a direct message to the account, the app replies about the menu, prices, offers, opening hours, bookings and party arrangements, within the standard messaging window. It never sends promotional messages.

Staff see every conversation in the restaurant's admin panel. They can take over and reply in person, and complaints and unclear questions are passed to staff.

The app also sends one private reply to a person who commented on one of the account's posts asking for details, within 7 days of the comment, as Instagram allows.

Primary experience: Automated, with live agent escalation.

## instagram_manage_comments

This app is used only by EATRO for its own Instagram professional account, [@instagram handle].

The app reads comments on the account's own posts and replies to questions about price, opening hours and booking with a short public reply. At most one reply is made per person per post.

Complaints are never answered automatically: staff are alerted and reply in person. Staff can hide spam or abusive comments from the admin panel.

## business_management

This permission is requested only because it is a dependency of `pages_messaging`, `pages_show_list` and `instagram_manage_messages` for a Page owned through a business portfolio. The app makes no other use of it.

---

## Instructions for reviewers

1. Go to https://admin.eatrobd.com and log in with [test login].
2. Open Marketing → Chat Assistant → **Connect** and click **Connect with Facebook**. Approve the permissions for [Page name] and [@instagram handle]. The page then shows the connected Page, the Instagram account and the granted permissions.
3. From a Facebook account that has a role on the app, send "What are your opening hours?" to [Page name] on Messenger. An automated reply arrives within a few seconds, labelled "EATRO Assistant (automated)".
4. Send "How much is a pizza?". The reply quotes prices from the live menu, with photo cards.
5. In admin, open **Inbox**. The conversation is listed. Click **Take over** and type a reply; it reaches the customer, and the assistant stops replying in that conversation.
6. Comment "price?" on any [Page name] post. The Page replies under the comment and sends a private message with the details. The comment appears under **Comments** in admin.
7. Comment "the food was cold". There is no automated reply. Admin shows a complaint alert with a suggested reply for staff to approve.
8. Repeat steps 3 and 6 on [@instagram handle].

Privacy policy: https://eatrobd.com/privacy

Data deletion instructions: https://eatrobd.com/data-deletion
