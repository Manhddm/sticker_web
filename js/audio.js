/* Audio engine: decodes real OGG music/voice clips from PO.AudioClips when present, with WebAudio synth fallback. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  var peelNode = null, peelGain = null, peelFilter = null;
  var opts = { sound: true, music: true };
  var musicTimer = 0, musicStep = 0, musicKey = 0, musicOn = false;
  var decoded = {}, decoding = {}, bgmNode = null;

  function b64ToBuf(dataUri) {
    var b64 = dataUri.split(',')[1];
    var bin = root.atob ? root.atob(b64) : '';
    var len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function loadClip(name, onReady) {
    if (!ctx || !PO.AudioClips || !PO.AudioClips[name]) return null;
    if (decoded[name]) return decoded[name];
    if (decoding[name]) return null;
    decoding[name] = true;
    try {
      ctx.decodeAudioData(b64ToBuf(PO.AudioClips[name]), function (buf) {
        decoded[name] = buf;
        if (onReady) onReady(buf);
      }, function () { /* fallback to synth */ });
    } catch (e) { /* fallback to synth */ }
    return null;
  }
  function preloadClips() {
    if (!PO.AudioClips) return;
    Object.keys(PO.AudioClips).forEach(function (k) {
      loadClip(k, k === 'bgm' ? function () { updateMusic(); } : null);
    });
  }
  function playClip(name, vol, rate, delay) {
    if (!ensure() || !opts.sound) return false;
    var buf = decoded[name];
    if (!buf) { loadClip(name); return false; }
    var s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf;
    if (rate) s.playbackRate.value = rate;
    g.gain.value = vol === undefined ? 0.85 : vol;
    s.connect(g); g.connect(sfxBus);
    s.start(ctx.currentTime + (delay || 0));
    return true;
  }

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended' && !document.hidden) ctx.resume(); return true; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createDynamicsCompressor(); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = opts.sound ? 0.95 : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = opts.music ? 0.2 : 0; musicBus.connect(master);
    var len = ctx.sampleRate * 1.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var ch = noiseBuf.getChannelData(0);
    /* Sparse crackle over a noise bed: this is what makes vinyl peeling sound like vinyl. */
    for (var i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (Math.random() < 0.12 ? 1 : 0.32);
    preloadClips();
    updateMusic();
    return true;
  }
  function tone(freq, t0, dur, vol, type, bus, slideTo) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function burst(t0, dur, vol, freq, q, type) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.02);
  }

  var A = {
    unlock: function () { ensure(); },
    configure: function (o) {
      opts.sound = o.sound; opts.music = o.music;
      if (ctx) { sfxBus.gain.value = opts.sound ? 0.95 : 0; musicBus.gain.value = opts.music ? 0.2 : 0; }
      updateMusic();
    },
    /* Continuous peel noise while the finger drags. `speed` is px per second. */
    peelStart: function () {
      if (!ensure() || peelNode) return;
      peelNode = ctx.createBufferSource(); peelNode.buffer = noiseBuf; peelNode.loop = true;
      peelFilter = ctx.createBiquadFilter(); peelFilter.type = 'bandpass'; peelFilter.frequency.value = 1800; peelFilter.Q.value = 0.8;
      peelGain = ctx.createGain(); peelGain.gain.value = 0;
      peelNode.connect(peelFilter); peelFilter.connect(peelGain); peelGain.connect(sfxBus);
      peelNode.start();
    },
    peelMove: function (speed) {
      if (!peelNode) return;
      var v = Math.min(1, speed / 900), t = ctx.currentTime;
      peelGain.gain.setTargetAtTime(0.03 + v * 0.42, t, 0.02);
      peelFilter.frequency.setTargetAtTime(1200 + v * 4200, t, 0.03);
    },
    peelEnd: function () {
      if (!peelNode) return;
      var n = peelNode, g = peelGain, t = ctx.currentTime;
      g.gain.setTargetAtTime(0, t, 0.02);
      n.stop(t + 0.12);
      peelNode = null; peelGain = null; peelFilter = null;
    },
    rip: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      burst(t, 0.16, 0.56, 2800, 0.85);
      burst(t + 0.04, 0.12, 0.36, 5200, 1.1, 'highpass');
      tone(360, t, 0.11, 0.14, 'triangle', sfxBus, 920);
    },
    /* A tap peel: a short crackle that climbs as the flap lifts. The pop comes from detach when it lets go. */
    peelTap: function () {
      if (!ensure()) return;
      var t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true;
      f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(5600, t + 0.11);
      g.gain.setValueAtTime(0.06, t); g.gain.linearRampToValueAtTime(0.45, t + 0.09); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      s.connect(f); f.connect(g); g.connect(sfxBus);
      s.start(t, Math.random()); s.stop(t + 0.16);
    },
    detach: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      burst(t, 0.08, 0.48, 3800, 1.3);
      tone(290, t, 0.085, 0.24, 'sine', sfxBus, 960);
      tone(580, t + 0.015, 0.075, 0.14, 'triangle', sfxBus, 1280);
    },
    /* Helper sounds. Stitch: a needle tick per stitch, i climbs. Relief: a soft breath out. */
    stitch: function (i) { if (!ensure()) return; var t = ctx.currentTime; tone(1100 * Math.pow(2, i * 2 / 12), t, 0.05, 0.1, 'triangle'); burst(t, 0.02, 0.12, 4200, 2); },
    relief: function () { if (!ensure()) return; var t = ctx.currentTime; burst(t, 0.45, 0.3, 900, 0.6, 'lowpass'); tone(660, t + 0.05, 0.4, 0.07, 'sine', sfxBus, 440); },
    /* Magnet: a rising electric hum, then a metal clack per sticker that hits it. */
    hum: function (dur) {
      if (!ensure()) return;
      var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(190, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
    },
    clack: function (i) { if (!ensure()) return; var t = ctx.currentTime; tone(1500 + i * 180, t, 0.06, 0.12, 'square', sfxBus, 900); burst(t, 0.05, 0.3, 5200, 3, 'highpass'); },
    /* Shuffle: a gust of wind, then quick paper flicks as stickers land. */
    wind: function (dur) {
      if (!ensure()) return;
      var t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true;
      f.type = 'bandpass'; f.Q.value = 0.7; f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(1300, t + dur * 0.5); f.frequency.exponentialRampToValueAtTime(450, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.02);
    },
    flick: function () { if (!ensure()) return; burst(ctx.currentTime, 0.025, 0.22, 3000 + Math.random() * 1500, 1.5); },
    thud: function () { if (!ensure()) return; var t = ctx.currentTime; tone(150, t, 0.16, 0.3, 'sine', sfxBus, 80); burst(t, 0.04, 0.2, 500, 1); },
    snapBack: function () { if (!ensure()) return; var t = ctx.currentTime; burst(t, 0.05, 0.28, 900, 1.5); },
    stick: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      tone(175, t, 0.12, 0.44, 'sine', sfxBus, 52);
      tone(680, t, 0.045, 0.22, 'triangle', sfxBus, 240);
      burst(t, 0.036, 0.34, 2400, 1.3);
      tone(1480, t + 0.015, 0.075, 0.09, 'sine', sfxBus, 1860);
    },
    clear: function (combo) {
      if (!ensure()) return;
      var t = ctx.currentTime, base = 523.25 * Math.pow(2, Math.min(combo, 8) * 2 / 12);
      tone(145, t, 0.14, 0.36, 'sine', sfxBus, 52);
      burst(t, 0.075, 0.32, 3600, 1.1);
      [1, 1.25, 1.5, 2].forEach(function (m, i) {
        tone(base * m, t + i * 0.045, 0.32, 0.22, 'triangle');
        tone(base * m * 2, t + i * 0.045, 0.18, 0.08, 'sine');
      });
      if (combo >= 2) {
        var praiseClips = ['nice', 'good', 'great', 'awesome', 'amazing', 'excellent', 'fantastic', 'perfect', 'legendary'];
        playClip(praiseClips[Math.min(praiseClips.length - 1, combo - 2)], 0.92, 1, 0.08);
      }
    },
    coin: function () { if (!ensure()) return; if (!playClip('coin', 0.85)) { var t = ctx.currentTime; tone(1320, t, 0.07, 0.09, 'square'); tone(1760, t + 0.06, 0.16, 0.08, 'square'); } },
    click: function () { if (!ensure()) return; var t = ctx.currentTime; tone(820, t, 0.045, 0.14, 'triangle', sfxBus, 540); },
    shutter: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      burst(t, 0.045, 0.65, 4400, 1.4, 'highpass');
      tone(1800, t, 0.035, 0.22, 'triangle', sfxBus, 820);
      burst(t + 0.065, 0.06, 0.56, 3400, 1.2, 'highpass');
      tone(1200, t + 0.065, 0.045, 0.18, 'triangle', sfxBus, 560);
      tone(1568, t + 0.14, 0.28, 0.14, 'sine', sfxBus);
      tone(2093, t + 0.18, 0.32, 0.12, 'sine', sfxBus);
    },
    deny: function () { if (!ensure()) return; var t = ctx.currentTime; tone(170, t, 0.13, 0.2, 'triangle', sfxBus, 120); },
    warn: function () { if (!ensure()) return; var t = ctx.currentTime; tone(420, t, 0.09, 0.13, 'sine'); tone(420, t + 0.13, 0.09, 0.13, 'sine'); },
    power: function () { if (!ensure()) return; var t = ctx.currentTime; tone(330, t, 0.3, 0.14, 'sawtooth', sfxBus, 1320); burst(t, 0.2, 0.2, 5000, 0.6); },
    zap: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      burst(t, 0.28, 0.45, 3800, 1.4, 'bandpass');
      tone(220, t, 0.24, 0.18, 'sawtooth', sfxBus, 1480);
      [880, 1174, 1568, 2093].forEach(function (f, i) { tone(f, t + 0.04 + i * 0.045, 0.18, 0.12, 'triangle'); });
    },
    magic: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      [587.33, 783.99, 987.77, 1174.66, 1567.98, 1975.53].forEach(function (f, i) {
        tone(f, t + i * 0.042, 0.34, 0.14, 'triangle');
        tone(f * 2, t + i * 0.042, 0.18, 0.05, 'sine');
      });
      burst(t, 0.25, 0.18, 6500, 1.8, 'highpass');
    },
    vacuum: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      burst(t, 0.48, 0.42, 950, 0.9, 'bandpass');
      tone(180, t, 0.38, 0.16, 'sine', sfxBus, 860);
      tone(920, t + 0.32, 0.12, 0.18, 'triangle', sfxBus, 1540);
    },
    glue: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      tone(310, t, 0.14, 0.18, 'sine', sfxBus, 680);
      tone(480, t + 0.08, 0.12, 0.2, 'triangle', sfxBus, 1120);
      burst(t + 0.06, 0.08, 0.32, 2800, 1.5);
    },
    scratch: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      burst(t, 0.16, 0.35, 4800, 1.2, 'highpass');
      tone(1046, t + 0.05, 0.18, 0.12, 'triangle', sfxBus, 1568);
    },
    win: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      playClip('wonderful', 0.95, 1, 0.16);
      tone(130.81, t, 0.55, 0.26, 'sine');
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach(function (f, i) {
        tone(f, t + i * 0.075, 0.45, 0.2, 'triangle');
        tone(f * 2, t + i * 0.075, 0.25, 0.06, 'sine');
      });
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f) { tone(f, t + 0.48, 0.75, 0.14, 'triangle'); });
      burst(t + 0.45, 0.25, 0.22, 5200, 0.9, 'highpass');
    },
    blip: function (i) { if (!ensure()) return; var st = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21][i % 10]; tone(620 * Math.pow(2, st / 12), ctx.currentTime, 0.07, 0.05, 'triangle', sfxBus); },
    star: function (i) {
      if (!ensure()) return;
      var t = ctx.currentTime, f = 880 * Math.pow(1.26, i);
      tone(f, t, 0.28, 0.18, 'triangle');
      tone(f * 2, t, 0.18, 0.07, 'sine');
    },
    lose: function () {
      if (!ensure()) return;
      if (playClip('lose', 0.9)) return;
      var t = ctx.currentTime;
      [392, 349, 311, 262].forEach(function (f, i) { tone(f, t + i * 0.14, 0.32, 0.14, 'triangle'); });
    },
    setMusicKey: function (album) { musicKey = album % 6; },
    setPlaying: function (on) { musicOn = on; updateMusic(); }
  };

  /* Upbeat tropical groove: uses BGM clip when decoded, with upbeat synth fallback. */
  var ROOTS = [261.63, 293.66, 246.94, 220, 196, 233.08];
  var SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  var MELODY = [4, -1, 5, 7, 4, -1, 2, 4, 5, -1, 7, 6, 4, 2, 0, -1];
  function stopBgm() {
    if (bgmNode) { try { bgmNode.stop(); } catch (e) {} bgmNode = null; }
  }
  function updateMusic() {
    clearTimeout(musicTimer);
    if (!ctx || !opts.music || !musicOn || document.hidden) { stopBgm(); return; }
    if (decoded.bgm) {
      if (!bgmNode) {
        bgmNode = ctx.createBufferSource();
        bgmNode.buffer = decoded.bgm;
        bgmNode.loop = true;
        bgmNode.connect(musicBus);
        bgmNode.start();
      }
      return;
    }
    if (PO.AudioClips && PO.AudioClips.bgm) loadClip('bgm', updateMusic);
    musicTimer = setTimeout(musicTick, 100);
  }
  function musicTick() {
    if (!ctx || !opts.music || !musicOn || document.hidden) return;
    var t = ctx.currentTime + 0.04, root_ = ROOTS[musicKey], step = musicStep++, bar = Math.floor(step / 16) % 4;
    var chordRoot = bar === 1 ? -3 : bar === 2 ? -5 : bar === 3 ? -7 : 0;
    var bassFreq = root_ / 2 * Math.pow(2, chordRoot / 12);
    if (step % 16 === 0) {
      [0, 4, 7].forEach(function (st) { tone(bassFreq * Math.pow(2, st / 12), t, 1.9, 0.12, 'sine', musicBus); });
    }
    if (step % 4 === 0) {
      tone(bassFreq, t, 0.22, 0.34, 'triangle', musicBus, bassFreq * 0.96);
      if (step % 8 === 0) tone(95, t, 0.09, 0.26, 'sine', musicBus, 42);
    } else if (step % 2 === 1) {
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true;
      f.type = 'highpass'; f.frequency.value = 5400;
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      s.connect(f); f.connect(g); g.connect(musicBus);
      s.start(t, Math.random()); s.stop(t + 0.05);
    }
    var mIdx = MELODY[step % 16];
    if (mIdx >= 0 || (step % 2 === 0 && Math.random() < 0.35)) {
      var note = SCALE[mIdx >= 0 ? mIdx : Math.floor(Math.random() * SCALE.length)];
      var mf = root_ * Math.pow(2, note / 12);
      tone(mf, t, 0.26, mIdx >= 0 ? 0.32 : 0.18, 'triangle', musicBus);
      if (mIdx >= 4) tone(mf * 1.5, t, 0.18, 0.09, 'sine', musicBus);
    }
    musicTimer = setTimeout(musicTick, 190);
  }
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else { ctx.resume(); updateMusic(); }
  });

  PO.Audio = A;
})(window);
