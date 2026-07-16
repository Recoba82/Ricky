import React from 'react';
import CanvasContainer from './components/CanvasContainer';
import ControlPanel from './components/ControlPanel';

export default function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950">
      <main className="relative min-w-0 flex-1">
        <CanvasContainer />
      </main>
      <ControlPanel />
    </div>
  );
}
