# Browser preference

Use real Microsoft Edge for all browser work in this repository: websites,
documentation, screenshots, form probes and rendered checks. The user explicitly
requires Edge always. Never fall back to another browser after a failure.

The site-audit scripts must select Playwright channel `msedge`. A custom binary
must identify itself as Microsoft Edge. The Playwright API namespace used to
control that channel is not permission to launch a different browser.

When Edge cannot be used, report the browser check as blocked and continue only
independent work, such as analysis of files that are actually available. Do not
claim that a local OneDrive folder is accessible from a cloud session unless its
files have been uploaded, mounted or connected.
