---
name: boss-send-resume-button
description: Send a selected attachment resume through a formal BOSS直聘 “求简历” request card. Use when the user asks to click the BOSS resume-request button, agree to an attachment-resume request, send a named resume version such as ink_memory_v5, or wants a button-only resume action without sending any chat reply.
---

# BOSS Send Resume Button

Use the Codex Chrome plugin (`@chrome-dev` / `node_repl`) exclusively. Perform only the formal-card button path; never type or send a chat message.

## Required input

- Target conversation identity: recruiter name and job title when available.
- Resume filename keyword. Default to `ink_memory_v5` only when the user has not supplied another version.

## Workflow

1. Connect to the authorized Chrome plugin. Stop if Chrome is unavailable, uncontrollable, logged out, or showing a security challenge. Do not fall back to Playwright, Selenium, Puppeteer, browser CLI, Computer Use, or JavaScript injection outside the plugin.
2. Open or use `https://www.zhipin.com/web/geek/chat` through `@chrome-dev`.
3. Read the current conversation and verify recruiter name and job title against the intended target. Stop on mismatch.
4. Import `scripts/send-resume.mjs` in `node_repl`.
5. Call `inspectFormalResumeRequest(tab)`. Continue only when it returns `ok: true` and the actionable card contains buttons whose exact texts include both `拒绝` and `同意`.
6. Call `sendRequestedResume(tab, resumeKeyword)`.
7. Report success only when the result is `step: "done"`, `ok: true`, and the returned system messages contain `已发送给Boss`.

## Hard safety rules

- Do not use the toolbar “发简历” button.
- Do not act on a plain text request such as “方便发一份简历吗”; a formal request card must exist.
- Click only the button whose trimmed text is exactly `同意`, resolved by card-group index and button index. Never use fuzzy `hasText` matching.
- Search actionable cards from newest to oldest and act on only one card.
- After clicking, stop immediately if the conversation contains `您已拒绝向对方发送简历`.
- Select only a resume whose displayed filename contains the requested keyword. Stop if zero or multiple versions match.
- Do not type into the message editor, press Enter, call any message-sending helper, or send follow-up wording.
- Do not claim success from the click alone; require the BOSS system confirmation.

## Example

```js
var resumeButton = await import("/Users/dmeck/.codex/skills/boss-send-resume-button/scripts/send-resume.mjs");
var preflight = await resumeButton.inspectFormalResumeRequest(tab);
if (!preflight.ok) throw new Error(preflight.detail);
var result = await resumeButton.sendRequestedResume(tab, "ink_memory_v5");
nodeRepl.write(JSON.stringify(result));
```
