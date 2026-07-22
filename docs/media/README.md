# Dumka Mail media kit

Every image in this directory was captured from the isolated marketing demo. The demo uses fictional names, reserved `.example` email addresses, and synthetic mail, calendar, and cleanup data. It does not initialize Electron, read the app database, use Keychain credentials, or connect to Gmail.

## Asset selection

| Asset | Size | Recommended use |
| --- | ---: | --- |
| `dumka-inbox.png` | 1920×1080 | Primary README image and landing-page product hero |
| `dumka-product-tour.gif` | 960×540 | Short README and landing-page overview |
| `dumka-today.png` | 1920×1080 | Landing section for Daily Briefing, Reply Pipeline, and Review Queue |
| `dumka-calendar.png` | 1920×1080 | Landing section for Calendar and read-only availability search |
| `dumka-cleanup.png` | 1920×1080 | Landing section for local Privacy & Cleanup review |
| `dumka-social-preview.png` | 1280×640 | GitHub repository social preview and link cards |

For GitHub, keep `dumka-inbox.png` as the first README image and `dumka-product-tour.gif` under the status summary. Upload `dumka-social-preview.png` from the repository settings when configuring the social preview.

## Safe recapture

Start the browser-only demo:

```bash
npm run dev:marketing -- --port 4173 --strictPort
```

The capture routes are:

```text
http://127.0.0.1:4173/?scene=inbox
http://127.0.0.1:4173/?scene=today
http://127.0.0.1:4173/?scene=calendar
http://127.0.0.1:4173/?scene=cleanup
http://127.0.0.1:4173/?scene=cover
```

Use a 1920×1080 viewport for product screenshots and 1280×640 for the social preview. Keep the `Demo · synthetic` badge visible. Do not replace the demo content with a local mailbox or capture the installed app for public assets.
