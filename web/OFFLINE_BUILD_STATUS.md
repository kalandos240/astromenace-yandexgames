# Fast offline web build

- Status: **SUCCESS**
- Run ID: 31525990561
- Commit: b70d5d53bc04884a942fe3764985c6c855d7321e
- Complete RU/EN VFS bytes: **88421572**
- Gzip VFS bytes: **52002182**
- Uncompressed dist bytes: **74520528**
- Engine `index.js` bytes: **5111356**
- Compressed `gamedata.js` bytes: **69337513**
- Separate `.data`: **NO**
- Separate `.wasm`: **NO**
- Direct `file://` packaging: **YES**
- Complete RU/EN VFS: **YES**
- Streamed VFS write offset fix: **YES**
- VFS size/header validation before `main()`: **YES**
- Local save fallback when IDBFS is not linked: **localStorage**
- Cloud save merge: **newest local/cloud progress**
- Interstitial cadence: **120 seconds, safe points only, never active gameplay**

The Actions job itself was marked failed only because its final status-marker push raced with the branch. The build and artifact upload steps completed successfully.