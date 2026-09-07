# Updating the site experience library

## Required evidence

Add a site profile only after observing the live page with the authorized browser controller. Capture:

- domain and route pattern;
- file purpose and accepted MIME/extensions;
- control type from `control-taxonomy.md`;
- stable accessible locator first, CSS locator second;
- exact activation order;
- whether selection stages or auto-sends;
- upload and delivery verification signals;
- failure modes, browser permissions, date, and confidence status.

## Status values

- `verified`: executed successfully and final delivery was confirmed.
- `observed`: control was inspected but upload was not completed.
- `hypothesis`: inferred pattern; never use as proof of success.
- `stale`: page changed or the last verified flow failed.

## Profile update procedure

1. Copy [profile-template.json](profile-template.json) to a temporary JSON file and replace every example value.
2. Give it a unique lowercase `site_id`.
3. Keep locators scoped to the active form/editor and prefer accessible attributes.
4. Set `last_verified` to an ISO date only when delivery was actually confirmed.
5. Validate without writing:

   ```bash
   python3 scripts/site_profiles.py upsert --profile ./profile.json --dry-run
   ```

6. Upsert and validate:

   ```bash
   python3 scripts/site_profiles.py upsert --profile ./profile.json
   python3 scripts/site_profiles.py validate
   ```

Never remove older failure notes merely because a new locator works; they prevent regressions. Replace secrets, user identifiers, and local file paths with neutral placeholders.
