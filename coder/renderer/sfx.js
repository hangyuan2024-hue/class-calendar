// 捞捞编程 · 音效：全部用 Web Audio 现场合成（不带音频文件，没有版权问题，也不占安装包）
//   比较：两个音，音高跟着两个数的大小走（数越大音越高，五声音阶，连起来像一段旋律）
//   交换：起跳「嘣」+ 落地「咚」；改值：「嗖」滑到新值的音；排好：一声铃；全部完成：上行琶音 + 闪光；出错：低沉的嗡
"use strict";
(function (root) {
  let ctx = null, master = null, comp = null, noiseBuf = null;
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  let muted = LS.get("lc_sfx_muted", false), volume = LS.get("lc_sfx_vol", 0.55);
  const last = {};   // 同一种声音太密时跳过（播放很快的时候不吵）
  const listeners = new Set();

  function ac() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => {}); return ctx; }
    const C = root.AudioContext || root.webkitAudioContext; if (!C) return null;
    ctx = new C();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = volume * 0.5;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  // 五声音阶（C D E G A），从 C4 往上两个八度
  const PENTA = [0, 2, 4, 7, 9];
  function noteFreq(k) { const o = Math.floor(k / 5), s = PENTA[((k % 5) + 5) % 5]; return 261.63 * Math.pow(2, o + s / 12); }
  // 数值 → 音（在 lo..hi 里按比例放到 0..10 级）
  function pitch(v, lo, hi) { const t = hi > lo ? (v - lo) / (hi - lo) : 0.5; return noteFreq(Math.round(Math.max(0, Math.min(1, t)) * 10)); }

  function tone(f, { t = 0, dur = 0.16, type = "sine", vol = 0.5, attack = 0.005, slide = 0, detune = 0 } = {}) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + t;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.value = detune;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise({ t = 0, dur = 0.2, vol = 0.3, f0 = 800, f1 = 3000, q = 1.2 } = {}) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + t;
    const s = c.createBufferSource(); s.buffer = noiseBuf;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = q; bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.05);
  }
  function bell(f, t = 0, vol = 0.35) { tone(f, { t, dur: 0.9, vol, type: "sine" }); tone(f * 2.76, { t, dur: 0.35, vol: vol * 0.25, type: "sine" }); tone(f * 5.4, { t, dur: 0.18, vol: vol * 0.12, type: "sine" }); }

  const SOUNDS = {
    compare({ a, b, lo, hi }) { tone(pitch(a, lo, hi), { dur: 0.12, type: "triangle", vol: 0.32 }); tone(pitch(b, lo, hi), { t: 0.075, dur: 0.14, type: "triangle", vol: 0.32 }); },
    scan() { tone(1760, { dur: 0.05, vol: 0.06, type: "sine" }); },
    jump({ v, lo, hi }) { const f = pitch(v, lo, hi) * 0.5; tone(f, { dur: 0.22, type: "triangle", vol: 0.38, slide: 2.2 }); noise({ dur: 0.25, vol: 0.12, f0: 500, f1: 2600 }); },
    land() { tone(140, { dur: 0.14, type: "sine", vol: 0.55, slide: 0.45 }); noise({ dur: 0.09, vol: 0.18, f0: 300, f1: 120, q: 0.7 }); },
    duck() { tone(330, { dur: 0.08, type: "sine", vol: 0.12, slide: 0.7 }); },
    slide() { noise({ dur: 0.22, vol: 0.1, f0: 1200, f1: 400 }); },
    morph({ v, lo, hi, up }) { const f = pitch(v, lo, hi); tone(f / (up ? 1.5 : 0.67), { dur: 0.16, type: "square", vol: 0.08, slide: up ? 1.5 : 0.67 }); tone(f, { t: 0.1, dur: 0.18, type: "triangle", vol: 0.22 }); },
    sorted({ v, lo, hi }) { bell(pitch(v, lo, hi) * 2, 0, 0.22); },
    found() { [0, 4, 7].forEach((k, i) => bell(noteFreq(5 + k), i * 0.09, 0.25)); },
    done() { [0, 2, 4, 5, 7, 10].forEach((k, i) => tone(noteFreq(5 + k), { t: i * 0.07, dur: 0.3, type: "triangle", vol: 0.28 })); bell(noteFreq(15), 0.45, 0.3); noise({ t: 0.42, dur: 0.6, vol: 0.06, f0: 4000, f1: 9000, q: 0.5 }); },
    error() { tone(110, { dur: 0.35, type: "sawtooth", vol: 0.18, slide: 0.8 }); tone(116, { dur: 0.35, type: "sawtooth", vol: 0.12, slide: 0.8 }); },
    pop() { tone(880, { dur: 0.07, vol: 0.12, slide: 1.4 }); },
    hello() { tone(noteFreq(7), { dur: 0.1, type: "triangle", vol: 0.2 }); tone(noteFreq(9), { t: 0.09, dur: 0.16, type: "triangle", vol: 0.2 }); },
  };

  const SFX = {
    play(name, opt = {}) {
      if (muted || !SOUNDS[name]) return;
      const now = performance.now(), gap = opt.gap != null ? opt.gap : 55;
      if (last[name] && now - last[name] < gap) return;
      last[name] = now;
      try { SOUNDS[name](opt); } catch (e) {}
    },
    get muted() { return muted; },
    setMuted(m) { muted = !!m; LS.set("lc_sfx_muted", muted); for (const f of listeners) f(muted); if (!muted) { ac(); SFX.play("pop"); } },
    toggle() { SFX.setMuted(!muted); return muted; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); LS.set("lc_sfx_vol", volume); if (master) master.gain.value = volume * 0.5; },
    unlock() { ac(); },
    pitch,
  };
  // 浏览器要求「用户点过一下」才能出声：第一次点击时解锁
  if (typeof document !== "undefined") document.addEventListener("pointerdown", () => SFX.unlock(), { once: true, capture: true });
  root.LaoSfx = SFX;
})(typeof window !== "undefined" ? window : globalThis);
