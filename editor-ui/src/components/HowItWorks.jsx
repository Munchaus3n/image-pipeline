import { Section } from "./ui/index.jsx";
import { BG_MODELS, UPSCALE_MODELS, BG_DEVICE_OPTIONS } from "../modelLabels.js";
import { SHORTCUTS } from "../editorShortcuts.js";

// The "How it works" page in Settings: what each screen does and what every model is
// for, written for someone who has never used the app. Model text is read from
// modelLabels.js so it always matches the dropdowns.

function ModelList({ models }) {
  return (
    <dl className="settings-info-models">
      {models.map(model => (
        <div key={model.id} className="settings-info-model">
          <dt>{model.label}</dt>
          <dd>
            <p>{model.summary}</p>
            <p><strong>Best for:</strong> {model.bestFor}</p>
            <p><strong>Avoid when:</strong> {model.avoidWhen}</p>
            {model.notes ? <p className="settings-info-note">{model.notes}</p> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function HowItWorks() {
  return (
    <div className="settings-info">
      <Section title="Quick start" prefKey="settings.info.quick">
        <ol className="settings-info-steps">
          <li><strong>Input.</strong> Pick the folder that holds your photos and press <em>Load</em>. Tick <em>Subfolders</em> if the photos are in folders inside it.</li>
          <li><strong>Process.</strong> Choose Upscale and/or Remove BG, check the output folder, then press <em>Run pipeline</em>. A progress bar and an estimated time show while it works.</li>
          <li><strong>Editor.</strong> Each finished image opens on a canvas. Snap it to a guide, adjust it, and press <kbd className="ui-kbd">Enter</kbd> to save and move to the next one.</li>
        </ol>
        <p>
          Your original photos are not changed (unless you turn on <em>Wipe input after run</em> in Settings, Safety).
          Everything the app makes goes into the output folder.
        </p>
      </Section>

      <Section title="What each screen does" prefKey="settings.info.screens" defaultOpen={false}>
        <dl className="settings-info-list">
          <dt>Input</dt>
          <dd>
            Loads a folder and shows thumbnails. Select photos to <em>Exclude from BG</em> (they are cropped
            but their background is kept) or <em>Remove from session</em> (they are left out of this run).
          </dd>
          <dt>Process</dt>
          <dd>
            Runs the batch: upscale, then background removal. It can be stopped at any time. If a run was
            interrupted, a <em>Resume</em> prompt offers to continue where it left off.
          </dd>
          <dt>Editor</dt>
          <dd>
            Places each cut-out on a square canvas using a template, then saves it as a PNG. Drop a single
            photo or a folder onto the Editor to work without running Process first.
          </dd>
          <dt>Templates</dt>
          <dd>
            Placement presets. A template sets which guide (green, blue, magenta or red) the product snaps
            to, an optional reference picture, and file-name words. When <em>Auto-match from file name</em> is
            on, the Editor picks the template whose words appear in the photo&apos;s name.
          </dd>
          <dt>Settings</dt>
          <dd>Defaults for everything above. Press <em>Save settings</em> to keep changes.</dd>
        </dl>
      </Section>

      <Section title="What Process does" prefKey="settings.info.process" defaultOpen={false}>
        <ol className="settings-info-steps">
          <li><strong>Upscale</strong> makes small photos bigger so they stay sharp. Photos that are already large (see <em>Skip upscale if any side is at least</em>) are left as they are.</li>
          <li><strong>Remove BG</strong> cuts the product out and crops tightly around it, with a small padding.</li>
          <li><strong>Finishing</strong> copies results for exact duplicate photos instead of processing them twice.</li>
        </ol>
        <p>Results go into folders inside the output folder:</p>
        <ul className="settings-info-bullets">
          <li><code>upscaled</code> upscaled photos.</li>
          <li><code>processed</code> cut-outs with a transparent background.</li>
          <li><code>corrupted</code> copies of photos that could not be processed.</li>
          <li><code>Editor</code> final images saved from the Editor, with a <code>thumbnail</code> folder next to them when thumbnails are on.</li>
        </ul>
        <p>
          With your own input and output folders, results from earlier runs are kept and images that are
          already finished are skipped, so running again only does what is missing. With the app&apos;s default
          folders, or when <em>Wipe input after run</em> is on, a new run clears the old
          <code> upscaled</code>, <code>processed</code> and <code>corrupted</code> folders first. <em>Resume</em> always keeps them.
        </p>
      </Section>

      <Section title="Background removal models" prefKey="settings.info.bgmodels" defaultOpen={false}>
        <p>
          Not sure which to use? Start with <strong>BiRefNet General</strong>. Only change it when a photo comes
          out wrong, or when speed matters. The first run with a model downloads it (about 1 GB),
          so it needs an internet connection that one time.
        </p>
        <ModelList models={BG_MODELS} />
      </Section>

      <Section title="Upscaling" prefKey="settings.info.upscale" defaultOpen={false}>
        <p>
          Choose <em>2x</em> or <em>4x</em> in Process. For 2x, Settings lets you choose between a fast model and a
          slower, higher quality one. 4x always uses the photo model. Upscaling runs on the graphics card.
        </p>
        <ModelList models={UPSCALE_MODELS} />
      </Section>

      <Section title="CPU or GPU" prefKey="settings.info.device" defaultOpen={false}>
        <p>This only affects background removal. Pick it under Settings, Background removal.</p>
        <dl className="settings-info-list">
          {BG_DEVICE_OPTIONS.map(option => (
            <div key={option.value}>
              <dt>{option.label}</dt>
              <dd>{option.help.replace(/^[^:]+:\s*/, "")}</dd>
            </div>
          ))}
        </dl>
        <p>If you are unsure, keep CPU / Stable. It is the safest and leaves the PC usable.</p>
      </Section>

      <Section title="Editor tips and shortcuts" prefKey="settings.info.editor" defaultOpen={false}>
        <ul className="settings-info-bullets">
          <li><strong>Snap</strong> buttons place the product to fit a coloured guide. <em>Fit</em> shows the whole photo; <em>Fill</em> covers the whole canvas and cuts off what sticks out.</li>
          <li><strong>Skip</strong> leaves an image out. <strong>Previous</strong> goes back to fix and save an earlier image again.</li>
          <li><strong>Combo mode</strong> (Source section) keeps what is already on the canvas when you move on, so several photos can end up in one image.</li>
          <li>A warning appears when a photo is enlarged beyond its own size, because it will look soft.</li>
        </ul>
        <dl className="settings-info-shortcuts">
          {SHORTCUTS.map(([action, keys]) => (
            <div key={action}>
              <dt>{action}</dt>
              <dd><kbd className="ui-kbd">{keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Good to know" prefKey="settings.info.notes" defaultOpen={false}>
        <ul className="settings-info-bullets">
          <li>Saved images always have a <strong>transparent background</strong>. The canvas colour in the Editor is only a preview.</li>
          <li>The installed app keeps your settings and templates in <code>%LOCALAPPDATA%\Cutout Studio\config</code>. When no output folder is set, results go to <code>exports</code> in the same place.</li>
          <li><em>Wipe input after run</em> (Settings, Safety) deletes the source photos once their results exist. Leave it off unless the input folder is a disposable copy.</li>
          <li>BRIA RMBG-2.0 is for non-commercial use only unless you hold a licence from BRIA AI.</li>
          <li>If something fails, the Activity log on the Process screen shows what happened, and failed photos are copied into <code>corrupted</code>.</li>
        </ul>
      </Section>
    </div>
  );
}
