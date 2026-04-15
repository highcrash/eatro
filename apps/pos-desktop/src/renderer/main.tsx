import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { installFetchShim } from './fetch-shim';
import { installPrintShim } from './print-shim';
import { App } from './App';

// Install BEFORE React mounts — any early module-level fetch (React Query
// hydration, service-worker registration, etc.) must see the patched global.
installFetchShim();
installPrintShim();

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
