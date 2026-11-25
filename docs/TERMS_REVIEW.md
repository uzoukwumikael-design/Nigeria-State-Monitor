# Publisher terms: what was found (14–17 November 2026)

This is research, not legal advice. Only terms pages that came up in searches were read; most publishers' pages could not be reached.

## What the pages say

- **Premium Times**: its terms prohibit reproduction, modification, distribution or republication of its content without prior written consent.
- **Punch**: article pages carry a notice that the material may not be reproduced, published, broadcast, rewritten or redistributed, in whole or in part, without Punch's written permission. Punch also publishes an RSS feed with tracking-tagged links, which suggests feeds are offered for readers, not as a licence to republish.
- **ThisDay**: its terms cover reader submissions (they may appear in its feeds and APIs); they do not grant a republishing licence for its articles.
- **Another national TV outlet's site** says the same as Premium Times: reproduction, distribution and derivative works need written permission.
- **Not found:** the terms of Channels, Vanguard, Daily Trust, BusinessDay, Tribune, Daily Post, Leadership and the rest.
- A marketplace now sells **licensed** publisher content to AI agents, which shows publishers expect to be paid for machine use.

## What this means

No publisher found grants a licence to republish excerpts. So the **publisher text** on the site is the exposure, more than the headline and link.

## What the platform does about it

1. **No publisher text is published by default.** An event's summary is its headline; evidence shows outlet name, headline and link only. `PUBLISHED_EXCERPT_CHARS` (0–400, default 0) raises the limit once you have permission. It applies when publishing and when reading, so already-stored records are covered too.
2. Excerpts are still read internally to sort articles; they are not shown.
3. robots.txt is obeyed, every event links to the publisher, and a source can be removed at once with `INGESTION_DISABLE=slug`.

## What you should do

- Ask your most important publishers for written permission or a licence (Premium Times, Punch, Channels, Vanguard, Daily Trust first). A short email naming what you show (headline, outlet, link, and perhaps 160 characters) is a normal request.
- Get a Nigerian media or IP lawyer to review the position before you charge for the product or promote it widely.
- Keep `PUBLISHED_EXCERPT_CHARS` at 0 until permission is in writing.
