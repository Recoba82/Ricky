import React, { useState } from 'react';
import {
  useKitStore,
  PART_KEYS,
  PART_LABELS,
  PATTERN_PARTS,
  PATTERN_TYPES,
  DECAL_POSITIONS,
  DECAL_SLOTS,
  FINISHES,
} from '../store';

const TABS = [
  { id: 'colors', label: 'Colori' },
  { id: 'patterns', label: 'Pattern' },
  { id: 'decals', label: 'Loghi' },
  { id: 'materials', label: 'Materiali' },
];

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-slate-300">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ColorRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between text-sm text-slate-300">
      <span>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-12 cursor-pointer rounded border border-slate-700 bg-transparent"
      />
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-300">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-slate-400">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="accent-indigo-500"
      />
    </label>
  );
}

function Select({ value, options, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ---------- Tab Colori ---------- */

function ColorsTab() {
  const parts = useKitStore((s) => s.parts);
  const setPartColor = useKitStore((s) => s.setPartColor);

  return (
    <div className="flex flex-col gap-4">
      {PART_KEYS.map((key) => (
        <ColorRow
          key={key}
          label={PART_LABELS[key]}
          value={parts[key].color}
          onChange={(c) => setPartColor(key, c)}
        />
      ))}
      <p className="text-xs leading-relaxed text-slate-500">
        Se il modello caricato non ha mesh separate per una parte (es. maniche o colletto in una
        scansione), il relativo colore non ha effetto.
      </p>
    </div>
  );
}

/* ---------- Tab Pattern ---------- */

function PatternsTab() {
  const [part, setPart] = useState('body');
  const patterns = useKitStore((s) => s.patterns);
  const setPattern = useKitStore((s) => s.setPattern);
  const cfg = patterns[part];

  return (
    <div className="flex flex-col gap-4">
      <Field label="Parte del kit">
        <Select
          value={part}
          onChange={setPart}
          options={PATTERN_PARTS.map((p) => ({ value: p, label: PART_LABELS[p] }))}
        />
      </Field>

      <Field label="Pattern">
        <Select
          value={cfg.type}
          onChange={(type) => setPattern(part, { type })}
          options={PATTERN_TYPES}
        />
      </Field>

      {cfg.type !== 'none' && (
        <>
          <ColorRow
            label="Colore pattern"
            value={cfg.color}
            onChange={(color) => setPattern(part, { color })}
          />
          <Slider
            label="Scala / ripetizione"
            value={cfg.scale}
            min={2}
            max={24}
            step={1}
            onChange={(scale) => setPattern(part, { scale })}
          />
          <Slider
            label="Opacità"
            value={cfg.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(opacity) => setPattern(part, { opacity })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      )}
    </div>
  );
}

/* ---------- Tab Loghi ---------- */

function DecalSlot({ slot, label }) {
  const cfg = useKitStore((s) => s.decals[slot]);
  const setDecal = useKitStore((s) => s.setDecal);
  const clearDecal = useKitStore((s) => s.clearDecal);

  const onUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDecal(slot, { src: reader.result });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-800/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">{label}</span>
        {cfg.src && (
          <button
            onClick={() => clearDecal(slot)}
            className="rounded-md px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
          >
            Rimuovi
          </button>
        )}
      </div>

      <input
        type="file"
        accept="image/png,image/*"
        onChange={onUpload}
        className="text-xs text-slate-400 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-indigo-500"
      />

      {cfg.src && (
        <>
          <Field label="Posizione">
            <Select
              value={cfg.position}
              onChange={(position) => setDecal(slot, { position })}
              options={DECAL_POSITIONS}
            />
          </Field>
          <Slider
            label="Scala"
            value={cfg.scale}
            min={0.05}
            max={0.5}
            step={0.01}
            onChange={(scale) => setDecal(slot, { scale })}
          />
          <Slider
            label="Posizione X"
            value={cfg.x}
            min={-1}
            max={1}
            step={0.02}
            onChange={(x) => setDecal(slot, { x })}
          />
          <Slider
            label="Posizione Y"
            value={cfg.y}
            min={-1}
            max={1}
            step={0.02}
            onChange={(y) => setDecal(slot, { y })}
          />
          <Slider
            label="Rotazione"
            value={cfg.rotation}
            min={-180}
            max={180}
            step={1}
            onChange={(rotation) => setDecal(slot, { rotation })}
            format={(v) => `${v}°`}
          />
        </>
      )}
    </div>
  );
}

function BackTextSection() {
  const backText = useKitStore((s) => s.backText);
  const setBackText = useKitStore((s) => s.setBackText);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-800/40 p-3">
      <span className="text-sm font-medium text-slate-200">Nome e numero (retro spalle)</span>

      <Field label="Nome">
        <input
          type="text"
          maxLength={14}
          value={backText.name}
          onChange={(e) => setBackText({ name: e.target.value })}
          placeholder="Es. ROSSI"
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
        />
      </Field>

      <Field label="Numero">
        <input
          type="number"
          min={0}
          max={99}
          value={backText.number}
          onChange={(e) => setBackText({ number: e.target.value.slice(0, 2) })}
          placeholder="Es. 10"
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
        />
      </Field>

      <ColorRow
        label="Colore testo"
        value={backText.color}
        onChange={(color) => setBackText({ color })}
      />

      <Slider
        label="Dimensione"
        value={backText.scale}
        min={0.2}
        max={0.6}
        step={0.01}
        onChange={(scale) => setBackText({ scale })}
      />
    </div>
  );
}

function DecalsTab() {
  return (
    <div className="flex flex-col gap-4">
      <BackTextSection />
      {DECAL_SLOTS.map(({ key, label }) => (
        <DecalSlot key={key} slot={key} label={label} />
      ))}
    </div>
  );
}

/* ---------- Tab Materiali ---------- */

function MaterialsTab() {
  const finish = useKitStore((s) => s.finish);
  const setFinish = useKitStore((s) => s.setFinish);

  return (
    <div className="flex flex-col gap-3">
      {FINISHES.map((f) => (
        <button
          key={f.value}
          onClick={() => setFinish(f.value)}
          className={`rounded-xl border p-3 text-left transition-colors ${
            finish === f.value
              ? 'border-indigo-500 bg-indigo-500/10'
              : 'border-slate-800 bg-slate-800/40 hover:border-slate-600'
          }`}
        >
          <span className="block text-sm font-medium text-slate-200">{f.label}</span>
          <span className="block text-xs text-slate-500">{f.hint}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Pannello ---------- */

export default function ControlPanel() {
  const [tab, setTab] = useState('colors');

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 p-5">
        <h1 className="text-lg font-semibold text-slate-100">Configuratore 3D Kit</h1>
        <p className="mt-1 text-xs text-slate-500">
          Personalizza colori, pattern, loghi e materiali in tempo reale.
        </p>
      </header>

      <nav className="flex gap-1 border-b border-slate-800 p-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'colors' && <ColorsTab />}
        {tab === 'patterns' && <PatternsTab />}
        {tab === 'decals' && <DecalsTab />}
        {tab === 'materials' && <MaterialsTab />}
      </div>

      <footer className="border-t border-slate-800 p-4">
        <p className="text-[10px] leading-relaxed text-slate-600">
          Mesh 3D basata su{' '}
          <a
            className="text-slate-500 underline hover:text-slate-400"
            href="https://sketchfab.com/3d-models/paris-saint-germain-x-jordan-home-stadium-kit-1d43be1db93143ea8cc35bb5fb339ad1"
            target="_blank"
            rel="noreferrer"
          >
            PSG x Jordan Home Stadium Kit
          </a>{' '}
          di{' '}
          <a
            className="text-slate-500 underline hover:text-slate-400"
            href="https://sketchfab.com/proxy000000000"
            target="_blank"
            rel="noreferrer"
          >
            PROXY
          </a>
          , licenza CC-BY-4.0 (branding originale rimosso).
        </p>
      </footer>
    </aside>
  );
}
