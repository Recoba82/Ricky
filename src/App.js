import React, { useRef, useState } from 'react';
import KitViewer from './components/KitViewer';
import ControlsPanel from './components/ControlsPanel';
import './App.css';

const DEFAULT_CONFIG = {
  primaryColor: '#0d1b3d',
  secondaryColor: '#ffffff',
  pattern: 'stripes',
  sponsorText: 'SPONSOR',
  sponsorColor: '#ffffff',
  sponsorImage: null,
  backName: 'ROSSI',
  backNumber: 10,
  numberColor: '#ffffff',
};

export default function App() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const canvasRef = useRef(null);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'kit-3d.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="app">
      <div className="viewer">
        <KitViewer config={config} ref={canvasRef} />
      </div>
      <ControlsPanel config={config} setConfig={setConfig} onDownload={handleDownload} />
    </div>
  );
}
