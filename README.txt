Open Chart Editor (OCE) 0.11.0

An independent, open-source chart editor for FeedBack: guitar and bass (4-8
strings), keys, drums and vocals, with FeedPak, FeedBack loose-folder and
DLC Builder project output. For compatibility it can also open and write
Rocksmith 2014 and Rocksmith+ (R+) chart formats; it is not affiliated with
Ubisoft. It runs as a FeedBack plugin (open_chart_editor) or standalone.
Work in progress; feature-coverage.json records known gaps.

License: GNU Affero General Public License v3.0 only (AGPL-3.0-only), the
same as FeedBack; see LICENSE. Third-party material and its licences are
listed in THIRD-PARTY-NOTICES.txt; docs/provenance-audit.md records where
each part of the project comes from.

The development and packaging tools work locally: they publish nothing,
install no games and scan no user library.

Open the editor
  Double-click launch.cmd, then open http://127.0.0.1:8766.
  Alternatively: python dev_server.py
  Requires Python with fastapi, uvicorn, python-multipart, PyYAML and
  jsonschema >=4.18,<5 available. requirements-standalone.txt declares the
  schema-validation dependency; install it in the Python environment running
  this editor/FeedBack. No dependency is downloaded automatically.
  No frontend compilation or npm dependency installation is required.
  The launcher uses the existing Python environment; it downloads nothing.
  File > Arrangement info or Ctrl+Shift+I reveals the Settings inspector.

Standalone builds
  The "Standalone builds" workflow in GitHub Actions, started by hand, produces
  Windows x64, macOS Apple Silicon and Linux x64 builds that need no Python.
  Each archive is named open-chart-editor-<platform>-v<version>-<commit>, e.g.
  open-chart-editor-windows-x64-v0.11.0-a3f9c21.zip: the version is plugin.json's,
  the commit is the exact source it was built from.
  Unpack one, keep the folder together and run open-chart-editor inside it (on
  Linux, from a terminal). The editor opens in your browser; close the program's
  window or press Ctrl+C to stop.
  The builds are unsigned, so the system warns on first use:
    Windows: choose More info > Run anyway.
    macOS: run xattr -dr com.apple.quarantine on the unpacked folder.
  FFmpeg and the other external tools stay separate and optional. Guitar Pro
  import and editing notation-only keys parts work out of the box: the build
  bundles FeedBack's converter/notation modules (tools/vendor/feedback-lib,
  AGPL-3.0, pinned - see that folder's README for the source and how to
  update it). A real FeedBack install, if present (OCE_FEEDBACK_LIB, a plugin
  install, or a dev checkout found automatically), is still preferred over
  the bundled copy when both exist. The AmpliTube 5 live host is not
  included; it needs running from source.
  To build one on your own machine:
    pip install -r requirements-build.txt
    pyinstaller tools/standalone.spec
  and find it in dist/open-chart-editor. tools/smoke-standalone.py checks a build.

FeedBack integration
  See tools/README.txt for the explicit-file installer and isolated host test.
  Intended host: I:\Dev\freedBack\feedBack, version 0.3.1-alpha.4.
  The existing editor plugin is preserved. OCE has its own navigation item (Chart Editor).
  After installation, restart the host normally to load backend routes.
  My Library card menus include Open in Chart Editor for local song archives
  and bounded selected song folders.
  Unsaved edits require confirmation; cancelled or superseded loads leave
  the current project intact. File > Open song folder reads a selected
  FeedPak directory, legacy loose song, or identity-bound source handoff.
  Highway region Edit continues to use the host-selected legacy editor.

Output targets in 0.11
  Save As offers three main handoffs, each with ZIP/file or folder delivery:
  - DLC Builder project: selected six-string guitar/four-string bass XML (seven-string
    guitar in the RS7X layout; see docs/rs7x-export.md) and
    vocals, backing audio, cover, tone definitions, a DLC Builder .rs2dlc
    project with the song details prefilled, and a complete editable master.
    It opens directly in DLC Builder (Rocksmith2014.NET), which does the
    packaging. Unsupported charts remain in the master.
    Non-PCM audio uses a full-duration PCM copy with a 128 MiB decoded limit;
    larger sources refuse. WEM-only input needs original editable PCM/audio.
  - FeedBack loose song folder: flat XML/audio/art/manifest.json, plus a
    hash-bound OCE typed performance extension preserving all layouts,
    piano, drums and authored data. Legacy readers see compatible XML only;
    full typed playback requires the separately reviewed local host adapter.
  - FeedPak: canonical manifest.yaml and validated 1.25 streams. Folder form
    uses a .feedpak directory; packaged form is the same tree inside a ZIP.
    Unknown fields/files are retained. Notation-only parts are explicitly
    read-only; this build does not offer a standard-notation editor or render
    NAM/Tone3000 rigs. Missing unsupported rig realizations are retained with
    warnings and are never downloaded. Present local asset hash mismatches
    refuse. JSONC allows comments, not trailing commas; JSON remains strict.
  This editor does not read or write PSARC packages. Stock RS2014 compatibility is
  explicit; extended strings, piano and drums are not stock game support.
  Folder writes create a new child rather than overwrite existing content.
  Keep editable JSON for all authoring data. Source snapshots and raw unknown
  bytes stay preserved; comments in an actively rewritten JSONC stream may
  not retain their original formatting.

Import assistance (optional, local)
  Importing a Guitar Pro score into a song with audio can align it to that
  audio and add ML suggestion versions of each part (anchors, fingering,
  techniques, piano hands) to compare with the originals. This uses a local
  gp-to-feedpak checkout; nothing is downloaded and no network fallback runs.
  - Beat-tracker ensemble: Docker image gp-to-feedpak:eval-beatthis (offline).
  - Sync engine and ML suggestions: the checkout's _parangonar_venv Python.
  Settings: GP_TO_FEEDPAK (checkout folder), OCE_ASSIST_PYTHON,
  OCE_ASSIST_IMAGE. Options appear only when available. Each alignment
  reports its own confidence; always review the beat map against the audio.

Start authoring
  File > Welcome includes New/Open/Original study/Recent. Recent caches up to
  12 original files (128 MiB total, 64 MiB per file) in this browser profile.
  Saving complete editable JSON refreshes the latest cached project/audio.
  Storage failures leave normal opening and saving available.
  File > New project creates a blank chart. Import your original backing audio,
  or render original synthesized practice audio from the notes. File > Open
  accepts Feedpak, editable JSON, arrangement/vocal XML, MIDI, MusicXML/MXL,
  Guitar Pro 3-8 and GPA sync song folders. Import limitations appear in Error Finder.
  File > Import arrangements adds selected tracks to the current song, with
  optional beat alignment and time offset. The incoming source is retained.
  Add guitar, bass, piano or drums using the arrangement controls. Fretted
  settings include every string count from 4 through 8 for guitar and bass
  authoring families, a separate instrument label, tuning, capo, role and
  package priority. Defaults are original editor choices; customize tuning
  to match the actual instrument. Reducing string count refuses populated
  removed lanes instead of discarding notes or authored difficulty data.
  Save an editable JSON project to preserve every authoring field.

  Double-click the timeline to enter a note; arrows move cursor/string.
  Digits enter frets 0-9, numpad enters 10-19, Ctrl+numpad enters 20-24.
  Shift-click extends selection. Drag notes to move and tails to resize.
  Ctrl+wheel zooms around the pointer; Shift+wheel pans time; Alt+wheel changes
  lane height. Tab and Tempo retain separate zoom settings across reloads.
  The canvas backing follows the visible viewport with an8M-pixel budget;
  large kits and full-range keys keep their complete logical scroll range.
  Note/chord shortcuts operate in visible Tab/Tempo views; global Save,
  Undo/Redo and transport remain available in Tones/Vocals.
  F creates a chord, N inserts a strum, A an anchor, Ctrl+P a phrase.
  Properties edits techniques, bends, fingering, pitch, hands and velocity.
  Enabling palm mute clears fret-hand mute, including the legacy mute flag.
  Enabling fret-hand mute clears palm mute. These commands affect selected
  notes and chord voices, retaining frets and other chart data. Imported flag
  combinations stay unchanged until an explicit command edits them. A mixed
  selection enables the chosen technique if any selected voice lacks it;
  otherwise the command disables it. Disabling leaves the opposite mute flag
  unchanged; disabling fret-hand mute also clears its existing legacy alias.
  Mute output uses Boolean flags: true or a positive finite legacy number
  enables a flag; zero and negative values leave it inactive. Fret-hand mute
  and its legacy alias combine with OR after each value is interpreted.
  Cached source flags cannot override the current authored mute settings.
  Target output is normalized while the editable master and original source
  retain their authored values. Invalid mute values, including text, null and
  non-finite numbers, are refused during normal project validation.
  Ctrl+L selects matching string/fret notes, piano pitches or drum pieces.
  Whole-chord copy keeps its voices together; one copied member becomes an
  independent note. Undo restores exact source content.
  Numeric tap and picking direction retain native values. Bend intent is a
  FeedBack annotation; explicit bend curves define the audible/native shape.
  Help inside the editor lists additional keys. F10 enters menu navigation;
  arrows, Home/End, letters and Escape move or dismiss menus.
  Right-click the timeline for note and structure actions. Shift with arrow
  keys expands the selection; reversing direction shrinks it around its anchor.
  Shift menu transposition and string-position moves validate the full selection
  before changing it. String moves can keep frets or sounding pitch, including
  slide endpoints, capo, tuning and chord fingering.
  Settings > Manage arrangements provides rename, duplicate, reorder and remove.
  Linked scratch tracks are removed with their main part; Undo restores them.
  Other pitched instrument names use the same editable piano-roll representation.
  Settings > Guide instrument selects one of16 original offline synthesized
  families or follows supported source GM intent. Programs are zero-based0-127;
  eight programs share a family sound. Explicit choices apply to the whole part
  and survive editable JSON/Feedpak, without rewriting native tone bindings.
  Source rig mute is respected; unsupported source intent stays silent with a
  warning. Existing host providers do not automatically play these guide choices.
  Tuning reference uses the native centOffset field: 0 is A440, +1200 is an
  octave up. It changes chart guidance, not the recorded backing. Preview pitch
  and this tuning reference are independent controls.

  Tempo view supports manual beat dragging, tap tempo, transient suggestions,
  alignment, ramps and time signatures. Review automatic suggestions before
  accepting. Snap options choose straight/swing grids or analyzed audio onsets;
  Resnap moves the selected notes/chords together without rewriting the beat map.
  Settings > BPM at cursor changes the map from that beat to the song end,
  preserving earlier alignment. Constant tempo changes the entire map.
  Speed controls and J/K shortcuts cover25..200%; ramps support the same range.
  The follow-notes option determines whether chart timing moves
  with the beat map. Preview speed/pitch/ramp controls do not rewrite source
  audio or automatically bake those changes into exports. Conservative grain
  alignment improves strongly periodic material during slowdown; transient
  smear remains. Settings > Preview audio also offers experimental Spectral
  processing, using a bounded background worker/worklet to retain mixed pitches
  during slowdown. It prepares before playback; Play cancels preparation.
  Unavailable APIs, worker failure or underrun fall back visibly to Fast.
  Spectral processing can produce transient pre-echo and noise coloration; native
  or studio DSP fidelity is unverified. Listening preferences survive reload.

  Tones view edits original tone definitions and timed allocations. Browser
  preview provides original generic amp/cab, delay, reverb, chorus, flanger,
  phaser, tremolo and compression models. Gear cards disclose unsupported
  controls and bypassed gear. A local output ceiling bounds active effect chains.
  Original gate, envelope filters, automatic wah, bit crushing and additional
  tremolo/ring modulation extend local audition to 68 of the 79 audited
  non-Distortion/non-Pitch descriptors, including partial Eden and all five wah
  Auto modes. The complete 100-descriptor pedal/rack catalog has 84 original
  approximate models: those 68 plus 16 generic distortion approximations.
  Sixteen descriptors remain bypassed: 11 in the audited subset and five
  Pitch descriptors (Bass Sub Octave, MultiPitch, OctaveUp!, Octavius and
  Studio Pitch). Unsupported controls remain disclosed.
  Amp EQ uses an original three-band model: authored controls 1..100 map
  to -12..+12 dB, with midpoint 50.5 at unity. Original enum-selected anchors
  are bass 80/160 Hz, mid 400/800/1600 Hz and treble 2500/5000 Hz, Q=1,
  bounded to 20 Hz..0.45 times sample rate. These choices are not native
  frequency or gain calibration. Audited Filter coverage is now 20 of 21;
  non-Filter coverage in that subset remains 48 of 58.
  Swole uses an original generic compressor mapping with browser automatic
  makeup/lookahead. Eden models three EQ controls; five unmapped controls
  remain disclosed. Native/branded DSP and physical listening are unverified.
  Adaptive effects prepare only on Play or explicit monitoring; a failed module
  bypasses those gears while other effects remain available. Gear cards show
  actual guide/live-input failures separately. EQ ranges, envelope timing and
  local stage ceilings are original policies; native tone definitions stay intact.
  Enum controls use named choices. Continuous native float values survive
  import/edit/export without quantization; arrows use the catalog increment.
  Audition selected library tone switches guide/live-input monitoring while
  Tones is open; chart allocations and exports stay unchanged. Practice WAV
  rendering remains dry guide synthesis. Native/branded DSP fidelity is unverified.
  Difficulty controls retain individually editable authored levels and copy or
  clear one phrase at a chosen level. Other phrases and source levels stay
  intact. Generated thinning and phrase operations are original authoring tools;
  a proprietary adaptive difficulty algorithm is not reproduced.
  History offers direct undo/redo-state navigation and named checkpoints.
  Checkpoints expire when their state is evicted or its redo branch is replaced.
  Chord tools include beat-based zones, fingerprint/arpeggio presentation,
  hidden names, reusable templates, bulk fingerprint generation/removal, splits,
  cursor-position bend curves and
  suggested names. Drag zones or their endpoints to move or resize them.
  Fit zone ends previews endpoint-only changes with a musical gutter and explicit
  phrase/hand-shape boundaries. Conflicts that would cut existing musical tails
  are skipped or reject the complete operation. Other difficulties stay intact.
  This is an original fitting policy; exact native propagation is unverified.
  Editing template fingers updates children with no assignment or the previous
  template finger across all levels. Other per-note assignments, including an
  explicit unset value, remain overrides. This inheritance policy is original;
  equal values cannot reveal an author's historical intent.
  Edit chord includes an original live diagram for4through8 strings: unused
  crosses, open circles, thumb T and capo-relative or physical fret labels.
  Cancel never commits a voicing; blank fingers cannot silently become thumbs.
  Chords > Repair anchor coverage previews missing/uncovered hand positions in
  the visible difficulty. Width conflicts block the whole repair; other music
  and stored difficulties remain intact. The bounded preview lists100 proposals.
  N adds or removes a strum inside a chord zone. Repeat strums use compact bars
  and native high-density flags; imported authored sustains remain intact.
  Edit > Sustain editing optionally limits tails at the next same-string attack
  and shortens snapped tails by a beat-based gutter. Both start off. G toggles
  the gutter; [ / ] move the tail by snap steps through tempo changes. Exact
  numeric entry bypasses the gutter. Linked tails can overlap; edits that would
  cut a bend curve are refused as a whole. Enabling preferences never trims
  existing notes. This policy is original; exact retail exceptions are unverified.
  Destination-pitch Auto/On/Off authoring follows REA-observed prerelease
  serialization. JSON and Feedpak preserve it. Stock RS2014 export rejects
  non-Auto modes because an equivalent game representation is unestablished.
  Scratch opens a secondary reference track; Edit scratch focuses it for
  normal editing. Scratch data stays out of playable arrangement manifests.
  Vocals has a separate waveform/lyric/pitch timeline and a100-row paged table.
  Drag a selected group, resize a tail, or double-click to enter/edit syllables.
  Canvas-focused Ctrl+A/C/X/V/Delete acts on vocals; Alt+arrows nudge timing.
  Optional MIDI pitches0..127 are retained. Tab/Shift+Tab follows table edits,
  including a syllable whose new onset moves it to another page. Phrase entry
  uses whitespace-separated syllables and refuses a phrase that cannot fit.
  Error Finder navigates directly to the affected syllable and field. RS2014
  vocal text must fit its47-byte UTF-8 native field; editable JSON retains text.
  Feedpak keeps unchanged lyric/pitch sidecars byte-exact and preserves unknown
  source metadata. Editing pitch/timing detaches stale pitch-contour references;
  editing primary lyrics leaves alternate lyric tracks unchanged with a warning.
  In Vocals, Playtest creates a vocal-only preview and uses a separately installed
  Vocal Highway provider. It requires a positive-duration pitched syllable.
  Selected lyric extent can define the native loop. Microphone capture starts
  only through that provider's explicit Start control. The private provider is
  a separate local dependency and is excluded from the OCE ZIP.
  Single lyric and tone-control edits retain their input controls and use scoped
  Undo capture. Original100,000-syllable browser studies verify source/hidden-data
  preservation and improved edit latency; timing results depend on the machine.
  MIDI recording requests browser device access only when explicitly selected.
  Pitched recording has an original held-note guide, including channel-specific
  sustain pedal, velocity, tuning cents and preview pitch shift. Guide off keeps
  recording active; Stop, explicit seek or chart changes release its voices.
  Device ownership survives replacing an editor with another open instance.
  Piano velocity includes silent0 through127; drums use1 through127.
  Imported numeric MusicXML dynamics use the specified default-forte90 scale;
  explicit numeric sound tempo offsets affect the beat map. Symbolic dynamics
  and unsupported expression controls are retained with precise warnings.
  Valid compressed MusicXML up to32MiB retains the complete original archive,
  including other files, through JSON/Feedpak reopening. Larger attachments
  keep the score XML and disclose that the compressed container was not kept.
  Unambiguous MIDI program changes provide explicitly approximate GM guide
  families. Channel state crosses tracks; unresolved banks, SysEx and ambiguous
  same-tick order withhold mapping rather than invent patch identity. Original
  source bytes and raw program/bank addresses survive JSON/Feedpak/merge.
  Physical MIDI hardware and the operating-system Save dialog need interactive
  verification; automated tests simulate devices and exercise downloads.
  Drag the measure ruler to define a loop, drag either endpoint to refine it,
  and press L to toggle looping. Playback provides a configurable count-in.
  Mixer channels support pan, mute and solo, with separate left/right peak
  meters, dBFS values and clipping indicators. Guide metering is before the
  tone effect; master metering includes it. Song-only listening effects
  include five-band EQ, channel isolation and center cancellation with bypass.
  Live instrument monitoring requests input permission only after you select
  it; navigation or teardown stops the stream. It records/uploads no input.
  Unsupported browser codecs can use a bounded local FFmpeg preview. Saved
  audio always retains your original source bytes.
  Inspector and bottom panels resize using their dividers or arrow keys while
  focused. Ctrl+J hides or shows the bottom panel. View > Show arrangements
  together stacks several parts on one timeline, each still editable. Layout and listening preferences survive reload separately from
  song data. Error Finder retains all findings and offers pages and severity
  filters; selecting a stored difficulty issue opens the affected level.
  Original synthesized practice audio defaults to 48 kHz so the highest MIDI
  fundamentals fit the sampling range. Ten stereo minutes use about 115 MB of
  PCM. Rendering runs in a cancellable background worker; editing or replacing
  the project discards stale work before it can replace your backing.
  Frequencies outside the sampling range and malformed reference values
  produce silence rather than aliased or invalid sample values.
  Drum audition uses18 original synthesized percussion voices, follows ghost
  dynamics, flams and cymbal chokes, and closes open hi-hats at closed/pedal hits.
  These are listening aids, not recorded drum samples or native game DSP.
  Imported custom drum IDs have distinct editable lanes using source kit labels.
  The reviewed local native Drum Highway patch adds canonical stack and bell
  pieces, with explicit default fallback lanes; a saved kit is never expanded
  automatically. Playtest refuses missing kit lanes before saving/uploading.
  Hidden levels and chord voices contribute to stable lane discovery. Custom
  local audition uses a generic cue. The current native highway skips custom
  IDs, so playtest refuses visible custom hits before making a library file;
  JSON and Feedpak preserve them for compatible future providers.
  Drum Feedpak saves expose the highest-level hit chart for native playback,
  including simultaneous chord-member hits. A SHA-bound sidecar retains every
  editable level, group and structural lane. If another tool changes native hits,
  stale private levels are withheld with a warning and original bytes preserved.
  Guide audition follows authored relative bend curves and pitched slides,
  including continuation after a seek or loop restart. Scalar-only bend ramps,
  vibrato rate, tremolo pulses and mute decay are original listening aids.
  They do not claim native instrument DSP. Unpitched slides and destination-pitch
  metadata are retained without inventing an unverified audible interpretation.

Save As destinations
  Editable JSON: complete authoring project, including embedded source audio
    when available. Local recovery drafts are stored in this browser profile.
  FeedBack .feedpak: native 1.25 manifest, chart data and original audio.
    Supports extended guitar/bass, keys, drums and other pitched instruments.
  RS2014 XML: selected stock-compatible guitar/bass arrangement.
  Vocal XML: syllable timing/text for native vocal arrangements.
  DLC Builder project: arrangement/vocal XML, tones, audio, cover and a
    prefilled .rs2dlc project, ready for DLC Builder to package.

  Custom open-string pitches are converted into standard native tuning offsets
  for playback; Feedpak also preserves the original editable layout.
  Stock RS2014 supports six guitar/four bass strings. Extended instruments,
  piano and drums remain FeedBack targets until a verified mod adapter exists.
  Six-string bass authoring is available, but the installed host has conflicting
  six-string bass tuning conventions; game grading for that extra range is
  unverified. Five-string bass is covered by the production playback tests.
  A playable Feedpak requires real backing audio; empty stems are refused.
  Native Open/Save pickers are used when available; other browsers use file
  selection and downloads. Editable JSON opened through a native picker keeps
  its save destination for Ctrl+S; each other format has a separate destination.
  Complete JSON also retains DLC Builder project details across reopening.
  Pending saves stay attached to the original project and Recent entry when
  another project opens. Writes to the same native file finish in request order;
  independent destinations stay responsive. Same-project remounts retain the
  completed save destination and unsaved state.

Playtest in FeedBack
  Build and playtest explicitly creates a uniquely named preview Feedpak in
  the configured host library, then starts the public playback capability at
  the beginning or cursor. Playback > Build and playtest selected loop hands
  the selected time region (or defined editor loop) to the public host loop
  interface. Session guards prevent applying a stale loop to another song.
  Playtests audition the currently visible difficulty, including working edits;
  ordinary complete Feedpak exports retain all authored levels. End playtest
  returns to the editor with its editing context retained. Remove preview
  removes only the build remembered by that editor session. These controls
  are unavailable in the standalone preview. No library writes occur merely
  by opening or editing a project.
  Mixed-instrument previews isolate the chosen chart so unrelated drum or
  notation pointers cannot select a different renderer. Full-range piano uses
  the local Piano 2D provider; the installed Keys Highway 3D displays 88 keys.
  The bundled 3D Drum Highway is supported when WebGL2 is available.
  The local Piano provider has an explicitly recorded patch: MIDI and remote
  instrument sounds initialize only through its Connect MIDI / Enable sound
  controls. Its separate upstream source and notices remain in the dependency
  research record. No hardware or remote sound library was used in tests.

Verification and packaging (run from the original research workspace)
  node --test tests/*.test.mjs
  python -m pytest tests -q -p no:cacheprovider
  node tests/browser-deep.mjs         (start local preview first)
  python tools/verify-host.py         (isolated actual host integration)
  python tools/verify-highway.py      (actual production shell and player)
  python tools/package-local.py      (curated runtime archive, no fixtures)

  Test audio, private .rsw/decompilation data, research captures and
  unrelated checkouts are excluded from the runtime archive. Evidence stays
  in the source workspace. See THIRD-PARTY-NOTICES.txt for dependency context.

Local host compatibility repair
  Production playtesting exposed a Python 3.13/SQLite statement-cache race in
  the host's shared database connection. A separately reviewed one-line change
  sets cached_statements=0 in FeedBack/lib/metadata_db.py. The exact old source
  is backed up in research/host-fixes/backups in the research workspace.
  No database schema or stored data changed. The user service was not restarted.
  The plugin file installer itself does not modify host core.

Eight-string highway label repair
  The installed highway provider used MIDI28/E1 for the lowest standard
  eight-string guitar label; host core uses MIDI30/F#1. A backed-up one-line
  provider correction aligns the label with the chart pitch. Provenance, exact
  hashes and the backup are in research/host-fixes/highway3d-eight-string.

0.6 recording and source preservation verification
- Actual browser:32 note-offs into100,000 notes now5.4ms total (max2.1ms), versus20.166s before. One-time631ms preparation runs before playback. Each note remains separately undoable;32Undo/Redo restore exact source/hidden difficulties. Unsorted/mismatched DD uses the full edit fallback. No physical MIDI hardware claim.
- Plain MusicXML normalized score sources survive Feedpak save/reopen; original compressed MXL archives remain separately retained. Source metadata never replaces edited chart content.191backend tests plus40subtests pass.

0.7 arrangement/source verification
- Explicit arrangement role and package priority survive native Feedpak save/reopen using a versioned SHA-bound editor sidecar; renamed neutral charts keep their selected roles. All seven instrument layouts, hidden difficulties, tones and original PCM pass actual Save As/reopen checks.
- GP6/7/8 uniform fretted capo metadata follows documented track/staff precedence. Open strings remain native fret0; nonzero frets receive the capo once in stock XML. Conflicting or unsupported metadata produces explicit errors instead of guessed pitches.
-550 JavaScript tests and249 backend tests plus109 subtests pass. One Windows file-symlink creation test skips for missing OS privileges; actual directory-junction containment passes.
- Original Acoustic Emulator and Range Booster audition models now pass actual production offline/audio-graph and five UI checks. Their generic sound is approximate; native tone definitions remain exact.
- Delayed tone, tempo and arrangement loads reserve their source project and selection. New/Open, intervening edits, part switches, newer imports or unmount supersede old reads.28 handler tests and14 actual UI workflows pass, including full-project Undo; same-file tone/tempo selection works again.

Feedpak phrase and difficulty safety
- Every authored difficulty must have native phrase coverage for all its notes, chords, anchors and hand shapes. Export names uncovered events and refuses before writing a partial file. Add or move a phrase marker at/before the event to rebuild coverage; events at/after song end also need a longer duration. Renaming a marker keeps original timing. Sustains and hand-shape ends remain unchanged.
- Removing canonical difficulty levels while old native source ladders remain is refused. Restore the authored levels or save editable JSON to retain the removal; old notes are never silently resurrected.
- Flat-chart phrase markers retain their IDs and authoring fields when reopened in OCE. Native FeedBack phrase playback still requires an authored phrase ladder; a successful export displays this limitation. No artificial difficulty levels are added.
- Four actual browser workflows verify refusal/no partial download, explicit Insert phrase repair, exact Undo/Redo and native archive reopen, plus flat-marker/source preservation. MusicXML/MXL/MIDI and seven-instrument Save As regressions also pass after this fix.
