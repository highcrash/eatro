import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

// Derive basename from the loaded HTML's URL. See admin/main.tsx.
function getSpaBasename(): string {
  const path = new URL(document.baseURI).pathname;
  const dir = path.endsWith('/') ? path.slice(0, -1) : path.replace(/\/[^/]*$/, '');
  return dir || '/';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={getSpaBasename()}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
