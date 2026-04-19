import './styles/globals.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WebApp from './App';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
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
        <WebApp />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
