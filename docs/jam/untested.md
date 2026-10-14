# What we could not test

Jam features or behaviors that the research passes on 2026-10-13 could not exercise, with the reason. Catalogue IDs in brackets. A row marked public doc in `catalogue.md` is untested by definition and appears here.

## Blocked by the VM

| Item | Why |
|---|---|
| Microphone narration, mute and mic switching while recording, voice transcript and captions [J-014, J-074, J-211, J-236] | The VM has no microphone. The mic pill opened a permission tab that closed itself with no message; the bar's mic button stayed greyed. Transcript tools returned an error |
| Camera [J-210] | No camera, and Jam's browser extension shows no camera option anywhere |
| Tab audio in desktop recording | No audio device; Chrome's picker offers a tab-audio switch |
| Global shortcut scope [J-184] | Needs focus outside the browser on the shared display; not tried |
| Mac permission troubleshooting | Linux VM |

## Blocked by the clean-room or account rules

| Item | Why |
|---|---|
| Connected integrations, ticket field forms, the body of a filed issue, the linked-issue record and tracker detection on a recording-link reference, Slack posts and unfurls, Linear and Notion embeds [J-137, J-140, J-141, J-241, J-242], one Jira site per workspace and the workspace picker choosing the connection [J-251] | Finishing a provider's OAuth would change the owner's account; connect pages were opened and left |
| Sending invites, folder share invites, member role change and removal, auto-approve seats [J-122, J-123, J-173, J-222] | One-member workspace; inviting would contact real people |
| Workspace archiving and the 90-day purge, captures kept after a member leaves, archived (deleted) captures staying in storage [J-191, J-249] | No close-workspace control in the UI; testing would need a second member or destroying the owner's workspace; storage is not visible to a user |
| Mentions, the mention picker and the emails they send [J-135] | No second member to mention; typing @ in the draft opened no menu |
| Personal access token creation, list and revoke [J-148] | Would add a credential to the owner's account |
| Workspace rename, logo upload, profile name save, reset invite link, reset extension, delete account [J-225], submitting the create-workspace form [J-221] | Account-level changes the rules ask us to avoid |
| Paid features: workspace-only link access, default link access, longer recordings, private folders and private captures, AI quotas [J-119, J-120, J-156, J-237] | Free plan |
| Enterprise features: SSO, directory sync, audit logs, data retention, forced install [J-178] | Free plan |
| Jam CLI, its read path, agent-made captures, CLI recording, agent skills [J-155, J-244, J-245, J-246, J-247] | Installing them was out of scope for this step; only the settings page was read |
| Webhook delivery [J-142] | Adding an endpoint would need a public receiver; the portal and event catalog were read only |
| Connect your domain, auto-blur, sanitizers [J-143, J-192] | Needs Jam's scripts on a site we own on a public domain; the verify step failed as expected on the lab app |
| Fin and help-desk flows [J-144] | No Intercom or help-desk account |

## Not reached in time or by design

| Item | Why |
|---|---|
| 6 s screenshot delay [J-005] | Assumed to match the 3 s delay |
| Whether the 5:00 cap hard-stops a recording [J-013] | The only long recording ended at 5:21 while in blur mode, so the cause of the stop is unclear |
| Tab switching during a tab-mode recording | Only desktop mode was tested across tabs |
| Binding and using the recording-link command [J-183] | Left unbound |
| Copy and paste of annotation shapes [J-052] | Docs mention it; the keys did nothing in our test |
| Draft attachments [J-082] | Files picked in the chooser never appeared on the capture; unclear whether this is a VM issue |
| AI title from narration | No mic; AI drafts were seen only from video content |
| Video upload by drag [J-020] | Not tried |
| Incognito, local file URLs, emulated mobile viewport [J-021, J-022] | Not tried |
| GraphQL error flags, CORS call-outs, timing breakdown, binary payload placeholders [J-064, J-065, J-066] | The lab app has no GraphQL, CORS failure or binary socket case |
| Sentry, FullStory and LogRocket links [J-076] | No such tools on the lab app |
| Figma embed [J-116] | Not tried |
| Replay setting following the account across browsers and profiles [J-215] | Only one browser profile |
| Shortcut tooltip updating after a rebind [J-212] | Shortcuts were not rebound |
| Empty dashboard state | The workspace already had captures; the empty folder state was seen instead |
| Deleting a folder that still holds captures | Only an empty folder was deleted; docs say its captures go with it |
| Connected state of any integration card | No OAuth completed |
| Recording-link expiry, one-time links, URL parameters [J-126] | Docs and MCP mention them; the popup form showed no such fields |
| Mac and iOS apps [J-023, J-024] | Out of scope (skip list, D-016) |
| Other browsers: Edge, Arc, Brave, Opera, and recording links in Firefox and Safari [J-235] | Only Chromium is installed on the VM |
| Green status dot for a connected recorder domain [J-232] | No domain connected; only the red dot was seen |
| Restricting the extension's site access [J-226] | Would change the shared browser's extension settings; docs only |
| Signing in and the extension's signed-out first run [J-217] | The shared browser stays signed in to the owner's account; only the sign-in page was opened, in an isolated context |
| Close button on a healthy fresh video draft [J-088, J-219] | A reopened draft saved on close; a fresh draft that came back broken at 0 s discarded at once with no confirm or toast. A healthy fresh one was not closed |

## Observed but unexplained

| Item | Note |
|---|---|
| Stop to editor hangs and broken drafts [J-034, J-196] | Over 3 minutes once at a load average near 2 with no editor at all until an extension restart; that draft was intact in the Drafts list (flow M). Separately, 5 of 15 tab recordings opened a broken 0-second draft that stayed broken (one watched for 100 s); 4 of those came in the 6 review-session recordings at load averages of 3 to 10. Whether load, the shared display or the extension causes it is unknown |
| User events stopped after the third history navigation on Nuru | Not reproduced on the lab app |
| Unhandled promise rejections never captured | Consistent across viewer and MCP |
| The pre-capture log buffer seemed to restart after each capture | Inferred from timestamps on one screenshot |
| AI switch default (on for video, off for replay) [J-083] | Public docs say the choice is saved for future captures, and a reopened video draft had it on; whether replay keeps its own default was not checked |
| The draft's AI title sometimes did not appear within 3 minutes | The capture-lab runs got it at once; one trimmed video never did |
