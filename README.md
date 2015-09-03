# Dexie/IndexedDB Upgrade Test

Chrome extension for testing memory usage during upgrade for IndexedDB.

## Development

### Building/Updating the Extension

`gulp build` or `gulp watch`.

References to assets using `chrome.extension.getURL` can assume the same relative location as in the `src` directory.

Dependencies are resolved by browserify at compile-time, but the assets that may be required for those libraries are moved from their respective folders and into the `build` directory. This applies to bootstrap and jQuery-UI, and their CSS has been updated to properly refer to the images in the build directory.

`require` resolution for internal modules is done by specifying the relative location, but third-party dependencies (both in `vendor` and those installed as node modules) can be accessed using aliases defined in `package.json` under the `browser` key. See [browserify-shim](https://github.com/thlorenz/browserify-shim) for more information on this.

### More Information

**Customized Dependencies**

As mentioned below, one reason for having specific dependencies included in the extension is because they required changes before use. Those changes are documented here:

* Bootstrap (3.2.0): CSS compiled so that any and all changes are scoped to `.bootstrap-container`. The URLs for font assets are substituted to use `chrome-extension://__MSG_@@extension_id__/`, which enables Chrome to resolve the files even thought the CSS files are injected as content-scripts.
* jQuery-UI (1.11.4): CSS scoped to `.jquery-ui-container` and image resource references changed similar to the above.
* FileSaver: No changes, just easier to shim than using the bower module.
* spinkit: No changes.
* Whammy: No changes, just needed to shim.

**Extension File Organization**:

* **build/**: This is the directory that the extension gets built to. Subdirectories `dev` and `release` are the targets for the development and production builds, respectively.
* **src/**: Main source files for the extension.
    - **js/**: Files directly under this directory are treated as individual entry points for the browserify build.
        + **modules/**: These files are disregarded by the build process (it's assumed that they'll be required by the top-level js files).
    - **schemas/**: Holds the JSON-Schema files for the main replay file format. This also mirrors, for the most part, the format of the replays as they exist in the IndexedDB document store within the extension.
* **vendor/**: Third-party libraries that either don't have a proper module, or which required customization. Subdirectories other than `js` are copied to the `build` directory on build.

For CSS files injected as content scripts, ensure that referenced resources are prepended with `chrome-extension://__MSG_@@extension_id__/`, and listed under `web_accessible_resources` in the manifest.
