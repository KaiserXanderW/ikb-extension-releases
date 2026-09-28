# ikb-extension-releases

Release channel for the Workflow Knowledge Base browser extension
(add-on ID `ikb@interactive-knowledge-base.local`).

**This repository is written by the GitHub Action in the private repo
`interactive-knowledge-base`. Do not edit it by hand.**

It holds only:

- `xpi/` — Mozilla-signed (unlisted) `.xpi` builds of the extension.
- `updates.json` — Firefox's self-hosted update manifest. Installed copies of
  the extension poll it and install new versions from `xpi/`.

It contains no workflow data. Data is loaded separately in the extension's
options page.
