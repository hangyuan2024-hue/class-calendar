// 捞小智 · 「真人感」声音：GPT-SoVITS（声音组件）照着一段公开录音学着说（不用训练，零样本）
//   录音来自 AISHELL-3（Apache-2.0）里挑好的那一位女声（AI 组件镜像里的 aishell3 包，捞捞声音训练用的同一份），
//   从里面挑一句 3～9 秒、字数适中的当参考；不用任何真人老师、同学的声音
"use strict";
const fs = require("fs");
const path = require("path");
const PPT = (f) => require(path.join(__dirname, "ppt", f));

function wavSecs(f) {
  try { const b = fs.readFileSync(f); const M = PPT("media.js"); return M.readWav(b).seconds; } catch (e) { return 0; }
}
function create(o) {
  const top = () => path.join(o.base(), "tts");
  const REF = () => path.join(top(), "real-ref.json");
  const log = o.log || (() => {});
  let mirror = o.mirror || null, fetching = null;
  const mir = () => { if (!mirror) { try { mirror = PPT("mirror.js").create(o.mirrorOpt || {}); } catch (e) { mirror = { model: async () => [], sources: () => [] }; } } return mirror; };
  function ref() { try { const r = JSON.parse(fs.readFileSync(REF(), "utf8")); return fs.existsSync(r.wav) ? r : null; } catch (e) { return null; } }
  // 从包里挑参考句：选中的那位说话人、8～24 个字、3～9 秒，挑最接近 6 秒的
  function pick(dir) {
    const spk = (fs.readFileSync(path.join(dir, "pick.txt"), "utf8").trim().split(/\s+/)[0]) || "";
    const cands = [];
    for (const ln of fs.readFileSync(path.join(dir, "content.txt"), "utf8").split(/\r?\n/)) {
      const a = ln.trim().split(/\s+/);
      if (a.length < 3 || !a[0].endsWith(".wav") || (spk && !a[0].startsWith(spk))) continue;
      const txt = a.slice(1).filter((x) => !/[A-Za-z0-9%$]/.test(x)).join("");
      const f = path.join(dir, a[0]);
      if (txt.length < 8 || txt.length > 24 || !fs.existsSync(f)) continue;
      cands.push({ wav: f, text: txt + "。" });
      if (cands.length > 60) break;
    }
    let best = null, bd = 1e9;
    for (const c of cands) { const s = wavSecs(c.wav); if (s < 3 || s > 9) continue; const d = Math.abs(s - 6); if (d < bd) { bd = d; best = { ...c, secs: s }; } }
    if (!best) throw new Error("公开录音包里挑不出合适的参考句");
    return best;
  }
  function ensure(say = () => {}) {
    if (ref()) return Promise.resolve(ref());
    if (fetching) return fetching;
    fetching = (async () => {
      fs.mkdirSync(top(), { recursive: true });
      const hit = (await mir().model("aishell3").catch(() => []))[0];
      if (!hit) throw new Error("国内存储里还没有公开录音包（先在 Actions 里运行「AI 组件搬到国内存储」，填 voicedata）");
      const tar = path.join(top(), "aishell3.tar");
      let last = 0;
      say("下载真人感声音的参考录音（公开录音 AISHELL-3）…", { pct: 0 });
      await (o.dl || PPT("dl.js")).download(mir().sources(hit), tar, { want: { size: hit.size, sha256: hit.sha256 }, log,
        onProg: (x) => { if (Date.now() - last < 1000) return; last = Date.now(); const pct = x.total ? Math.min(99, Math.floor((x.got / x.total) * 100)) : null; say(`下载参考录音：${pct}%`, { pct }); } });
      await (o.extract || PPT("installer.js").extract)(tar, top(), {});
      fs.rmSync(tar, { force: true });
      const r = pick(path.join(top(), "aishell3"));
      fs.writeFileSync(REF(), JSON.stringify(r));
      say("真人感声音准备好了", { pct: 100, done: true });
      return r;
    })().finally(() => { fetching = null; });
    return fetching;
  }
  return { ensure, ref, ready: () => !!ref(), pick };
}
module.exports = { create };
