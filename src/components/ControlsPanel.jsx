import React from 'react';
import { loadImage } from '../utils/decals';

const PATTERNS = [
  { value: 'solid', label: 'Tinta unita' },
  { value: 'stripes', label: 'Righe verticali' },
  { value: 'hoops', label: 'Bande orizzontali' },
  { value: 'sash', label: 'Fascia diagonale' },
];

function ColorField({ label, value, onChange }) {
  return (
    <label className="field field-color">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function ControlsPanel({ config, setConfig, onDownload }) {
  const set = (key) => (value) => setConfig((c) => ({ ...c, [key]: value }));

  const onLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const img = await loadImage(reader.result);
      setConfig((c) => ({ ...c, sponsorImage: img }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="panel">
      <h1>Configuratore 3D Kit</h1>
      <p className="subtitle">
        Modello reale (scansione 3D) della Paris Saint-Germain x Jordan Home Stadium Kit — branding originale
        rimosso, personalizza colori, pattern, sponsor e nome/numero.
      </p>

      <div className="section">
        <ColorField label="Colore primario" value={config.primaryColor} onChange={set('primaryColor')} />
        <ColorField label="Colore secondario" value={config.secondaryColor} onChange={set('secondaryColor')} />
        <label className="field">
          <span>Pattern</span>
          <select value={config.pattern} onChange={(e) => set('pattern')(e.target.value)}>
            {PATTERNS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="section">
        <label className="field">
          <span>Sponsor (testo)</span>
          <input
            type="text"
            maxLength={16}
            value={config.sponsorText}
            onChange={(e) => setConfig((c) => ({ ...c, sponsorText: e.target.value, sponsorImage: null }))}
            placeholder="Es. FLY EMIRATES"
          />
        </label>
        <label className="field">
          <span>Oppure logo sponsor</span>
          <input type="file" accept="image/*" onChange={onLogoUpload} />
        </label>
        <ColorField label="Colore sponsor" value={config.sponsorColor} onChange={set('sponsorColor')} />
      </div>

      <div className="section">
        <label className="field">
          <span>Nome sul retro</span>
          <input
            type="text"
            maxLength={12}
            value={config.backName}
            onChange={(e) => set('backName')(e.target.value)}
            placeholder="Es. ROSSI"
          />
        </label>
        <label className="field">
          <span>Numero</span>
          <input
            type="number"
            min={0}
            max={99}
            value={config.backNumber}
            onChange={(e) => set('backNumber')(e.target.value)}
          />
        </label>
        <ColorField label="Colore nome/numero" value={config.numberColor} onChange={set('numberColor')} />
      </div>

      <button className="download-btn" onClick={onDownload}>
        Scarica anteprima PNG
      </button>

      <p className="credit">
        Mesh 3D basata su{' '}
        <a
          href="https://sketchfab.com/3d-models/paris-saint-germain-x-jordan-home-stadium-kit-1d43be1db93143ea8cc35bb5fb339ad1"
          target="_blank"
          rel="noreferrer"
        >
          Paris Saint-Germain x Jordan Home Stadium Kit
        </a>{' '}
        di{' '}
        <a href="https://sketchfab.com/proxy000000000" target="_blank" rel="noreferrer">
          PROXY
        </a>
        , licenza{' '}
        <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          CC-BY-4.0
        </a>{' '}
        (branding originale rimosso).
      </p>
    </div>
  );
}
