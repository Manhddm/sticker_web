/* All sound is synthesised with WebAudio: no audio files, a small download, and a peel noise that follows the finger. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  var peelNode = null, peelGain = null, peelFilter = null;
  var opts = { sound: true, music: true };
  var musicTimer = 0, musicStep = 0, musicKey = 0, musicOn = false;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended' && !document.hidden) ctx.resume(); return true; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createDynamicsCompressor(); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = opts.sound ? 0.85 : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = opts.music ? 0.16 : 0; musicBus.connect(master);
    var len = ctx.sampleRate * 1.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var ch = noiseBuf.getChannelData(0);
    /* Sparse crackle over a noise bed: this is what makes vinyl peeling sound like vinyl. */
    for (var i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (Math.random() < 0.12 ? 1 : 0.32);
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
      if (ctx) { sfxBus.gain.value = opts.sound ? 0.85 : 0; musicBus.gain.value = opts.music ? 0.16 : 0; }
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
    rip: function () { if (!ensure()) return; var t = ctx.currentTime; burst(t, 0.2, 0.5, 2600, 0.7); tone(320, t, 0.1, 0.08, 'triangle', sfxBus, 700); },
    /* A tap peel: a short crackle that climbs as the flap lifts. The pop comes from detach when it lets go. */
    peelTap: function () {
      if (!ensure()) return;
      var t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true;
      f.type = 'bandpass'; f.Q.value = 1.1; f.frequency.setValueAtTime(1300, t); f.frequency.exponentialRampToValueAtTime(5200, t + 0.13);
      g.gain.setValueAtTime(0.05, t); g.gain.linearRampToValueAtTime(0.4, t + 0.11); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      s.connect(f); f.connect(g); g.connect(sfxBus);
      s.start(t, Math.random()); s.stop(t + 0.18);
    },
    detach: function () { if (!ensure()) return; var t = ctx.currentTime; burst(t, 0.09, 0.42, 3400, 1.2); tone(520, t, 0.09, 0.12, 'triangle', sfxBus, 980); },
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
    /* A helper that cannot work right now: a dull, slightly comic thud. */
    thud: function () { if (!ensure()) return; var t = ctx.currentTime; tone(150, t, 0.16, 0.3, 'sine', sfxBus, 80); burst(t, 0.04, 0.2, 500, 1); },
    snapBack: function () { if (!ensure()) return; var t = ctx.currentTime; burst(t, 0.05, 0.28, 900, 1.5); },
    stick: function () { if (!ensure()) return; var t = ctx.currentTime; tone(190, t, 0.1, 0.32, 'sine', sfxBus, 90); burst(t, 0.03, 0.14, 1400, 1); },
    clear: function (combo) {
      if (!ensure()) return;
      var t = ctx.currentTime, base = 523.25 * Math.pow(2, Math.min(combo, 8) * 2 / 12);
      [1, 1.26, 1.5].forEach(function (m, i) { tone(base * m, t + i * 0.055, 0.32, 0.17, 'triangle'); tone(base * m * 2, t + i * 0.055, 0.14, 0.04, 'sine'); });
    },
    coin: function () { if (!ensure()) return; var t = ctx.currentTime; tone(1320, t, 0.07, 0.09, 'square'); tone(1760, t + 0.06, 0.16, 0.08, 'square'); },
    click: function () { if (!ensure()) return; var t = ctx.currentTime; tone(740, t, 0.05, 0.1, 'triangle', sfxBus, 520); },
    deny: function () { if (!ensure()) return; var t = ctx.currentTime; tone(170, t, 0.13, 0.2, 'triangle', sfxBus, 120); },
    warn: function () { if (!ensure()) return; var t = ctx.currentTime; tone(420, t, 0.09, 0.13, 'sine'); tone(420, t + 0.13, 0.09, 0.13, 'sine'); },
    power: function () { if (!ensure()) return; var t = ctx.currentTime; tone(330, t, 0.3, 0.14, 'sawtooth', sfxBus, 1320); burst(t, 0.2, 0.2, 5000, 0.6); },
    win: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, t + i * 0.09, 0.42, 0.17, 'triangle'); });
      tone(262, t, 0.7, 0.1, 'sine');
    },
    /* A soft pentatonic blip for each pixel painted by the belt; i walks up the scale. */
    blip: function (i) { if (!ensure()) return; var st = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21][i % 10]; tone(620 * Math.pow(2, st / 12), ctx.currentTime, 0.07, 0.05, 'triangle', sfxBus); },
    star: function (i) { if (!ensure()) return; tone(880 * Math.pow(1.26, i), ctx.currentTime, 0.3, 0.16, 'triangle'); },
    lose: function () {
      if (!ensure()) return;
      var t = ctx.currentTime;
      [392, 349, 311, 262].forEach(function (f, i) { tone(f, t + i * 0.14, 0.32, 0.14, 'triangle'); });
    },
    setMusicKey: function (album) { musicKey = album % 6; },
    setPlaying: function (on) { musicOn = on; updateMusic(); }
  };

  /* Soft generative loop: a slow pentatonic marimba over two pad notes. */
  var ROOTS = [261.63, 293.66, 246.94, 220, 196, 233.08];
  var SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  function updateMusic() {
    clearTimeout(musicTimer);
    if (ctx && opts.music && musicOn && !document.hidden) musicTimer = setTimeout(musicTick, 120);
  }
  function musicTick() {
    if (!ctx || !opts.music || !musicOn || document.hidden) return;
    var t = ctx.currentTime + 0.05, root_ = ROOTS[musicKey], step = musicStep++;
    if (step % 16 === 0) {
      var chord = step % 32 === 0 ? [0, 7] : [-3, 4];
      chord.forEach(function (st) { tone(root_ / 2 * Math.pow(2, st / 12), t, 4.2, 0.2, 'sine', musicBus); });
    }
    if (Math.random() < (step % 4 === 0 ? 0.85 : 0.32)) {
      var note = SCALE[Math.floor(Math.random() * SCALE.length)];
      tone(root_ * Math.pow(2, note / 12), t, 0.7, 0.3, 'triangle', musicBus);
    }
    musicTimer = setTimeout(musicTick, 280);
  }
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else { ctx.resume(); updateMusic(); }
  });

  PO.Audio = A;
})(window);
