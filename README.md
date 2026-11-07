# We Are Called to Care website

Static site for wearecalledtocare.com, hosted on Netlify (organization Netlify account).

- `index.html`: the whole site (pages are shown by the address after `#`, e.g. `/#therapy`).
- `assets/`: logos, photos, the 2027 sponsor packet.
- Folders like `sponsor/`, `christmas/`, `therapy/`: short links and old Showit addresses that forward to the new pages.
- `netlify.toml`, `_redirects`, `404.html`: Netlify settings.

Every push to `main` deploys. Batch changes into one push to save Netlify credits.
