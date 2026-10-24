module.exports = { URL, URLSearchParams, pathToFileURL: (p) => new URL("file://" + p), fileURLToPath: (u) => decodeURIComponent(new URL(String(u)).pathname) };
