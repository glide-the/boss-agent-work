# File-upload control taxonomy

Use the first matching type. A site can combine types, such as a rich editor whose toolbar trigger wraps a hidden input.

| Type | Recognition signals | Preferred operation | Common failure |
| --- | --- | --- | --- |
| `native-visible-input` | Visible `<input type=file>` with accessible name | Click input, handle chooser, set files | Locator targets a decorative button instead |
| `label-for-input` | Visible `<label for=id>` controls hidden input | Wait for chooser, click label, set files | Clicking hidden input times out |
| `hidden-input-wrapped-trigger` | Hidden input is nested inside button/icon/label | Wait for chooser, click visible ancestor, set files | Generic text or inner button is not actionable |
| `custom-trigger-filechooser` | Button opens native chooser; input may be created dynamically | Wait for chooser before clicking trigger | Listener starts after click and misses event |
| `drag-drop-zone` | Dropzone text, drag affordance, no stable chooser | Prefer site-supported chooser trigger; use drag/drop only if controller supports it | Synthetic drop is blocked or uploads zero bytes |
| `rich-editor-attachment` | Paperclip/image icon in chat/editor toolbar | Scope locator to active editor, then chooser flow | Upload lands in wrong composer or draft |
| `iframe-contained` | Upload control appears inside iframe snapshot | Enter the verified frame, then classify inner control | Top-level locator never sees control |
| `shadow-dom-contained` | Web component hosts upload UI | Use controller-supported shadow-aware locator | DOM assumptions break across component versions |
| `cloud-picker` | Opens Drive/OneDrive/site asset picker instead of OS chooser | Follow picker workflow and verify selected asset | Treating picker as local file input |
| `mobile-system-picker` | Mobile web invokes camera/photo/document picker | Use supported mobile/system flow | Desktop selectors do not apply |

## Inspection order

1. Read the accessibility snapshot for names such as Upload, Attach, Choose File, image, resume, or paperclip.
2. Count `input[type=file]` elements and inspect `accept` and `multiple`.
3. Inspect the input's accessible parent or label before trying a generic text locator.
4. Determine whether the input is persistent, dynamically created, or inside an iframe/shadow root.
5. Determine whether file selection auto-sends, stages a preview, or requires a separate Submit/Send action.

## Verification ladder

Use the strongest available evidence:

1. Delivery status or server-confirmed attachment record.
2. Submitted message/post/form containing filename or image card.
3. Completed upload progress plus stable attachment preview.
4. Temporary thumbnail or filename only.
5. File chooser opened only — insufficient for success.
