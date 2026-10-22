# Social preview

`turbo-rumble-og.jpg` is a 1200 × 630 JPEG rendered from the repository's HTML/CSS layout in [`scripts/social-card.html`](../../scripts/social-card.html). It combines the existing brand wordmark, locally bundled fonts and the menu's desert illustration. The illustration is promotional AI artwork; its original prompts and model references are documented in [`assets/cinematics/SOURCE.md`](../assets/cinematics/SOURCE.md).

To regenerate, run the development server, open `/scripts/social-card.html`, capture the 1200 × 630 card at its natural size, and encode it as JPEG at quality 90. The card contains no external fonts or remote image requests.
