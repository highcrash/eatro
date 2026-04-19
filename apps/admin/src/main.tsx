import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// Derive the router basename from the URL the SPA's HTML was loaded
// from. Lets the same build work at the root (`/`) AND at a subpath
// (`/admin/`) without rebuild-time knowledge of the mount point.
// Without this, <Navigate to="/dashboard"> navigates to host/dashboard
// instead of host/admin/dashboard when the SPA is served under /admin/.
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
