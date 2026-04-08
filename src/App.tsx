/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import Map from './components/Map';
import Sidebar from './components/Sidebar';

export default function App() {
  return (
    <div className="flex w-screen h-screen overflow-hidden bg-slate-100 font-sans">
      <Sidebar />
      <main className="flex-1 relative">
        <Map />
      </main>
    </div>
  );
}

