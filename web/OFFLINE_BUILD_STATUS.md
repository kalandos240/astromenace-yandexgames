# Fast offline web build

- Status: **SUCCESS (artifact built and verified)**
- Run ID: `31512884564`
- Build commit: `b14494a2ff00fe145184ecf5d1bf7e670c17af2c`
- Artifact: `astromenace-yandexgames-fast-offline`
- Artifact ID: `9110069351`
- Complete RU/EN VFS bytes: **88421572**
- Gzip VFS bytes: **52002182**
- Uncompressed distribution bytes: **74501227**
- Engine `index.js` bytes: **5092279**
- Compressed `gamedata.js` bytes: **69337513**
- Separate `.data`: **NO**
- Separate `.wasm`: **NO**
- Direct `file://` packaging: **YES**
- Complete RU/EN VFS: **YES**
- Interstitial after successful mission: **YES**

The GitHub Actions job was marked failed only because its final status-file push raced another repository write. The WebAssembly compile, artifact generation, package-size checks, CSP audit, and artifact upload completed successfully. The downloaded artifact was additionally verified by decoding `gamedata.js`, gzip-decompressing the embedded VFS, and confirming the exact expected VFS size.
