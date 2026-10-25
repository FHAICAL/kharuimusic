// Queue player engine for KharuiMusic D1.
// The stream resolver is injected from main.js (it owns the InnerTube
// fallback chain + PoToken path). This module owns: queue state, the
// <audio> element, MediaSession (lock-screen controls/metadata), shuffle /
// repeat, auto-advance and radio extension via an injected onNeedMore hook.

export class Player {
  constructor(audio, { resolveStream, onNeedMore, onChange, log }) {
    this.audio = audio;
    this.resolveStream = resolveStream;
    this.onNeedMore = onNeedMore;       // async (currentSong) => songs[]
    this.onChange = onChange || (() => {});
    this.log = log || (() => {});
    this.queue = [];
    this.index = -1;
    this.sourceLabel = '';
    this.shuffle = false;
    this.repeat = 0; // 0 off, 1 all, 2 one
    this.playing = false;
    this.loading = false;
    this.seq = 0;    // cancels stale stream resolutions
    this.extending = false;
    this.order = null;      // shuffle order (array of queue indices) when shuffle is on
    this.retriedFor = null; // videoId already re-resolved once after an error

    audio.addEventListener('play', () => { this.playing = true; this.emit(); });
    audio.addEventListener('pause', () => { this.playing = false; this.emit(); });
    audio.addEventListener('ended', () => this.handleEnded());
    audio.addEventListener('timeupdate', () => this.emitProgress());
    audio.addEventListener('error', () => this.handleError());
    this.setupMediaSession();
  }

  current() { return this.index >= 0 ? this.queue[this.index] : null; }
  emit() { this.onChange(this.state()); }
  emitProgress() {
    const a = this.audio;
    this.onChange({ ...this.state(), progressOnly: true, currentTime: a.currentTime || 0, duration: a.duration || 0 });
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && a.duration > 0) {
      try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate }); } catch {}
    }
  }
  state() {
    return {
      queue: this.queue, index: this.index, current: this.current(),
      playing: this.playing, loading: this.loading,
      shuffle: this.shuffle, repeat: this.repeat, sourceLabel: this.sourceLabel,
      currentTime: this.audio.currentTime || 0, duration: this.audio.duration || 0,
    };
  }

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch {} };
    set('play', () => this.toggle());
    set('pause', () => this.audio.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', e => { if (e.seekTime != null) this.audio.currentTime = e.seekTime; });
    set('seekbackward', e => { this.audio.currentTime = Math.max(0, this.audio.currentTime - (e.seekOffset || 10)); });
    set('seekforward', e => { this.audio.currentTime = Math.min(this.audio.duration || 0, this.audio.currentTime + (e.seekOffset || 10)); });
  }

  updateMediaMetadata(song) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'KharuiMusic',
        artist: (song.byline || '').split('•')[0].trim(),
        album: this.sourceLabel || 'KharuiMusic',
        artwork: song.thumb ? [{ src: song.thumb, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
    } catch {}
  }

  buildOrder(anchor) {
    const rest = this.queue.map((_, i) => i).filter(i => i !== anchor);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this.order = [anchor, ...rest];
  }

  async playQueue(songs, startIndex = 0, sourceLabel = '') {
    this.queue = songs.slice();
    this.sourceLabel = sourceLabel;
    this.order = null;
    if (this.shuffle) this.buildOrder(startIndex);
    await this.playAt(startIndex);
  }

  addToQueue(song, playNext = false) {
    if (!this.queue.length) { this.playQueue([song], 0, 'Antrean'); return; }
    const at = playNext ? this.index + 1 : this.queue.length;
    this.queue.splice(at, 0, song);
    if (this.order) {
      const pos = this.order.indexOf(this.index);
      this.order = this.order.map(v => (v >= at ? v + 1 : v));
      this.order.splice(playNext ? pos + 1 : this.order.length, 0, at);
    }
    this.log(playNext ? `Akan diputar berikutnya: ${song.title}` : `Ditambahkan ke antrean: ${song.title}`);
    this.emit();
  }

  removeFromQueue(i) {
    if (i === this.index || i < 0 || i >= this.queue.length) return;
    this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    this.order = this.shuffle && this.queue.length ? this.order.filter(v => v !== i).map(v => v > i ? v - 1 : v) : null;
    this.emit();
  }

  // ArchiveTune-style recovery: a stream URL can die mid-queue (expiry /
  // network) — re-resolve the same song once before skipping it.
  async handleError() {
    if (!this.audio.src) return;
    const cur = this.current();
    this.log(`Audio error: ${this.audio.error?.message || this.audio.error?.code}`);
    if (!cur || this.loading) return;
    if (this.retriedFor !== cur.videoId) {
      this.retriedFor = cur.videoId;
      this.log('Mencoba resolve ulang stream lagu ini…');
      const seq = ++this.seq;
      try {
        const stream = await this.resolveStream(cur.videoId, { force: true });
        if (seq !== this.seq || !stream?.url) return;
        const t = this.audio.currentTime || 0;
        this.audio.src = stream.url;
        this.audio.currentTime = t;
        await this.audio.play().catch(() => {});
      } catch (e) { this.log(`Resolve ulang gagal: ${e.message}`); }
      return;
    }
    if (this.queue.length > 1) { this.log('Lagu dilewati karena error.'); setTimeout(() => this.next(true), 300); }
  }

  async playAt(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.index = i;
    const song = this.queue[i];
    this.retriedFor = null;
    const seq = ++this.seq;
    this.loading = true; this.emit();
    this.log(`▶ ${song.title || song.videoId}`);
    try {
      const stream = await this.resolveStream(song.videoId);
      if (seq !== this.seq) return; // digantikan permintaan yang lebih baru
      if (!stream?.url) throw new Error('stream tidak ditemukan');
      this.audio.src = stream.url;
      this.updateMediaMetadata(song);
      await this.audio.play().catch(e => {
        if (e?.name !== 'AbortError') throw e;
      });
    } catch (e) {
      this.log(`Gagal memutar ${song.title || song.videoId}: ${e.message} — lanjut ke lagu berikutnya.`);
      if (seq === this.seq && this.queue.length > 1) {
        this.loading = false;
        setTimeout(() => { if (seq === this.seq) this.next(true); }, 400);
      }
    } finally {
      if (seq === this.seq) { this.loading = false; this.emit(); }
    }
  }

  toggle() {
    if (!this.current()) return;
    if (this.audio.paused) this.audio.play().catch(() => {}); else this.audio.pause();
  }

  async next(auto = false) {
    if (!this.queue.length) return;
    if (auto && this.repeat === 2) { this.audio.currentTime = 0; this.audio.play().catch(() => {}); return; }
    let n;
    if (this.order) {
      const pos = this.order.indexOf(this.index);
      n = pos >= 0 && pos + 1 < this.order.length ? this.order[pos + 1] : this.queue.length; // past end => radio/repeat logic below
    } else {
      n = this.index + 1;
    }
    if (n >= this.queue.length) {
      if (this.repeat === 1) n = this.order ? this.order[0] : 0;
      else if (!this.extending && this.onNeedMore) {
        // Radio mode: extend the queue with suggestions for the last song.
        this.extending = true;
        try {
          const more = await this.onNeedMore(this.current());
          const fresh = (more || []).filter(s => !this.queue.some(q => q.videoId === s.videoId));
          if (fresh.length) {
            const oldLen = this.queue.length;
            this.queue.push(...fresh);
            this.log(`Radio: +${fresh.length} lagu saran ditambahkan ke antrean.`);
            if (this.order) {
              const extra = fresh.map((_, k) => oldLen + k);
              for (let i = extra.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [extra[i], extra[j]] = [extra[j], extra[i]]; }
              this.order.push(...extra);
              n = this.order[this.order.indexOf(this.index) + 1];
            } else n = this.index + 1;
          }
        } catch (e) { this.log(`Radio gagal: ${e.message}`); }
        this.extending = false;
        if (n == null || n >= this.queue.length) { this.emit(); return; }
      } else return;
    }
    await this.playAt(n);
  }

  async prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 4) { this.audio.currentTime = 0; return; }
    let n;
    if (this.order) {
      const pos = this.order.indexOf(this.index);
      n = pos > 0 ? this.order[pos - 1] : -1;
    } else n = this.index - 1;
    if (n < 0) { this.audio.currentTime = 0; return; }
    await this.playAt(n);
  }

  handleEnded() {
    if (this.repeat === 2) { this.audio.currentTime = 0; this.audio.play().catch(() => {}); return; }
    this.next(true);
  }

  seekToFraction(f) {
    const d = this.audio.duration;
    if (d > 0) this.audio.currentTime = f * d;
  }
  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.shuffle && this.queue.length) this.buildOrder(this.index >= 0 ? this.index : 0);
    else this.order = null;
    this.emit();
  }
  cycleRepeat() { this.repeat = (this.repeat + 1) % 3; this.emit(); }
}
