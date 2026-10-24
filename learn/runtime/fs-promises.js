// node:fs/promises 的替身（课内后端个别地方用到）
module.exports = require("./memfs.js").promises;
