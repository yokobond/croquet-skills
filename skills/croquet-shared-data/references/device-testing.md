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

## Reload instead of Vite hot reload

Croquet cannot take a module swapped in under a running session. Re-running the model module logs `Registering model class X failed, id "X" already used` (and later modules then fail to hot-reload); re-running the session module loses the session. The views were built for the old model code, and the other devices are still running the old code. So when testing with several devices, do not rely on Vite's HMR: reload the page, and let every device join the same session again. Two pieces do this:

1. **Full reload for anything that reaches the model or the session.** A Vite plugin's `hotUpdate` hook walks up from the changed modules through their importers. If it reaches the model/session modules, it sends `full-reload` instead of a hot update. UI-only changes keep fast refresh.

   ```ts
   // vite.config.ts
   import type { EnvironmentModuleNode, Plugin } from 'vite';

   const croquetFullReload: Plugin = {
     name: 'croquet-full-reload',
     apply: 'serve',
     hotUpdate({ modules }) {
       if (this.environment.name !== 'client') return;
       const seen = new Set<EnvironmentModuleNode>();
       const reachesCroquet = (mod: EnvironmentModuleNode): boolean => {
         if (seen.has(mod)) return false;
         seen.add(mod);
         if (mod.file && /[\\/]src[\\/]net[\\/]/.test(mod.file)) return true; // model + session modules
         return [...mod.importers].some(reachesCroquet);
       };
       if (!modules.some(reachesCroquet)) return;
       this.environment.hot.send({ type: 'full-reload' });
       return [];
     },
   };
   ```

2. **While online, reload on any update.** In the session module, reload the page before Vite applies any hot update. The invite link (`?q=…#pw=…`) stays in the URL, so every device on the dev server reloads and joins the same session again (a new one if the model code changed, see "A changed model is a new session").

   ```ts
   // session module
   import.meta.hot?.on('vite:beforeUpdate', () => {
     if (session || joining) location.reload();
   });
   ```

A device that was not served by this dev server (a deployed build, another machine's dev server) does not reload: reload it by hand. Old console errors stay in the console tool's history across reloads, so look at timestamps or log a marker first.

Another way is a hot reload of your own that knows about Croquet, as Microverse does (it reloads behavior code inside the running session). That is a bigger piece of work; reloading the page is enough for most apps.
