import React from 'react';
import CanvasContainer from './components/CanvasContainer';
import ControlPanel from './components/ControlPanel';

/**
 * Layout responsive:
 * - mobile (< 768px, verificato fino a 318px di larghezza): impilato in
 *   colonna, canvas 3D in alto e pannello di controllo in basso;
 * - tablet (>= 768px): due colonne con pannello laterale da 320px;
 * - desktop (>= 1024px): due colonne con pannello laterale da 380px.
 */
export default function App() {
  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-950 md:flex-row">
      <main className="relative min-h-0 min-w-0 flex-1">
        <CanvasContainer />
      </main>
      <ControlPanel />
    </div>
  );
}
