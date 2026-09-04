import { useEffect, useMemo, useState } from 'react';
import { Bluetooth, CalendarPlus, Disc3, Library, Play, Radio, RadioTower, Square, Trash2, Volume2, X } from 'lucide-react';

const dayNames = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
const fullDayNames = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const allDays = Object.keys(dayNames);

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

function formatTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute));
}

function SpeakerStatus({ speaker }) {
  return (
    <div className="speaker-status">
      <Bluetooth size={15} strokeWidth={2.4} />
      <span>{speaker?.name || 'Tune Table'}</span>
      <i className={speaker?.connected ? 'online' : ''} />
      <b>{speaker?.connected ? 'Connected' : 'Offline'}</b>
    </div>
  );
}

function Player({ state, onPlay, onStop, onVolume }) {
  const active = ['connecting', 'buffering', 'playing'].includes(state.playback.state);
  const playing = state.playback.state === 'playing';
  const title = state.playback.title || 'Radio Swiss Jazz';
  const detail = state.playback.error || state.playback.detail || 'Jazz, soul and blues. Live from Switzerland.';

  return (
    <section className="player-stage">
      <div className="stage-copy">
        <div className="status-line">
          <span className={`status-icon ${playing ? 'live' : ''}`}><RadioTower size={14} strokeWidth={2.3} /></span>
          {playing ? 'On air' : state.playback.state}
        </div>
        <h1>{title}</h1>
        <p>{detail}</p>
        <div className="transport">
          <button className="transport-button" onClick={active ? onStop : onPlay}>
            {active ? <Square size={18} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
            {active ? 'Stop' : 'Play radio'}
          </button>
          <label className="volume-control">
            <Volume2 size={17} />
            <input type="range" min="0" max="100" value={state.config.volume} onChange={event => onVolume(Number(event.target.value))} />
            <output>{state.config.volume}</output>
          </label>
        </div>
      </div>
      <div className="signal-art" aria-hidden="true">
        <div className={`platter ${playing ? 'spinning' : ''}`}>
          <div className="grooves" />
          <div className="record-label"><Radio size={24} /><span>JC<br />33</span></div>
        </div>
        <div className={`meter ${playing ? 'moving' : ''}`}><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
      </div>
    </section>
  );
}

function ScheduleList({ schedules, library, onAdd, onDelete }) {
  const sourceName = id => library.find(item => item.id === id)?.title || 'Missing source';
  return (
    <section className="schedule-section">
      <div className="section-heading">
        <div><CalendarPlus size={18} /><h2>Scheduled sets</h2></div>
        <button className="plain-button" onClick={onAdd}>Add set</button>
      </div>
      <div className="schedule-stack">
        {schedules.length === 0 && <p className="empty">No sets booked. Add one to start music on a schedule.</p>}
        {schedules.map(schedule => (
          <article className="schedule-item" key={schedule.id}>
            <time>{formatTime(schedule.time)}</time>
            <div className="schedule-info"><strong>{schedule.name}</strong><span>{sourceName(schedule.sourceId)}</span></div>
            <div className="day-strip" aria-label={schedule.days.map(day => fullDayNames[day]).join(', ')}>
              {allDays.map(day => <i key={day} className={schedule.days.includes(day) ? 'chosen' : ''}>{dayNames[day]}</i>)}
            </div>
            <button className="icon-button" onClick={() => onDelete(schedule.id)} aria-label={`Delete ${schedule.name}`}><Trash2 size={16} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

function MusicLibrary({ tracks, currentId, onPlay }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => tracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(query.toLowerCase())), [tracks, query]);
  return (
    <section className="library-section">
      <div className="section-heading library-heading">
        <div><Library size={18} /><h2>Available music</h2><span>{tracks.length}</span></div>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a track" aria-label="Find a track" />
      </div>
      <div className="track-grid">
        {visible.map((track, index) => (
          <button className={`track-row ${currentId === track.id ? 'current' : ''}`} key={track.id} onClick={() => onPlay(track.id)}>
            <span className="track-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="track-disc">{track.kind === 'radio' ? <Radio size={15} /> : <Disc3 size={17} />}</span>
            <span className="track-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
            <Play className="row-play" size={17} fill="currentColor" />
          </button>
        ))}
      </div>
      <p className="music-hint">Drop audio into <code>music/</code> or <code>~/Music</code>. New files appear without a restart.</p>
    </section>
  );
}

function ScheduleDialog({ open, tracks, onClose, onSave }) {
  const [days, setDays] = useState(['mon', 'tue', 'wed', 'thu', 'fri']);
  if (!open) return null;
  function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave({ name: data.get('name'), time: data.get('time'), sourceId: data.get('sourceId'), days, enabled: true });
  }
  return (
    <div className="dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <form className="schedule-dialog" onSubmit={submit}>
        <div className="dialog-title"><h2>Book a set</h2><button type="button" className="icon-button" onClick={onClose}><X /></button></div>
        <label>Set name<input name="name" defaultValue="Morning jazz" maxLength="80" required /></label>
        <div className="form-pair"><label>Start time<input name="time" type="time" defaultValue="08:00" required /></label><label>Music<select name="sourceId">{tracks.map(track => <option key={track.id} value={track.id}>{track.title}</option>)}</select></label></div>
        <fieldset><legend>Play on</legend><div className="day-picker">{allDays.map(day => <button type="button" key={day} className={days.includes(day) ? 'selected' : ''} onClick={() => setDays(current => current.includes(day) ? current.filter(value => value !== day) : [...current, day])}>{fullDayNames[day]}</button>)}</div></fieldset>
        <button className="save-button" disabled={!days.length}>Save set</button>
      </form>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState('');

  async function refresh() {
    try { setState(await request('/api/state')); }
    catch (error) { setNotice(error.message); }
  }
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);

  async function play(sourceId = 'radio-swiss-jazz') {
    setNotice('Connecting to Tune Table');
    try { await request('/api/play', { method: 'POST', body: JSON.stringify({ sourceId }) }); await refresh(); setNotice('Playing'); }
    catch (error) { setNotice(error.message); await refresh(); }
  }
  async function stop() { await request('/api/stop', { method: 'POST' }); refresh(); }
  async function volume(value) {
    setState(current => ({ ...current, config: { ...current.config, volume: value } }));
    await request('/api/volume', { method: 'POST', body: JSON.stringify({ volume: value }) });
  }
  async function saveSchedule(schedule) {
    try { await request('/api/schedules', { method: 'POST', body: JSON.stringify(schedule) }); setDialogOpen(false); setNotice('Set saved'); refresh(); }
    catch (error) { setNotice(error.message); }
  }
  async function deleteSchedule(id) {
    if (!window.confirm('Delete this scheduled set?')) return;
    await request(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }); refresh();
  }

  if (!state) return <main className="loading"><Disc3 size={34} className="loading-disc" /><span>Opening the booth</span></main>;
  return (
    <>
      <div className="noise" />
      <main className="app-shell">
        <header className="topbar">
          <a className="wordmark" href="/"><span>JAZZ</span><b>COMMAND</b><small>Home broadcast console</small></a>
          <div className="header-rule" />
          <SpeakerStatus speaker={state.speaker} />
        </header>
        <div className="dashboard-grid">
          <Player state={state} onPlay={() => play()} onStop={stop} onVolume={volume} />
          <ScheduleList schedules={state.config.schedules} library={state.library} onAdd={() => setDialogOpen(true)} onDelete={deleteSchedule} />
        </div>
        <MusicLibrary tracks={state.library} currentId={state.playback.sourceId} onPlay={play} />
        <footer><span>Jazz Command / 8787</span><span>Los Angeles time</span></footer>
      </main>
      <ScheduleDialog open={dialogOpen} tracks={state.library} onClose={() => setDialogOpen(false)} onSave={saveSchedule} />
      <div className={`toast ${notice ? 'visible' : ''}`} role="status">{notice}</div>
    </>
  );
}
