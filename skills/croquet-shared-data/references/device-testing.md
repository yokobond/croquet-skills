# Testing with a phone or tablet on the LAN

A second real device is the most convincing second client. These points come from testing a Croquet game on an iPad from a Mac running Vite.

## Serving the dev build to the LAN

- Start Vite with `--host 0.0.0.0` (and a fixed `--port --strictPort`) and give the device `http://<mac LAN ip>:<port>/`. Get the IP with `ipconfig getifaddr en0`, and check the address from the Mac with `curl -s -o /dev/null -w '%{http_code}' <url>` before handing it over.
- The camera (AR) and some device APIs need a **secure page**, so keep a second configuration with `@vitejs/plugin-basic-ssl` (`--mode https`). The device shows a certificate warning once ("Show Details → visit this website").
- Keep both an HTTP and an HTTPS server configuration. When something fails only on the device, the HTTP one tells you whether the self-signed certificate is the cause.
- Dev servers started by the agent's preview tooling **can be stopped by the app** between turns. When the user reports "it doesn't work" after a pause, check that the server is still running before debugging the app (`preview_list`, or `curl` the LAN URL).

## What the agent's own browser cannot do

- The in-app browser pane refuses a self-signed certificate (`ERR_CERT_AUTHORITY_INVALID`). Verify page content on the HTTP server; the HTTPS one is only for the device.
- Touch is emulated only at phone widths, and the tablet preset reports `maxTouchPoints === 0`. To test a touch-only path, override `navigator.maxTouchPoints`, `canShare` and `share` with `Object.defineProperty` in the page, and say in the report that this was a stand-in.
- `setPointerCapture` throws for made-up pointer ids. Wrap it in `try`, so that synthetic pointer events in tests (and odd real ones) do not abort the handler.

## iPad / iPhone (Safari) specifics

- **Downloads from a self-signed dev server fail** even after the page was let through, because Safari downloads on a connection of its own. Fetch the file in the page and hand it over from memory. On touch devices use `navigator.share({ files: [file] })` ("Save to Files"), called **synchronously in the tap handler** with a file that was fetched earlier (the share sheet needs the user's gesture). Elsewhere use a `blob:` URL with `<a download>`.
- **`<input type=file accept=".stl">` grays out the file.** iPadOS turns `accept` into the file types it knows, and it has none for many formats (`.stl` among them). On iPad and iPhone, leave `accept` out and turn wrong files away after reading them. Detect iPadOS by `navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1` (it reports itself as a Mac), as well as by `/iPad|iPhone|iPod/` in the user agent.
- Device storage is per device. Content made on the desktop is not on the tablet: test the export/import path to move it, or make it on the device.

## Vite hot reload and Croquet

- Editing the model module while the page is open logs `Registering model class X failed, id "X" already used`, and the later modules fail to hot-reload. This is stale state from the hot reload, not a bug: reload the page. Old console errors stay in the console tool's history, so look at timestamps or log a marker first.
